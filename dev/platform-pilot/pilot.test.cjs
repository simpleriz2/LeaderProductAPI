const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verify, createHash } = require('node:crypto');
const { startPilot } = require('./pilot.cjs');
async function request(url, token, body) {
  return fetch(url, { method: body ? 'POST' : 'GET', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function login(pilot, user) { const r = await request(`${pilot.central.url}/login`, null, { user, password: 'fixture-only' }); assert.equal(r.status, 200); return (await r.json()).token; }
async function scoped(pilot, session, audience) { const r = await request(`${pilot.central.url}/tokens`, session, { audience }); assert.equal(r.status, 200); return (await r.json()).token; }
async function pilot(t) { const p = await startPilot(); t.after(() => p.close()); return p; }
test('two companies discover different pinned signed releases and service endpoints', async t => {
  const p = await pilot(t);
  for(const [user, company, version] of [['alice','alpha','alpha-1'], ['bob','beta','beta-4']]) {
    const s = await login(p, user); const r = await request(`${p.central.url}/discovery`, s); assert.equal(r.status, 200);
    const d = await r.json(); assert.equal(d.company, company); assert.equal(d.companyApi, p.companies[company].url);
    assert.equal(JSON.parse(d.release.payload).id, version);
    assert.equal(verify(null, Buffer.from(d.release.payload), p.publicKey, Buffer.from(d.release.signature, 'base64')), true);
    const token = await scoped(p, s, `company:${company}`);
    assert.equal((await request(`${d.companyApi}/records/${user}-draft`, token)).status, 200);
  }
});
test('Company online requests always introspect; central outage cannot reuse last positive result', async t => {
  const p = await pilot(t); const s = await login(p, 'alice'); const token = await scoped(p, s, 'company:alpha'); const url = `${p.companies.alpha.url}/records/alice-draft`;
  const before = p.introspections();
  assert.equal((await request(url, token)).status, 200); assert.equal((await request(url, token)).status, 200);
  assert.equal(p.introspections() - before, 2);
  await p.stopCentral(); assert.equal((await request(url, token)).status, 503);
});
test('universal sessions, wrong company/audience and unauthorized objects are rejected', async t => {
  const p = await pilot(t); const s = await login(p, 'alice'); const token = await scoped(p, s, 'company:alpha');
  assert.equal((await request(`${p.companies.alpha.url}/records/alice-draft`, s)).status, 401);
  assert.equal((await request(`${p.companies.beta.url}/records/bob-draft`, token)).status, 401);
  assert.equal((await request(`${p.companies.alpha.url}/records/bob-draft`, token)).status, 404);
  assert.equal((await request(`${p.central.url}/tokens`, s, { audience: 'company:beta' })).status, 403);
  assert.equal((await request(`${p.central.url}/tokens`, s, { audience: 'https://attacker.invalid' })).status, 403);
  assert.equal((await request(`${p.central.url}/introspect`, null, { token })).status, 403);
});
test('private immutable artifacts enforce scope, hash and immediate online revocation', async t => {
  const p = await pilot(t); const s = await login(p, 'alice'); const companyToken = await scoped(p, s, 'company:alpha'); const artifactToken = await scoped(p, s, 'artifacts');
  const d = await (await request(`${p.central.url}/discovery`, s)).json(); const artifact = JSON.parse(d.release.payload).artifacts[0]; const url = `${p.artifactServer.url}/${artifact.path}`;
  assert.equal((await request(url)).status, 401); assert.equal((await request(url, companyToken)).status, 401);
  const r = await request(url, artifactToken); assert.equal(r.status, 200);
  assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), artifact.digest);
  const bob = await login(p, 'bob'); const betaArtifactToken = await scoped(p, bob, 'artifacts');
  assert.equal((await request(url, betaArtifactToken)).status, 404);
  p.revoke('alice'); assert.equal((await request(url, artifactToken)).status, 401);
  assert.equal((await request(`${p.companies.alpha.url}/records/alice-draft`, companyToken)).status, 401);
  assert.equal((await request(`${p.central.url}/discovery`, s)).status, 401);
});
function fixtureRelease(company, id, content, modules = ['qr']) {
  const bytes = Buffer.from(content); const digest = createHash('sha256').update(bytes).digest('hex'); const key = `artifacts/${digest}.bundle`;
  return { release: { format: 2, platform: 'android', id, company, minHost: 1, runtime: 'fixture-runtime', api: '1.0.0', artifacts: modules.map(module => ({module, version:'1.0.0', contract:'1.0.0',requires:{minHost:1,capabilities:{},contracts:{}}, schema:1, name:`${module}.bundle`, size:bytes.length, digest, path:key, assets:[]})) }, files: new Map([[key,bytes]]), key };
}
test('shared immutable bytes retain all company/module grants and tokens pin a release during download', async t => {
  const alpha = fixtureRelease('alpha','shared-1','same runtime chunk',['qr','help']);
  const beta = fixtureRelease('beta','shared-1','same runtime chunk');
  const p = await startPilot({releases:[alpha,beta]}); t.after(()=>p.close());
  const alice = await login(p,'alice'), bob = await login(p,'bob');
  const oldToken = await scoped(p,alice,'artifacts'), betaToken = await scoped(p,bob,'artifacts');
  for(const token of [oldToken,betaToken]) assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,token)).status,200);
  p.setModules('alice',['help']); // Same blob also belongs to Help: QR's grant cannot overwrite it.
  assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,oldToken)).status,200);
  const next = fixtureRelease('alpha','shared-2','new runtime chunk',['help']); p.assignRelease(next.release,next.files);
  assert.equal((await request(`${p.artifactServer.url}/${next.key}`,oldToken)).status,404);
  const nextToken=await scoped(p,alice,'artifacts');
  assert.equal((await request(`${p.artifactServer.url}/${next.key}`,nextToken)).status,200);
  assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,nextToken)).status,404);
  // Already issued release token has a bounded 60s compatibility window, without rights caching.
  assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,oldToken)).status,200);
  p.setModules('alice',[]);
  assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,oldToken)).status,404);
  assert.equal((await request(`${p.artifactServer.url}/${alpha.key}`,betaToken)).status,200);
});
test('current grants restrict old tokens, discovery and Company objects; blocked accounts cannot login again', async t => {
  const p=await pilot(t), session=await login(p,'alice');
  const companyToken=await scoped(p,session,'company:alpha'), artifactToken=await scoped(p,session,'artifacts');
  const original=await (await request(`${p.central.url}/discovery`,session)).json(); const qr=JSON.parse(original.release.payload).artifacts.find(a=>a.module==='qr');
  p.setModules('alice',['help']);
  assert.equal((await request(`${p.companies.alpha.url}/records/alice-draft`,companyToken)).status,403);
  assert.equal((await request(`${p.artifactServer.url}/${qr.path}`,artifactToken)).status,404);
  const reduced=await (await request(`${p.central.url}/discovery`,session)).json(); assert.deepEqual(reduced.modules,['help']);
  assert.deepEqual(JSON.parse(reduced.release.payload).artifacts.map(a=>a.module),['help']);
  assert.equal(verify(null,Buffer.from(reduced.release.payload),p.publicKey,Buffer.from(reduced.release.signature,'base64')),true);
  const reducedToken=await scoped(p,session,'artifacts');p.setModules('alice',['qr','help']);
  assert.equal((await request(`${p.artifactServer.url}/${qr.path}`,reducedToken)).status,404); // no privilege expansion of issued token
  p.revoke('alice');assert.equal((await request(`${p.central.url}/login`,null,{user:'alice',password:'fixture-only'})).status,401);
});
test('failed registry registration cannot change assignment or publish partial blobs', async t => {
  const p=await pilot(t), session=await login(p,'alice');const fixture=fixtureRelease('alpha','broken','not published');
  const corrupt={...fixture.release,artifacts:[...fixture.release.artifacts,{...fixture.release.artifacts[0],module:'help',digest:'0'.repeat(64)}]};
  assert.throws(()=>p.assignRelease(corrupt,fixture.files),/Invalid fixture artifact/);
  const discovery=await (await request(`${p.central.url}/discovery`,session)).json();assert.equal(JSON.parse(discovery.release.payload).id,'alpha-1');
  const token=await scoped(p,session,'artifacts');assert.equal((await request(`${p.artifactServer.url}/${fixture.key}`,token)).status,404);
  p.assignRelease(fixture.release,fixture.files);
  const conflict=fixtureRelease('alpha','broken','changed immutable id');assert.throws(()=>p.assignRelease(conflict.release,conflict.files),/Immutable release id conflict/);
});
test('registry refuses undeclared module requirements and old manifest formats before assignment',async t=>{
  const p=await pilot(t), fixture=fixtureRelease('alpha','bad-requirements','fixture');
  delete fixture.release.artifacts[0].requires;
  assert.throws(()=>p.assignRelease(fixture.release,fixture.files),/module compatibility/);
  const legacy=fixtureRelease('alpha','old-format','fixture');legacy.release.format=1;
  assert.throws(()=>p.assignRelease(legacy.release,legacy.files),/Invalid fixture release/);
});
