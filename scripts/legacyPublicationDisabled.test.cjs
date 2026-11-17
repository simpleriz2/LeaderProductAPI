'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const scripts = ['publish-apk-update-db.js', 'publish-ota-update-db.js'];
// Invalid metadata and an empty environment ensure refusal precedes file/config/dependency reads.
for (const script of scripts) test(`fork refuses ${script} before any publication work`, () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), '/missing/lp2-metadata.json', '--dry-run'], {
    env: {}, encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'LP2_LEGACY_PUBLICATION_DISABLED: original APK/Expo OTA and symbol publication is disabled in this fork.');
});
