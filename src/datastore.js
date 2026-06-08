// ─────────────────────────────────────────────────────────────
// datastore.js — pluggable persistence layer.
//
//   • If MONGODB_URI is set  → MongoDB is the single source of truth.
//       - All data lives in one collection `kv`, one document per logical
//         store: { _id:'users', data:{...} }, { _id:'foods', ... }, etc.
//       - The whole store is hydrated into an in-memory cache at init(),
//         so the rest of the code keeps its fast SYNCHRONOUS read/write API.
//       - Every write snapshots the PREVIOUS value into a `backups`
//         collection (auto-backup before write), pruned to the last N.
//       - Writes are debounced and always flush the latest cache state.
//   • If MONGODB_URI is NOT set → falls back to local JSON files in
//     config.dataDir (exactly the previous behaviour), so local dev and
//     tests keep working with zero configuration.
//
// Logical keys: 'users', 'foods', 'groups', 'known_users'.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const config = require('./config');

const USE_DB = !!process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'carbbot';
const BACKUP_LIMIT = parseInt(process.env.MONGODB_BACKUP_LIMIT || '50', 10);
const PERSIST_DEBOUNCE = 500; // ms — coalesce bursts of writes per key

const fileFor = (key) => path.join(config.dataDir, `${key}.json`);

let cache = {};          // logical key -> parsed JS value (DB mode only)
let mongo = null;        // { client, kv, backups }
let ready = false;
const persistTimers = {};
const pendingPersists = new Set();

// ─── Lifecycle ───────────────────────────────────────────────
async function init() {
  if (!USE_DB) { ready = true; return; }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  const db = client.db(DB_NAME);
  mongo = {
    client,
    kv: db.collection('kv'),
    backups: db.collection('backups'),
  };
  // Hydrate the in-memory cache from the database.
  const docs = await mongo.kv.find({}).toArray();
  for (const d of docs) cache[d._id] = d.data;
  ready = true;
  console.log(`🗄️  MongoDB connected (db="${DB_NAME}", ${docs.length} store(s) loaded)`);
}

// Flush any pending debounced writes — call before process exit.
async function flush() {
  if (!USE_DB) return;
  for (const key of Object.keys(persistTimers)) {
    if (persistTimers[key]) {
      clearTimeout(persistTimers[key]);
      persistTimers[key] = null;
    }
    pendingPersists.add(key);
  }
  const keys = Array.from(pendingPersists);
  pendingPersists.clear();
  await Promise.all(keys.map(persistNow));
}

async function close() {
  await flush();
  if (mongo && mongo.client) await mongo.client.close();
}

// ─── Synchronous read / write API ────────────────────────────
function read(key, def) {
  if (USE_DB) {
    return cache[key] !== undefined ? cache[key] : def;
  }
  const file = fileFor(key);
  if (!fs.existsSync(file)) return def;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

function write(key, data) {
  if (USE_DB) {
    cache[key] = data;
    schedulePersist(key);
    return;
  }
  fs.writeFileSync(fileFor(key), JSON.stringify(data, null, 2), 'utf8');
}

// ─── Mongo persistence (debounced, backup-before-write) ──────
function schedulePersist(key) {
  pendingPersists.add(key);
  if (persistTimers[key]) clearTimeout(persistTimers[key]);
  persistTimers[key] = setTimeout(() => {
    persistTimers[key] = null;
    persistNow(key).catch((e) => console.error(`DB persist error [${key}]:`, e.message));
  }, PERSIST_DEBOUNCE);
}

async function persistNow(key) {
  if (!mongo) return;
  pendingPersists.delete(key);
  const data = cache[key]; // always write the latest cached state
  if (data === undefined) return;

  // 1. Auto-backup: snapshot the previous version before overwriting.
  try {
    const prev = await mongo.kv.findOne({ _id: key });
    if (prev) {
      await mongo.backups.insertOne({ key, data: prev.data, ts: new Date() });
      // Prune old backups, keep only the most recent BACKUP_LIMIT per key.
      const stale = await mongo.backups
        .find({ key }, { projection: { _id: 1 } })
        .sort({ ts: -1 })
        .skip(BACKUP_LIMIT)
        .toArray();
      if (stale.length) {
        await mongo.backups.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
      }
    }
  } catch (e) {
    console.error(`DB backup error [${key}]:`, e.message);
  }

  // 2. Upsert the new value.
  await mongo.kv.updateOne(
    { _id: key },
    { $set: { data, updatedAt: new Date() } },
    { upsert: true }
  );
}

module.exports = { init, flush, close, read, write, USE_DB, isReady: () => ready };
