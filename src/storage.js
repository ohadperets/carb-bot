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

// ─── Generic file helpers ─────────────────────────────────
function loadJSON(file, defaultVal = {}) {
  if (!fs.existsSync(file)) return defaultVal;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
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
};
