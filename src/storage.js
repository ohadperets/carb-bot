const fs = require('fs');
const path = require('path');
const config = require('./config');
const datastore = require('./datastore');
const { INITIAL_FOODS } = require('./carbs');

const USERS_FILE = path.join(config.dataDir, 'users.json');
const FOODS_FILE = path.join(config.dataDir, 'foods.json');
const GROUPS_FILE = path.join(config.dataDir, 'groups.json');
const KNOWN_USERS_FILE = path.join(config.dataDir, 'known_users.json');

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

// ─── Telegram-based sync (debounced) ───────────────────────
let syncTimer = null;
const SYNC_DELAY = 10000; // 10 seconds debounce
const API_BASE = `https://api.telegram.org/bot${config.botToken}`;

// ─── Per-user backup (debounced) ────────────────────────────
const userBackupTimers = {};
const USER_BACKUP_DELAY = 10000;

function scheduleUserBackup(userId) {
  if (datastore.USE_DB) return; // DB is the source of truth — no Telegram backup
  if (!config.botToken) return;
  if (userBackupTimers[userId]) clearTimeout(userBackupTimers[userId]);
  userBackupTimers[userId] = setTimeout(() => backupUserToTelegram(userId), USER_BACKUP_DELAY);
}

async function backupUserToTelegram(userId) {
  if (datastore.USE_DB) return;
  try {
    const data = loadUsers();
    if (!data[userId]) return;

    const payload = { [userId]: data[userId] };
    const jsonContent = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const formData = new FormData();
    formData.append('chat_id', userId);
    formData.append('document', blob, 'my_data.json');
    formData.append('disable_notification', 'true');

    const sendRes = await fetch(`${API_BASE}/sendDocument`, { method: 'POST', body: formData });
    if (!sendRes.ok) return;
    const { result } = await sendRes.json();

    await fetch(`${API_BASE}/unpinAllChatMessages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId }),
    });
    await fetch(`${API_BASE}/pinChatMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, message_id: result.message_id, disable_notification: true }),
    });
    console.log(`💾 Backed up data for user ${userId}`);
  } catch (err) {
    console.error(`User backup error (${userId}):`, err.message);
  }
}

async function restoreUserFromTelegram(userId) {
  if (datastore.USE_DB) return false;
  try {
    const chatRes = await fetch(`${API_BASE}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId }),
    });
    if (!chatRes.ok) return false;
    const { result: chat } = await chatRes.json();
    if (!chat.pinned_message?.document) return false;

    const fileRes = await fetch(`${API_BASE}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: chat.pinned_message.document.file_id }),
    });
    if (!fileRes.ok) return false;
    const { result: fileInfo } = await fileRes.json();

    const dlRes = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${fileInfo.file_path}`);
    if (!dlRes.ok) return false;
    const backup = await dlRes.json();

    if (!backup[userId]) return false;

    const data = loadUsers();
    data[userId] = backup[userId];
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log(`📥 Restored user ${userId} from personal backup`);
    return true;
  } catch (err) {
    console.error(`User restore error (${userId}):`, err.message);
    return false;
  }
}

function scheduleSyncToCloud() {
  if (datastore.USE_DB) return; // DB is the source of truth — no Telegram central backup
  if (!config.botToken || !config.syncChatId) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToCloud(), SYNC_DELAY);
}

async function syncToCloud() {
  if (datastore.USE_DB) return 'db mode';
  if (!config.botToken || !config.syncChatId) {
    return 'no config';
  }
  try {
    // Combine all data into one JSON
    const payload = {};
    const files = ['foods.json', 'users.json', 'groups.json'];
    for (const file of files) {
      const filePath = path.join(config.dataDir, file);
      if (fs.existsSync(filePath)) {
        payload[file.replace('.json', '')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }

    const jsonContent = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const formData = new FormData();
    formData.append('chat_id', config.syncChatId);
    formData.append('document', blob, 'backup.json');
    formData.append('caption', `🔄 backup ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`);
    formData.append('disable_notification', 'true');

    // Send backup file
    const sendRes = await fetch(`${API_BASE}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
    if (!sendRes.ok) {
      const err = await sendRes.text();
      throw new Error(`sendDocument: ${err}`);
    }
    const { result } = await sendRes.json();

    // Unpin previous and pin new backup
    await fetch(`${API_BASE}/unpinAllChatMessages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.syncChatId }),
    });
    await fetch(`${API_BASE}/pinChatMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.syncChatId, message_id: result.message_id, disable_notification: true }),
    });

    console.log('✅ Data synced to Telegram');
    return 'ok';
  } catch (err) {
    console.error('Telegram sync error:', err.message);
    return `error: ${err.message}`;
  }
}

// ─── Pull data from Telegram on startup ─────────────────────
async function pullFromCloud() {
  if (datastore.USE_DB) return; // DB is the source of truth — nothing to pull from Telegram
  if (!config.botToken) return;

  // 1. Try central backup first (if SYNC_CHAT_ID is configured)
  if (config.syncChatId) {
    try {
      const chatRes = await fetch(`${API_BASE}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.syncChatId }),
      });
      if (chatRes.ok) {
        const { result: chat } = await chatRes.json();
        if (chat.pinned_message?.document) {
          const fileId = chat.pinned_message.document.file_id;
          const fileRes = await fetch(`${API_BASE}/getFile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId }),
          });
          if (fileRes.ok) {
            const { result: fileInfo } = await fileRes.json();
            const downloadRes = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${fileInfo.file_path}`);
            if (downloadRes.ok) {
              const data = await downloadRes.json();
              const mapping = { foods: 'foods.json', users: 'users.json', groups: 'groups.json' };
              for (const [key, file] of Object.entries(mapping)) {
                if (data[key]) {
                  const localPath = path.join(config.dataDir, file);
                  fs.writeFileSync(localPath, JSON.stringify(data[key], null, 2), 'utf8');
                  console.log(`📥 Restored ${file} from central Telegram backup`);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Central Telegram pull error:', err.message);
    }
  }

  // 2. Per-user backup: restore every known user, even if absent from the local file.
  //    Known IDs come from the persistent registry UNION the current local file,
  //    so a wiped/empty users.json no longer means "nobody to restore".
  const localIds = Object.keys(loadUsers());
  const knownIds = Array.from(new Set([...loadKnownUsers(), ...localIds]));
  if (knownIds.length > 0) {
    console.log(`🔄 Attempting per-user restore for ${knownIds.length} known user(s)...`);
    for (const userId of knownIds) {
      await restoreUserFromTelegram(userId);
    }
  }
}

// ─── Known-users registry (survives a users.json reset) ───────
function loadKnownUsers() {
  const ids = datastore.read('known_users', []);
  return Array.isArray(ids) ? ids.map(String) : [];
}

function registerKnownUser(userId) {
  if (userId === undefined || userId === null) return;
  const id = String(userId);
  const ids = loadKnownUsers();
  if (!ids.includes(id)) {
    ids.push(id);
    datastore.write('known_users', ids);
  }
}

// ─── Generic file helpers ─────────────────────────────────
function loadJSON(file, defaultVal = {}) {
  if (!fs.existsSync(file)) return defaultVal;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  scheduleSyncToCloud();
}

// ─── Foods DB (shared) ────────────────────────────────────
function loadFoods() {
  const foods = datastore.read('foods', null);
  if (foods === null) {
    // First run - seed with initial foods
    saveFoods(INITIAL_FOODS);
    return { ...INITIAL_FOODS };
  }
  return foods;
}

function saveFoods(foods) {
  datastore.write('foods', foods);
  scheduleSyncToCloud();
}

function _parseFoodEntry(data) {
  if (typeof data === 'number') return { carbs: data, fat: 0, protein: 0 };
  return { carbs: data.carbs ?? 0, fat: data.fat ?? 0, protein: data.protein ?? 0 };
}

function findFood(name) {
  const foods = loadFoods();
  const normalized = name.trim().toLowerCase();

  // Exact match
  for (const [key, data] of Object.entries(foods)) {
    if (key.startsWith('_')) continue;
    if (key.toLowerCase() === normalized) {
      const { carbs, fat, protein } = _parseFoodEntry(data);
      return { name: key, portions: carbs, carbs, fat, protein, matchType: 'exact' };
    }
  }

  // Partial match (input contains a food name or food name contains input)
  let bestMatch = null;
  let bestLength = 0;
  for (const [key, data] of Object.entries(foods)) {
    if (key.startsWith('_')) continue;
    const keyLower = key.toLowerCase();
    if (keyLower.includes(normalized) || normalized.includes(keyLower)) {
      if (key.length > bestLength) {
        const { carbs, fat, protein } = _parseFoodEntry(data);
        bestMatch = { name: key, portions: carbs, carbs, fat, protein, matchType: 'partial' };
        bestLength = key.length;
      }
    }
  }
  return bestMatch;
}

function addFood(name, portions, fat, protein) {
  const foods = loadFoods();
  const existing = foods[name];
  const base = (existing && typeof existing === 'object') ? existing : { carbs: 0, fat: 0, protein: 0 };
  foods[name] = {
    carbs: portions,
    // Keep the previous fat/protein when not supplied (e.g. quick carb-only edits).
    fat:     (fat     !== undefined && fat     !== null) ? fat     : (base.fat     ?? 0),
    protein: (protein !== undefined && protein !== null) ? protein : (base.protein ?? 0),
  };
  saveFoods(foods);
}

function deleteFood(name) {
  const foods = loadFoods();
  if (!(name in foods)) return false;
  delete foods[name];
  saveFoods(foods);
  return true;
}

// ─── Users ────────────────────────────────────────────────
function loadUsers() {
  return datastore.read('users', {});
}

function saveUsers(data) {
  datastore.write('users', data);
  scheduleSyncToCloud();
  for (const uid of Object.keys(data)) {
    registerKnownUser(uid);
    scheduleUserBackup(uid);
  }
}

function getUser(userId) {
  const data = loadUsers();
  return data[userId] || null;
}

function createUser(userId, firstName, dailyLimit, weight) {
  const data = loadUsers();
  data[userId] = {
    firstName: firstName || '',
    dailyLimit,
    weight: weight || 70,
    days: {},
  };
  saveUsers(data);
  return data[userId];
}

function setWeight(userId, kg) {
  const data = loadUsers();
  if (!data[userId]) return false;
  data[userId].weight = kg;
  saveUsers(data);
  return true;
}

// Compute fat + protein totals from an entry list using the foods database.
// Fat: each food entry contributes fat_pts * quantity.
// Protein: same pattern (pts = grams).
// For zero-carb foods (e.g. chicken), each log entry counts as 1 serving.
// Returns a copy of each entry annotated with its own fat + protein contribution.
function enrichEntries(entries) {
  const foods = loadFoods();
  return entries.map(entry => {
    // Prefer the snapshot captured on the entry at log time — it is stable and
    // immune to later food edits / partial-match lookups.
    if (entry.fat !== undefined && entry.protein !== undefined) {
      return { ...entry, fat: entry.fat, protein: entry.protein };
    }
    const food = foods[entry.item];
    if (!food || typeof food !== 'object') {
      return { ...entry, fat: 0, protein: 0 };
    }
    const carbs    = food.carbs || 0;
    const quantity = carbs > 0 ? entry.portions / carbs : 1;
    return {
      ...entry,
      fat:     Math.round((food.fat     || 0) * quantity * 10) / 10,
      protein: Math.round((food.protein || 0) * quantity * 10) / 10,
    };
  });
}

function computeDayNutrition(entries) {
  let fatTotal = 0, proteinTotal = 0;
  for (const entry of enrichEntries(entries)) {
    fatTotal     += entry.fat;
    proteinTotal += entry.protein;
  }
  return {
    fatTotal:     Math.round(fatTotal     * 10) / 10,
    proteinTotal: Math.round(proteinTotal * 10) / 10,
  };
}

function getTodayKey() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addPortions(userId, itemName, portions, quantity) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  if (!user.days[today]) {
    user.days[today] = { entries: [], total: 0 };
  }

  const entry = {
    item: itemName,
    portions,
    time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' }),
  };

  // Snapshot fat + protein at log time from the foods database so the daily
  // totals always count them (even for zero-carb foods) and stay stable if the
  // food is later edited. `quantity` = number of servings eaten; when omitted
  // we recover it from portions / carbs.
  const foods = loadFoods();
  const food = foods[itemName];
  if (food && typeof food === 'object') {
    const carbs = food.carbs || 0;
    const qty = (quantity !== undefined && quantity !== null)
      ? quantity
      : (carbs > 0 ? portions / carbs : 1);
    entry.fat     = Math.round((food.fat     || 0) * qty * 10) / 10;
    entry.protein = Math.round((food.protein || 0) * qty * 10) / 10;
  }

  user.days[today].entries.push(entry);
  user.days[today].total += portions;
  saveUsers(data);

  return user.days[today];
}

const FAT_LIMIT = 8;

function getTodayStatus(userId) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  const dayData = user.days[today] || { entries: [], total: 0 };
  const entries = enrichEntries(dayData.entries);
  const { fatTotal, proteinTotal } = computeDayNutrition(dayData.entries);
  const weightSet   = !!user.weight;
  const proteinGoal = user.weight || 70;

  return {
    total:         dayData.total,
    remaining:     user.dailyLimit - dayData.total,
    limit:         user.dailyLimit,
    entries,
    fatTotal,
    fatLimit:      FAT_LIMIT,
    fatRemaining:  Math.max(0, FAT_LIMIT - fatTotal),
    proteinTotal,
    proteinGoal,
    weightSet,
  };
}

function getAllUsersStatus() {
  const data = loadUsers();
  const results = [];
  const today = getTodayKey();

  for (const [userId, user] of Object.entries(data)) {
    const dayData = user.days[today] || { entries: [], total: 0 };
    const { fatTotal, proteinTotal } = computeDayNutrition(dayData.entries);
    const weightSet   = !!user.weight;
    const proteinGoal = user.weight || 70;
    results.push({
      userId,
      firstName:    user.firstName,
      total:        dayData.total,
      limit:        user.dailyLimit,
      remaining:    user.dailyLimit - dayData.total,
      success:      dayData.total <= user.dailyLimit,
      entries:      dayData.entries,
      fatTotal,
      fatLimit:     FAT_LIMIT,
      proteinTotal,
      proteinGoal,
      weightSet,
    });
  }
  return results;
}

function setUserLimit(userId, newLimit) {
  const data = loadUsers();
  if (!data[userId]) return false;
  data[userId].dailyLimit = newLimit;
  saveUsers(data);
  return true;
}

function deleteEntry(userId, index) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  const dayData = user.days[today];
  if (!dayData || !dayData.entries[index]) return null;

  const removed = dayData.entries.splice(index, 1)[0];
  dayData.total -= removed.portions;
  saveUsers(data);
  return removed;
}

function editEntry(userId, index, newPortions) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  const dayData = user.days[today];
  if (!dayData || !dayData.entries[index]) return null;

  const entry = dayData.entries[index];
  const diff = newPortions - entry.portions;
  entry.portions = newPortions;
  dayData.total += diff;
  saveUsers(data);
  return entry;
}

function getAllFoods() {
  return loadFoods();
}

function resetToday(userId) {
  const data = loadUsers();
  if (!data[userId]) return false;
  const today = getTodayKey();
  data[userId].days[today] = { entries: [], total: 0 };
  if (data[userId].water && data[userId].water[today]) {
    data[userId].water[today] = 0;
  }
  saveUsers(data);
  return true;
}

// ─── Water tracking ──────────────────────────────────────
function addWater(userId, ml) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  if (!user.water) user.water = {};
  if (!user.waterLimit) user.waterLimit = 2000;

  const today = getTodayKey();
  user.water[today] = Math.max(0, (user.water[today] || 0) + ml);
  saveUsers(data);
  return { total: user.water[today], limit: user.waterLimit };
}

function resetWater(userId) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return false;

  const today = getTodayKey();
  if (!user.water) user.water = {};
  user.water[today] = 0;
  saveUsers(data);
  return true;
}

function getWaterStatus(userId) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  const total = (user.water && user.water[today]) || 0;
  const limit = user.waterLimit || 2000;
  return { total, limit, remaining: limit - total };
}

function setWaterLimit(userId, ml) {
  const data = loadUsers();
  if (!data[userId]) return false;
  data[userId].waterLimit = ml;
  saveUsers(data);
  return true;
}

function getAllUsersWaterStatus() {
  const data = loadUsers();
  const results = [];
  const today = getTodayKey();

  for (const [userId, user] of Object.entries(data)) {
    const total = (user.water && user.water[today]) || 0;
    const limit = user.waterLimit || 2000;
    results.push({
      userId,
      firstName: user.firstName,
      total,
      limit,
      remaining: limit - total,
      success: total >= limit,
    });
  }
  return results;
}

// ─── Groups (for scheduled messages) ─────────────────────
function saveGroup(chatId) {
  const groups = datastore.read('groups', []);
  if (!groups.includes(chatId)) {
    groups.push(chatId);
    datastore.write('groups', groups);
    scheduleSyncToCloud();
  }
}

function getGroups() {
  return datastore.read('groups', []);
}

// ─── Period reports (weekly / monthly) ───────────────────
function getDateRange(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

function getUserPeriodStats(userId, days) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const dates = getDateRange(days);
  const dailyStats = [];
  let totalPortions = 0;
  let totalWater = 0;
  let daysInLimit = 0;
  let daysWaterGoal = 0;

  for (const date of dates) {
    const dayData = user.days[date] || { entries: [], total: 0 };
    const water = (user.water && user.water[date]) || 0;
    const inLimit = dayData.total <= user.dailyLimit;
    const waterGoal = water >= (user.waterLimit || 2000);

    if (inLimit) daysInLimit++;
    if (waterGoal) daysWaterGoal++;
    totalPortions += dayData.total;
    totalWater += water;

    dailyStats.push({
      date,
      total: dayData.total,
      limit: user.dailyLimit,
      inLimit,
      water,
      waterLimit: user.waterLimit || 2000,
      waterGoal,
      entries: dayData.entries,
    });
  }

  return {
    firstName: user.firstName,
    userId,
    days: dailyStats,
    totalPortions,
    totalWater,
    avgPortions: Math.round((totalPortions / dates.length) * 10) / 10,
    avgWater: Math.round(totalWater / dates.length),
    daysInLimit,
    daysWaterGoal,
    totalDays: dates.length,
    limit: user.dailyLimit,
    waterLimit: user.waterLimit || 2000,
  };
}

function getAllUsersPeriodStats(days) {
  const data = loadUsers();
  const results = [];
  for (const userId of Object.keys(data)) {
    const stats = getUserPeriodStats(userId, days);
    if (stats) results.push(stats);
  }
  return results;
}

// ─── Google Fit tokens ───────────────────────────────────
function saveGoogleTokens(userId, tokens) {
  const data = loadUsers();
  if (!data[userId]) return false;
  data[userId].googleTokens = tokens;
  saveUsers(data);
  return true;
}

function getGoogleTokens(userId) {
  const data = loadUsers();
  if (!data[userId]) return null;
  return data[userId].googleTokens || null;
}

// ─── Steps tracking ─────────────────────────────────────
function saveSteps(userId, date, steps) {
  const data = loadUsers();
  if (!data[userId]) return false;
  if (!data[userId].steps) data[userId].steps = {};
  data[userId].steps[date] = steps;
  saveUsers(data);
  return true;
}

function getSteps(userId, date) {
  const data = loadUsers();
  if (!data[userId] || !data[userId].steps) return 0;
  return data[userId].steps[date] || 0;
}

function getStepsGoal(userId) {
  const data = loadUsers();
  if (!data[userId]) return 10000;
  return data[userId].stepsGoal || 10000;
}

function setStepsGoal(userId, goal) {
  const data = loadUsers();
  if (!data[userId]) return false;
  data[userId].stepsGoal = goal;
  saveUsers(data);
  return true;
}

module.exports = {
  loadUsers,
  loadKnownUsers,
  registerKnownUser,
  findFood,
  addFood,
  deleteFood,
  getAllFoods,
  getUser,
  createUser,
  setWeight,
  computeDayNutrition,
  addPortions,
  getTodayStatus,
  getAllUsersStatus,
  setUserLimit,
  deleteEntry,
  editEntry,
  resetToday,
  getTodayKey,
  saveGroup,
  getGroups,
  addWater,
  resetWater,
  getWaterStatus,
  setWaterLimit,
  getAllUsersWaterStatus,
  getAllUsersPeriodStats,
  saveGoogleTokens,
  getGoogleTokens,
  saveSteps,
  getSteps,
  getStepsGoal,
  setStepsGoal,
  pullFromCloud,
  syncToCloud,
  restoreUserFromTelegram,
  backupUserToTelegram,
};
