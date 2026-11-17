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

test('same-company identities receive signed individual offline rights and object-scoped access',async t=>{
 const p=await pilot(t),alice=await login(p,'alice'),carol=await login(p,'carol');
 const discovery=async session=>(await request(`${p.central.url}/discovery`,session)).json();
 const a=await discovery(alice),c=await discovery(carol);
 for(const d of [a,c]){assert.equal(verify(null,Buffer.from(d.offlineGrant.payload),p.publicKey,Buffer.from(d.offlineGrant.signature,'base64')),true);const grant=JSON.parse(d.offlineGrant.payload);assert.equal(grant.purpose,'lp2-offline-session');assert.equal(grant.session.company,'alpha');assert.equal(grant.format,1);assert.ok(Number.isSafeInteger(grant.issuedAt));}
 assert.deepEqual(JSON.parse(a.offlineGrant.payload).session.modules,['qr','help']);assert.deepEqual(JSON.parse(c.offlineGrant.payload).session.modules,['qr']);assert.equal(JSON.parse(c.offlineGrant.payload).session.user,'carol');
 assert.deepEqual(JSON.parse(c.release.payload).artifacts.map(a=>a.module),['qr']);
 const token=await scoped(p,carol,'company:alpha');
 assert.equal((await request(`${p.companies.alpha.url}/records/carol-draft`,token)).status,200);
 assert.equal((await request(`${p.companies.alpha.url}/records/alice-draft`,token)).status,403);
 const artifactToken=await scoped(p,carol,'artifacts'),help=JSON.parse(a.release.payload).artifacts.find(a=>a.module==='help');
 assert.equal((await request(`${p.artifactServer.url}/${help.path}`,artifactToken)).status,404);
 p.setModules('carol',[]);const after=await discovery(carol);assert.deepEqual(JSON.parse(after.offlineGrant.payload).session.modules,[]);assert.notEqual(JSON.parse(after.offlineGrant.payload).session.confirmation,JSON.parse(c.offlineGrant.payload).session.confirmation);
 assert.equal((await request(`${p.companies.alpha.url}/records/carol-draft`,token)).status,403);
 p.revoke('carol');assert.equal((await request(`${p.central.url}/discovery`,carol)).status,401);
});
test('browser pilot CORS requires explicit loopback origin and bounded preflight contract',async t=>{
 const p=await startPilot({webOrigins:['http://127.0.0.1:43001']});t.after(()=>p.close());
 for(const endpoint of [p.central.url,p.companies.alpha.url,p.artifactServer.url]){
  const allowed=await fetch(endpoint+'/login',{method:'OPTIONS',headers:{origin:'http://127.0.0.1:43001','access-control-request-method':'POST','access-control-request-headers':'authorization, content-type'}});assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'http://127.0.0.1:43001');assert.equal(allowed.headers.get('access-control-allow-credentials'),null);
  const denied=await fetch(endpoint+'/login',{method:'OPTIONS',headers:{origin:'https://untrusted.invalid','access-control-request-method':'POST'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  const invalid=await fetch(endpoint+'/login',{method:'OPTIONS',headers:{origin:'http://127.0.0.1:43001','access-control-request-method':'DELETE','access-control-request-headers':'x-pilot-service'}});assert.equal(invalid.status,403);
 }
 const response=await fetch(p.central.url+'/login',{method:'POST',headers:{origin:'http://127.0.0.1:43001','content-type':'application/json'},body:JSON.stringify({user:'alice',password:'fixture-only'})});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'http://127.0.0.1:43001');
});
test('pilot refuses external origins rather than widening its browser allowlist',async()=>{
 for(const origin of ['https://company.invalid','http://0.0.0.0:3000','http://127.0.0.1:43001/path'])await assert.rejects(startPilot({webOrigins:[origin]}),/explicit loopback/);
});
test('individual action grants are signed and enforced on every Company request independently of module license',async t=>{
 const p=await pilot(t),session=await login(p,'alice'),token=await scoped(p,session,'company:alpha');const url=p.companies.alpha.url+'/records/alice-draft';assert.equal((await request(url,token)).status,200);
 p.setPermissions('alice','qr',['create_qr']);const discovery=await(await request(p.central.url+'/discovery',session)).json();const grant=JSON.parse(discovery.offlineGrant.payload);assert.ok(grant.session.modules.includes('qr'));assert.deepEqual(grant.session.permissions.qr,['create_qr']);assert.equal(verify(null,Buffer.from(discovery.offlineGrant.payload),p.publicKey,Buffer.from(discovery.offlineGrant.signature,'base64')),true);
 const before=p.introspections();assert.equal((await request(url,token)).status,403);assert.equal((await request(url,token)).status,403);assert.equal(p.introspections()-before,2);
});
test('old restricted token cannot gain newly granted actions; new token gets only current action confirmation',async t=>{
 const p=await pilot(t),session=await login(p,'alice');p.setPermissions('alice','qr',[]);const old=await scoped(p,session,'company:alpha');p.setPermissions('alice','qr',['view_qr']);const url=p.companies.alpha.url+'/records/alice-draft';assert.equal((await request(url,old)).status,403);const current=await scoped(p,session,'company:alpha');assert.equal((await request(url,current)).status,200);
 assert.throws(()=>p.setPermissions('carol','qr',['delete_qr']),/Invalid fixture action/);
});
test('same company has independent exact Android/Web assignments; platform token cannot fetch other variant bytes',async t=>{
 const p=await pilot(t),nativeSession=await login(p,'alice');const native=await(await request(p.central.url+'/discovery',nativeSession)).json();
 const bytes=Buffer.from('/* actual distinct web fixture */'),digest=createHash('sha256').update(bytes).digest('hex'),key=`artifacts/${digest}.bundle`;const artifact={module:'qr',name:'qr.container.js',size:bytes.length,path:key,digest,assets:[],version:'2.0.0',contract:'1.0.0',schema:0,requires:{minHost:1,capabilities:{},contracts:{}}};
 const web={...JSON.parse(native.release.payload),id:'alpha-web2',platform:'web',runtime:'fixture-web',artifacts:[artifact]};p.assignRelease(web,new Map([[key,bytes]]));
 const loginWeb=await request(p.central.url+'/login',null,{user:'alice',password:'fixture-only',platform:'web'});assert.equal(loginWeb.status,200);const webSession=(await loginWeb.json()).token;
 const discovery=await(await request(p.central.url+'/discovery',webSession)).json();assert.equal(JSON.parse(discovery.release.payload).id,'alpha-web2');assert.deepEqual(discovery.modules,['qr']);assert.deepEqual(JSON.parse(discovery.offlineGrant.payload).session.modules,['qr']);
 const nativeAfter=await(await request(p.central.url+'/discovery',nativeSession)).json();assert.equal(JSON.parse(nativeAfter.release.payload).id,'alpha-1');assert.deepEqual(nativeAfter.modules,['qr','help']);
 const webToken=await scoped(p,webSession,'artifacts'),nativeToken=await scoped(p,nativeSession,'artifacts');assert.equal((await request(p.artifactServer.url+'/'+key,webToken)).status,200);assert.equal((await request(p.artifactServer.url+'/'+key,nativeToken)).status,404);
 const nativeFile=JSON.parse(native.release.payload).artifacts[0];assert.equal((await request(p.artifactServer.url+'/'+nativeFile.path,webToken)).status,404);
});
test('missing platform assignment and unsupported platform never fall back to a different runtime',async t=>{
 const p=await pilot(t),response=await request(p.central.url+'/login',null,{user:'bob',password:'fixture-only',platform:'web'});assert.equal(response.status,200);const session=(await response.json()).token;assert.equal((await request(p.central.url+'/discovery',session)).status,409);assert.equal((await request(p.central.url+'/tokens',session,{audience:'artifacts'})).status,409);
 assert.equal((await request(p.central.url+'/login',null,{user:'bob',password:'fixture-only',platform:'ios'})).status,400);
});
test('earlier browser login without platform retains Web assignment using only its allowlisted Origin',async t=>{
 const origin='http://127.0.0.1:43002',p=await startPilot({webOrigins:[origin]});t.after(()=>p.close());const nativeSession=await login(p,'alice'),native=JSON.parse((await(await request(p.central.url+'/discovery',nativeSession)).json()).release.payload);const bytes=Buffer.from('/* compatibility web qr */'),digest=createHash('sha256').update(bytes).digest('hex'),key=`artifacts/${digest}.bundle`;const web={...native,id:'alpha-web-compat',platform:'web',runtime:'fixture-web',artifacts:[{...native.artifacts[0],name:'qr.container.js',digest,path:key,size:bytes.length,assets:[]}]};p.assignRelease(web,new Map([[key,bytes]]));
 const response=await fetch(p.central.url+'/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({user:'alice',password:'fixture-only'})});assert.equal(response.status,200);const session=(await response.json()).token;const discovery=await(await request(p.central.url+'/discovery',session)).json();assert.equal(JSON.parse(discovery.release.payload).id,'alpha-web-compat');assert.equal(JSON.parse((await(await request(p.central.url+'/discovery',nativeSession)).json()).release.payload).platform,'android');
});
test('API rollout window serves pinned old/new clients and retirement rejects previously issued tokens online',async t=>{
 const p=await pilot(t),session=await login(p,'alice');const old=await scoped(p,session,'company:alpha');
 const next=fixtureRelease('alpha','alpha-api2','/* api2 */',['qr']);next.release.api='2.0.0';
 assert.throws(()=>p.assignRelease(next.release,next.files),/not deployed/);
 p.setSupportedApis('alpha',['1.0.0','2.0.0']);p.assignRelease(next.release,next.files);
 const issue=async id=>request(p.central.url+'/tokens',session,{audience:'company:alpha',activeReleaseId:id});
 const oldResult=await issue('alpha-1');assert.equal(oldResult.status,200);const oldScoped=await oldResult.json();assert.equal(oldScoped.api,'1.0.0');assert.equal(oldScoped.releaseId,'alpha-1');
 const newResult=await issue('alpha-api2');assert.equal(newResult.status,200);const newScoped=await newResult.json();assert.equal(newScoped.api,'2.0.0');
 const url=p.companies.alpha.url+'/records/alice-draft';for(const token of [old,oldScoped.token,newScoped.token])assert.equal((await request(url,token)).status,200);
 p.setSupportedApis('alpha',['2.0.0']);const before=p.introspections();assert.equal((await request(url,old)).status,409);assert.equal((await request(url,oldScoped.token)).status,409);assert.equal(p.introspections()-before,2);
 assert.equal((await issue('alpha-1')).status,409);assert.equal((await request(url,newScoped.token)).status,200);
 p.revoke('alice');assert.equal((await request(url,newScoped.token)).status,401);
});
test('active release token cannot select another company/platform or invented release; artifact tokens remain candidate-pinned',async t=>{
 const p=await pilot(t),session=await login(p,'alice');
 for(const id of ['beta-4','never-assigned',{},'alpha/alpha-1'])assert.equal((await request(p.central.url+'/tokens',session,{audience:'company:alpha',activeReleaseId:id})).status,403);
 const web=fixtureRelease('alpha','alpha-web-api','/* web */',['qr']);web.release.platform='web';p.assignRelease(web.release,web.files);
 assert.equal((await request(p.central.url+'/tokens',session,{audience:'company:alpha',activeReleaseId:'alpha-web-api'})).status,403);
 const next=fixtureRelease('alpha','alpha-next','/* next */',['qr']);p.assignRelease(next.release,next.files);
 const artifact=await(await request(p.central.url+'/tokens',session,{audience:'artifacts',activeReleaseId:'alpha-1'})).json();assert.equal(artifact.releaseId,'alpha-next');
 assert.equal((await request(p.artifactServer.url+'/'+next.key,artifact.token)).status,200);
 for(const versions of [[],['latest'],['1.0'],[null]])assert.throws(()=>p.setSupportedApis('alpha',versions),/compatibility/);
});
