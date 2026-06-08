// seed.js — one-time, idempotent database seeder for Railway deploys.
// On startup, if the database is EMPTY (no users), import the bundled
// seed-data.json. Once data exists it never runs again, so live edits
// are never overwritten. No-op in file mode.
const fs = require('fs');
const path = require('path');
const datastore = require('./datastore');

async function seedIfEmpty() {
  if (!datastore.USE_DB) return;

  const seedFile = path.join(__dirname, '..', 'seed-data.json');
  if (!fs.existsSync(seedFile)) return;

  const existing = datastore.read('users', {});
  if (existing && Object.keys(existing).length > 0) return; // already seeded / live data present

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch (e) {
    console.error('🌱 Seed skipped — seed-data.json invalid:', e.message);
    return;
  }

  console.log('🌱 Empty database detected — seeding from seed-data.json ...');
  for (const key of ['foods', 'users', 'groups', 'known_users']) {
    if (seed[key] !== undefined) datastore.write(key, seed[key]);
  }
  await datastore.flush();

  const summary = Object.keys(seed)
    .map((k) => `${k}:${Array.isArray(seed[k]) ? seed[k].length : Object.keys(seed[k]).length}`)
    .join(', ');
  console.log('🌱 Seed complete —', summary);
}

module.exports = { seedIfEmpty };
