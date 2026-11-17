/** Isolated loopback protocol pilot. Never imports legacy app, Prisma, Redis, 1C or production config. */
const http = require('node:http');
const { randomUUID, randomBytes, generateKeyPairSync, createHash, sign } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureUsers = { alice: { company: 'alpha', modules: ['qr', 'help'] }, bob: { company: 'beta', modules: ['qr'] } };
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
async function readBody(req) {
  let body = ''; for await(const chunk of req) { body += chunk; if(body.length > 16384) throw Error('Body too large'); }
  return JSON.parse(body || '{}');
}
async function listen(handler) {
  const server = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => { if(!res.headersSent) json(res, 400, { error: 'Invalid request' }); else res.end(); }); });
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
async function startPilot() {
  const sessions = new Map(), tokens = new Map(); const services = new Map(); let introspections = 0;
  const pair = generateKeyPairSync('ed25519');
  const artifacts = new Map();
  const signedSets = new Map();
  for(const [company, user] of [['alpha','alice'], ['beta','bob']]) {
    const release = { id: `${company}-${company === 'alpha' ? 1 : 4}`, company, minHost: 1, runtime: 'rn-0.88.1-react-19.3.0', api: '1.0.0', artifacts: [] };
    for(const module of fixtureUsers[user].modules) {
      const bytes = Buffer.from(`/* fixture ${company} ${module} */`); const digest = hash(bytes);
      artifacts.set(`artifacts/${digest}.bundle`, { bytes, module, company });
      release.artifacts.push({ module, version: company === 'beta' ? '2.0.0' : '1.0.0', contract: '1.0.0', schema: 1, digest, path: `artifacts/${digest}.bundle` });
    }
    const payload = JSON.stringify(release);
    signedSets.set(company, { keyId: 'pilot-key', payload, signature: sign(null, Buffer.from(payload), pair.privateKey).toString('base64') });
  }
  const lookupSession = token => { const s = sessions.get(hash(token || '')); return s && !s.revoked && s.expires > Date.now() ? s : null; };
  const activeToken = token => {
    const t = tokens.get(hash(token || '')); if(!t || t.expires <= Date.now()) return null;
    const s = sessions.get(t.session); return s && !s.revoked && s.expires > Date.now() ? t : null;
  };
  let companies = {};
  const central = await listen(async (req, res) => {
    if(req.method === 'POST' && req.url === '/login') {
      const { user, password } = await readBody(req);
      if(!Object.hasOwn(fixtureUsers, user) || password !== 'fixture-only') return json(res, 401, { error: 'Unauthorized' });
      const token = randomBytes(32).toString('base64url');
      sessions.set(hash(token), { ...fixtureUsers[user], user, revoked: false, expires: Date.now() + 3600000 });
      return json(res, 200, { token });
    }
    if(req.method === 'POST' && req.url === '/introspect') {
      introspections++;
      const service = services.get(req.headers['x-pilot-service']);
      if(!service) return json(res, 403, { active: false });
      const { token } = await readBody(req); const t = activeToken(token);
      if(!t || t.audience !== service.audience || (service.company && t.company !== service.company)) return json(res, 200, { active: false });
      return json(res, 200, { active: true, user: t.user, company: t.company, modules: t.modules, audience: t.audience });
    }
    const session = lookupSession(bearer(req));
    if(!session) return json(res, 401, { error: 'Unauthorized' });
    if(req.method === 'GET' && req.url === '/discovery') return json(res, 200, { company: session.company, companyApi: companies[session.company].url, artifactApi: artifactServer.url, release: signedSets.get(session.company) });
    if(req.method === 'POST' && req.url === '/tokens') {
      const { audience } = await readBody(req);
      if(![`company:${session.company}`, 'artifacts'].includes(audience)) return json(res, 403, { error: 'Audience denied' });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 60000;
      tokens.set(hash(token), { ...session, session: hash(bearer(req)), audience, expires: expiresAt });
      return json(res, 200, { token, audience, company: session.company, user: session.user, expiresAt });
    }
    json(res, 404, { error: 'Not found' });
  });
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
      const expectedOwner = company === 'alpha' ? 'alice' : 'bob';
      if(req.method !== 'GET' || req.url !== `/records/${expectedOwner}-draft`) return json(res, 404, { error: 'Not found' });
      if(identity.company !== company || identity.user !== expectedOwner) return json(res, 403, { error: 'Object access denied' });
      json(res, 200, { id: `${expectedOwner}-draft`, company, owner: expectedOwner, status: 'fixture-draft' });
    });
  }
  const artifactCredential = randomUUID(); services.set(artifactCredential, { audience: 'artifacts' });
  const artifactServer = await listen(async (req, res) => {
    let identity; try { identity = await authorizeOnline(req, artifactCredential); } catch { return json(res, 503, { error: 'Central unavailable' }); }
    if(!identity.active) return json(res, 401, { error: 'Unauthorized' });
    const artifact = artifacts.get(req.url?.slice(1));
    if(req.method !== 'GET' || !artifact || artifact.company !== identity.company || !identity.modules.includes(artifact.module)) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, immutable', 'content-length': artifact.bytes.length }); res.end(artifact.bytes);
  });
  return { central, companies, artifactServer, publicKey: pair.publicKey, introspections: () => introspections,
    revoke: user => { for(const session of sessions.values()) if(session.user === user) session.revoked = true; },
    stopCentral: central.close,
    close: async () => { await Promise.all([artifactServer.close(), ...Object.values(companies).map(c => c.close())]); if(central.server.listening) await central.close(); },
  };
}
module.exports = { startPilot };
