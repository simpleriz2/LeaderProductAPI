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
