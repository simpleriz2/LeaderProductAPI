'use strict';
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
// In-memory fixture registry. Registration is atomic; immutable bytes may have MANY grants.
function createArtifactRegistry() {
  const blobs = new Map(), releases = new Map();
  const releaseKey = (company, release) => `${company}/${release}`;
  return {
    register(release, files) {
      if (!release || !id(release.company) || !id(release.id) || release.format !== 1 || !['android','web'].includes(release.platform) || !Array.isArray(release.artifacts) || release.artifacts.length > 128 || !(files instanceof Map)) throw Error('Invalid fixture release');
      const snapshot = JSON.parse(JSON.stringify(release)); const payload = JSON.stringify(snapshot);
      const key = releaseKey(snapshot.company, snapshot.id);
      if (releases.has(key) && releases.get(key).payload !== payload) throw Error('Immutable release id conflict');
      const pending = []; const modules = new Set(); let total = 0, count = 0;
      for (const artifact of snapshot.artifacts) {
        if (!id(artifact.module) || modules.has(artifact.module) || !Array.isArray(artifact.assets) || artifact.assets.length > 512) throw Error('Invalid fixture module');
        modules.add(artifact.module); const names = new Set();
        for (const file of [artifact, ...artifact.assets]) {
          const bytes = files.get(file.path);
          if (!/^[a-f0-9]{64}$/.test(file.digest) || file.path !== `artifacts/${file.digest}.bundle` || !Buffer.isBuffer(bytes) || bytes.length !== file.size || hash(bytes) !== file.digest || typeof file.name !== 'string' || names.has(file.name)) throw Error('Invalid fixture artifact');
          names.add(file.name); total += bytes.length; count++;
          if (count > 4096 || total > 128 * 1024 * 1024) throw Error('Fixture registry bound exceeded');
          if (blobs.has(file.path) && !blobs.get(file.path).bytes.equals(bytes)) throw Error('Immutable blob conflict');
          pending.push({ path: file.path, bytes: Buffer.from(bytes), module: artifact.module });
        }
      }
      for (const file of pending) {
        if (!blobs.has(file.path)) blobs.set(file.path, { bytes: file.bytes, grants: new Set() });
        blobs.get(file.path).grants.add(`${key}/${file.module}`);
      }
      releases.set(key, { payload, release: snapshot });
      return snapshot;
    },
    release(company, release) { const stored = releases.get(releaseKey(company, release)); return stored && JSON.parse(stored.payload); },
    read(path, identity) {
      const blob = blobs.get(path);
      if (!blob || !identity.modules.some(module => blob.grants.has(`${releaseKey(identity.company, identity.releaseId)}/${module}`))) return null;
      return Buffer.from(blob.bytes);
    },
  };
}
module.exports = { createArtifactRegistry };
