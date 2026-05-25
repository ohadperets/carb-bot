const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_FILE = path.join(config.dataDir, 'users.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {};
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getUser(userId) {
  const data = loadData();
  return data[userId] || null;
}

function ensureUser(userId, firstName, username) {
  const data = loadData();
  if (!data[userId]) {
    // Determine limit based on user ID
    const limit = config.defaultLimits[userId] || config.defaultLimit;
    data[userId] = {
      firstName: firstName || '',
      username: username || '',
      dailyLimit: limit,
      days: {},
    };
    saveData(data);
  }
  return data[userId];
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addPortions(userId, itemName, portions) {
  const data = loadData();
  const user = data[userId];
  if (!user) return null;

  const today = getTodayKey();
  if (!user.days[today]) {
    user.days[today] = { entries: [], total: 0 };
  }

  const entry = {
    item: itemName,
    portions,
    time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
  };

  user.days[today].entries.push(entry);
  user.days[today].total += portions;
  saveData(data);

  return user.days[today];
}

function getTodayStatus(userId) {
  const data = loadData();
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

function getHistory(userId, numDays = 7) {
  const data = loadData();
  const user = data[userId];
  if (!user) return null;

  const history = [];
  for (let i = 0; i < numDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayData = user.days[key] || { entries: [], total: 0 };
    history.push({
      date: key,
      total: dayData.total,
      limit: user.dailyLimit,
      entries: dayData.entries,
    });
  }
  return history;
}

function setUserLimit(userId, newLimit) {
  const data = loadData();
  if (!data[userId]) return false;
  data[userId].dailyLimit = newLimit;
  saveData(data);
  return true;
}

function resetToday(userId) {
  const data = loadData();
  if (!data[userId]) return false;
  const today = getTodayKey();
  data[userId].days[today] = { entries: [], total: 0 };
  saveData(data);
  return true;
}

module.exports = {
  ensureUser,
  getUser,
  addPortions,
  getTodayStatus,
  getHistory,
  setUserLimit,
  resetToday,
  getTodayKey,
};
