// build-seed.js — bundles local data/*.json into seed-data.json for the
// one-time Railway seeder. OAuth tokens are stripped (never commit secrets).
// Run locally (no network needed):  node build-seed.js
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const KEYS = ['users', 'foods', 'groups', 'known_users'];
const out = {};

for (const k of KEYS) {
  const f = path.join(DATA, `${k}.json`);
  if (fs.existsSync(f)) out[k] = JSON.parse(fs.readFileSync(f, 'utf8'));
}

// Strip sensitive Google OAuth tokens before committing to git.
if (out.users) {
  for (const u of Object.values(out.users)) {
    if (u && u.googleTokens) delete u.googleTokens;
  }
}

fs.writeFileSync(path.join(__dirname, 'seed-data.json'), JSON.stringify(out));
const summary = Object.keys(out)
  .map((k) => `${k}:${Array.isArray(out[k]) ? out[k].length : Object.keys(out[k]).length}`)
  .join(', ');
console.log('✅ seed-data.json written —', summary);
