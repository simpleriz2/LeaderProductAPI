/** Isolated loopback protocol pilot. Never imports legacy app, Prisma, Redis, 1C or production config. */
const http = require('node:http');
const { createArtifactRegistry } = require('./artifactRegistry.cjs');
const { randomUUID, randomBytes, generateKeyPairSync, createHash, sign } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureUsers = { alice: { company: 'alpha', modules: ['qr', 'help'] }, bob: { company: 'beta', modules: ['qr'] }, carol: { company: 'alpha', modules: ['qr'] } };
const fixturePermissions={alice:{qr:['view_qr','create_qr','update_qr','delete_qr','view_qr_analytics'],help:['read_help','send_help']},bob:{qr:['view_qr','create_qr','update_qr','delete_qr']},carol:{qr:['view_qr']}};
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function readBody(req) {
  let body = ''; for await(const chunk of req) { body += chunk; if(body.length > 16384) throw Error('Body too large'); }
  return JSON.parse(body || '{}');
}
async function listen(handler,webOrigins=new Set()) {
  const server = http.createServer((req, res) => {
    const origin=req.headers.origin;
    if(origin){
      if(!webOrigins.has(origin))return json(res,403,{error:'Web origin denied'});
      res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');
      if(req.method==='OPTIONS'){
        const method=req.headers['access-control-request-method'],headers=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);
        if(!['GET','POST'].includes(method)||headers.some(h=>!['authorization','content-type'].includes(h)))return json(res,403,{error:'Preflight denied'});
        res.writeHead(204,{'access-control-allow-methods':'GET, POST','access-control-allow-headers':'authorization, content-type'});return res.end();
      }
    }
 Promise.resolve(handler(req, res)).catch(() => { if(!res.headersSent) json(res, 400, { error: 'Invalid request' }); else res.end(); }); });
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
async function startPilot(options = {}) {
  const webOrigins=new Set(options.webOrigins||[]);
  for(const origin of webOrigins){const url=new URL(origin);if(url.origin!==origin||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Pilot Web origin must be explicit loopback');}
  const sessions = new Map(), tokens = new Map(); const services = new Map(); let introspections = 0;
  const pair = generateKeyPairSync('ed25519');
  const registry = createArtifactRegistry(); const assigned = new Map();
  const revokedUsers = new Set(); const rightsRevision=new Map(Object.keys(fixtureUsers).map(user=>[user,0])); const currentModules = new Map(Object.entries(fixtureUsers).map(([user, f]) => [user, [...f.modules]]));
  const currentPermissions=new Map(Object.entries(fixturePermissions).map(([user,matrix])=>[user,structuredClone(matrix)]));
  const permissionSnapshot=(user,modules)=>Object.fromEntries(modules.map(module=>[module,[...(currentPermissions.get(user)[module]||[])]]));
  function assignRelease(release, files) {
    if (!['alpha','beta'].includes(release.company)) throw Error('Unknown fixture company');
    const registered = registry.register(release, files); assigned.set(registered.company, registered.id);
  }
  function offlineGrant(session){
    const payload=JSON.stringify({format:1,purpose:'lp2-offline-session',issuedAt:Date.now(),session:{company:session.company,user:session.user,modules:[...currentModules.get(session.user)],permissions:permissionSnapshot(session.user,currentModules.get(session.user)),confirmation:`${session.confirmation}.${rightsRevision.get(session.user)}`}});
    return{keyId:'pilot-key',payload,signature:sign(null,Buffer.from(payload),pair.privateKey).toString('base64')};
  }
  function signedRelease(session) {
    const release = registry.release(session.company, assigned.get(session.company));
    release.artifacts = release.artifacts.filter(a => currentModules.get(session.user).includes(a.module));
    const payload = JSON.stringify(release);
    return { keyId: 'pilot-key', payload, signature: sign(null, Buffer.from(payload), pair.privateKey).toString('base64') };
  }
  for(const [company, user] of [['alpha','alice'], ['beta','bob']]) {
    const release = { format: 2, platform: 'android', id: `${company}-${company === 'alpha' ? 1 : 4}`, company, minHost: 1, runtime: 'rn-0.88.1-react-19.3.0', api: '1.0.0', artifacts: [] };
    const files = new Map();
    for(const module of fixtureUsers[user].modules) {
      const bytes = Buffer.from(`/* fixture ${company} ${module} */`); const digest = hash(bytes);
      files.set(`artifacts/${digest}.bundle`, bytes);
      release.artifacts.push({ module, name: `${module}.container.bundle`, size: bytes.length, assets: [], version: company === 'beta' ? '2.0.0' : '1.0.0', contract: '1.0.0', requires: {minHost:1,capabilities:{},contracts:{}}, schema: 1, digest, path: `artifacts/${digest}.bundle` });
    }
    assignRelease(release, files);
  }
  for (const fixture of options.releases || []) assignRelease(fixture.release, fixture.files);
  const lookupSession = token => { const s = sessions.get(hash(token || '')); return s && !s.revoked && s.expires > Date.now() ? s : null; };
  const activeToken = token => {
    const t = tokens.get(hash(token || '')); if(!t || t.expires <= Date.now()) return null;
    const s = sessions.get(t.session);
    if(!s||s.revoked||s.expires<=Date.now()||s.company!==t.company||s.user!==t.user)return null;
    const modules=t.modules.filter(module=>currentModules.get(s.user).includes(module));
    const permissions=Object.fromEntries(modules.map(module=>[module,(t.permissions[module]||[]).filter(action=>(currentPermissions.get(s.user)[module]||[]).includes(action))]));
    return{...t,modules,permissions};
  };
  let companies = {};
  const central = await listen(async (req, res) => {
    if(req.method === 'POST' && req.url === '/login') {
      const { user, password } = await readBody(req);
      if(!Object.hasOwn(fixtureUsers, user) || revokedUsers.has(user) || password !== 'fixture-only') return json(res, 401, { error: 'Unauthorized' });
      const token = randomBytes(32).toString('base64url');
      sessions.set(hash(token), { ...fixtureUsers[user], user, confirmation:randomUUID(), revoked: false, expires: Date.now() + 3600000 });
      return json(res, 200, { token });
    }
    if(req.method === 'POST' && req.url === '/introspect') {
      introspections++;
      const service = services.get(req.headers['x-pilot-service']);
      if(!service) return json(res, 403, { active: false });
      const { token } = await readBody(req); const t = activeToken(token);
      if(!t || t.audience !== service.audience || (service.company && t.company !== service.company)) return json(res, 200, { active: false });
      return json(res, 200, { active: true, user: t.user, company: t.company, modules: t.modules, permissions:t.permissions, audience: t.audience, releaseId: t.releaseId });
    }
    const session = lookupSession(bearer(req));
    if(!session) return json(res, 401, { error: 'Unauthorized' });
    if(req.method === 'GET' && req.url === '/discovery') return json(res, 200, { company: session.company, offlineGrant:offlineGrant(session), companyApi: companies[session.company].url, artifactApi: artifactServer.url, modules: [...currentModules.get(session.user)], release: signedRelease(session) });
    if(req.method === 'POST' && req.url === '/tokens') {
      const { audience } = await readBody(req);
      if(![`company:${session.company}`, 'artifacts'].includes(audience)) return json(res, 403, { error: 'Audience denied' });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 60000;
      tokens.set(hash(token), { ...session, modules: [...currentModules.get(session.user)], permissions:permissionSnapshot(session.user,currentModules.get(session.user)), releaseId: assigned.get(session.company), session: hash(bearer(req)), audience, expires: expiresAt });
      return json(res, 200, { token, audience, company: session.company, user: session.user, expiresAt });
    }
    json(res, 404, { error: 'Not found' });
  },webOrigins);
  const authorizeOnline = async (req, credential) => {
    // No positive cache or local JWT fallback, including during central failure.
    const response = await fetch(`${central.url}/introspect`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pilot-service': credential }, body: JSON.stringify({ token: bearer(req) }), signal: AbortSignal.timeout(1000) });
    if(!response.ok) throw Error('Central unavailable'); return response.json();
  };
  for(const company of ['alpha','beta']) {
    const credential = randomUUID(); services.set(credential, { audience: `company:${company}`, company });
    companies[company] = await listen(async (req, res) => {
      let identity; try { identity = await authorizeOnline(req, credential); } catch { return json(res, 503, { error: 'Central unavailable' }); }
      if(!identity.active) return json(res, 401, { error: 'Unauthorized' });
      const expectedOwner=/^\/records\/([a-z]+)-draft$/.exec(req.url||'')?.[1];
      if(req.method !== 'GET' || !expectedOwner || !Object.hasOwn(fixtureUsers,expectedOwner) || fixtureUsers[expectedOwner].company!==company) return json(res, 404, { error: 'Not found' });
      if(!identity.modules.includes('qr')||!identity.permissions.qr?.includes('view_qr')) return json(res, 403, { error: 'Module access denied' });
      if(identity.company !== company || identity.user !== expectedOwner) return json(res, 403, { error: 'Object access denied' });
      json(res, 200, { id: `${expectedOwner}-draft`, company, owner: expectedOwner, status: 'fixture-draft' });
    },webOrigins);
  }
  const artifactCredential = randomUUID(); services.set(artifactCredential, { audience: 'artifacts' });
  const artifactServer = await listen(async (req, res) => {
    let identity; try { identity = await authorizeOnline(req, artifactCredential); } catch { return json(res, 503, { error: 'Central unavailable' }); }
    if(!identity.active) return json(res, 401, { error: 'Unauthorized' });
    const bytes = registry.read(req.url?.slice(1), identity);
    if(req.method !== 'GET' || !bytes) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'content-length': bytes.length }); res.end(bytes);
  },webOrigins);
  return { central, companies, artifactServer, publicKey: pair.publicKey, introspections: () => introspections,
    assignRelease,
    setModules: (user, modules) => {
      if(!Object.hasOwn(fixtureUsers,user) || !Array.isArray(modules) || modules.some(m => !fixtureUsers[user].modules.includes(m))) throw Error('Invalid fixture grants');
      currentModules.set(user,[...new Set(modules)]);rightsRevision.set(user,rightsRevision.get(user)+1);
    },
    setPermissions:(user,module,actions)=>{
      if(!Object.hasOwn(fixturePermissions,user)||!Object.hasOwn(fixturePermissions[user],module)||!Array.isArray(actions)||actions.some(action=>!fixturePermissions[user][module].includes(action)))throw Error('Invalid fixture action grants');
      currentPermissions.get(user)[module]=[...new Set(actions)];rightsRevision.set(user,rightsRevision.get(user)+1);
    },
    revoke: user => { revokedUsers.add(user); for(const session of sessions.values()) if(session.user === user) session.revoked = true; },
    stopCentral: central.close,
    close: async () => { await Promise.all([artifactServer.close(), ...Object.values(companies).map(c => c.close())]); if(central.server.listening) await central.close(); },
  };
}
module.exports = { startPilot };
