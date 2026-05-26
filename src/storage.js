const fs = require('fs');
const path = require('path');
const config = require('./config');
const { INITIAL_FOODS } = require('./carbs');

const USERS_FILE = path.join(config.dataDir, 'users.json');
const FOODS_FILE = path.join(config.dataDir, 'foods.json');
const GROUPS_FILE = path.join(config.dataDir, 'groups.json');

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

// ─── Telegram-based sync (debounced) ───────────────────────
let syncTimer = null;
const SYNC_DELAY = 10000; // 10 seconds debounce
const API_BASE = `https://api.telegram.org/bot${config.botToken}`;

function scheduleSyncToCloud() {
  if (!config.botToken || !config.syncChatId) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncToCloud(), SYNC_DELAY);
}

async function syncToCloud() {
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
  if (!config.botToken || !config.syncChatId) return;
  try {
    // Get pinned message from chat
    const chatRes = await fetch(`${API_BASE}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.syncChatId }),
    });
    if (!chatRes.ok) return;
    const { result: chat } = await chatRes.json();
    if (!chat.pinned_message || !chat.pinned_message.document) return;

    // Download the backup file
    const fileId = chat.pinned_message.document.file_id;
    const fileRes = await fetch(`${API_BASE}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!fileRes.ok) return;
    const { result: fileInfo } = await fileRes.json();

    const downloadRes = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${fileInfo.file_path}`);
    if (!downloadRes.ok) return;
    const data = await downloadRes.json();

    // Restore files
    const mapping = { foods: 'foods.json', users: 'users.json', groups: 'groups.json' };
    for (const [key, file] of Object.entries(mapping)) {
      if (data[key]) {
        const localPath = path.join(config.dataDir, file);
        fs.writeFileSync(localPath, JSON.stringify(data[key], null, 2), 'utf8');
        console.log(`📥 Restored ${file} from Telegram backup`);
      }
    }
  } catch (err) {
    console.error('Telegram pull error:', err.message);
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
  const foods = loadJSON(FOODS_FILE, null);
  if (foods === null) {
    // First run - seed with initial foods
    saveJSON(FOODS_FILE, INITIAL_FOODS);
    return { ...INITIAL_FOODS };
  }
  return foods;
}

function findFood(name) {
  const foods = loadFoods();
  const normalized = name.trim().toLowerCase();

  // Exact match
  for (const [key, portions] of Object.entries(foods)) {
    if (key.toLowerCase() === normalized) {
      return { name: key, portions };
    }
  }

  // Partial match (input contains a food name or food name contains input)
  let bestMatch = null;
  let bestLength = 0;
  for (const [key, portions] of Object.entries(foods)) {
    const keyLower = key.toLowerCase();
    if (keyLower.includes(normalized) || normalized.includes(keyLower)) {
      if (key.length > bestLength) {
        bestMatch = { name: key, portions };
        bestLength = key.length;
      }
    }
  }
  return bestMatch;
}

function addFood(name, portions) {
  const foods = loadFoods();
  foods[name] = portions;
  saveJSON(FOODS_FILE, foods);
}

function deleteFood(name) {
  const foods = loadFoods();
  if (!(name in foods)) return false;
  delete foods[name];
  saveJSON(FOODS_FILE, foods);
  return true;
}

// ─── Users ────────────────────────────────────────────────
function loadUsers() {
  return loadJSON(USERS_FILE);
}

function saveUsers(data) {
  saveJSON(USERS_FILE, data);
}

function getUser(userId) {
  const data = loadUsers();
  return data[userId] || null;
}

function createUser(userId, firstName, dailyLimit) {
  const data = loadUsers();
  data[userId] = {
    firstName: firstName || '',
    dailyLimit,
    days: {},
  };
  saveUsers(data);
  return data[userId];
}

function getTodayKey() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addPortions(userId, itemName, portions) {
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

  user.days[today].entries.push(entry);
  user.days[today].total += portions;
  saveUsers(data);

  return user.days[today];
}

function getTodayStatus(userId) {
  const data = loadUsers();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  const dayData = user.days[today] || { entries: [], total: 0 };

  return {
    total: dayData.total,
    remaining: user.dailyLimit - dayData.total,
    limit: user.dailyLimit,
    entries: dayData.entries,
  };
}

function getAllUsersStatus() {
  const data = loadUsers();
  const results = [];
  const today = getTodayKey();

  for (const [userId, user] of Object.entries(data)) {
    const dayData = user.days[today] || { entries: [], total: 0 };
    results.push({
      userId,
      firstName: user.firstName,
      total: dayData.total,
      limit: user.dailyLimit,
      remaining: user.dailyLimit - dayData.total,
      success: dayData.total <= user.dailyLimit,
      entries: dayData.entries,
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
  const groups = loadJSON(GROUPS_FILE, []);
  if (!groups.includes(chatId)) {
    groups.push(chatId);
    saveJSON(GROUPS_FILE, groups);
  }
}

function getGroups() {
  return loadJSON(GROUPS_FILE, []);
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

module.exports = {
  findFood,
  addFood,
  deleteFood,
  getAllFoods,
  getUser,
  createUser,
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
  pullFromCloud,
  syncToCloud,
};
