// ─────────────────────────────────────────────────────────────
// migrate-to-mongo.js — one-time import of local data/*.json into
// MongoDB Atlas. Safe to re-run: it upserts (overwrites) each store.
//
//   Usage (PowerShell, this machine needs --use-system-ca for TLS):
//     node --use-system-ca migrate-to-mongo.js
//   or:
//     npm run migrate
//
//   Requires MONGODB_URI in carb-bot/.env (and optionally MONGODB_DB).
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { MongoClient } = require('mongodb');

const DATA_DIR = path.join(__dirname, 'data');
const DB_NAME = process.env.MONGODB_DB || 'carbbot';
const KEYS = ['users', 'foods', 'groups', 'known_users'];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI is not set. Add it to carb-bot/.env first.');
    process.exit(1);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  const db = client.db(DB_NAME);
  const kv = db.collection('kv');
  console.log(`🗄️  Connected to MongoDB (db="${DB_NAME}")`);

  let imported = 0;
  for (const key of KEYS) {
    const file = path.join(DATA_DIR, `${key}.json`);
    if (!fs.existsSync(file)) {
      console.log(`⏭️  ${key}.json not found — skipping`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`⚠️  ${key}.json is not valid JSON — skipping (${e.message})`);
      continue;
    }
    await kv.updateOne(
      { _id: key },
      { $set: { data, updatedAt: new Date(), migratedAt: new Date() } },
      { upsert: true }
    );
    const size = Array.isArray(data) ? `${data.length} item(s)` : `${Object.keys(data).length} key(s)`;
    console.log(`✅ Imported ${key}  (${size})`);
    imported++;
  }

  console.log(`\n🎉 Migration complete — ${imported} store(s) imported into "${DB_NAME}".`);
  await client.close();
}

main().catch((err) => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
