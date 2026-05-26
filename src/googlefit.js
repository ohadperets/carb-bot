const config = require('./config');
const storage = require('./storage');

const SCOPES = ['https://www.googleapis.com/auth/fitness.activity.read'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FITNESS_URL = 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate';

function getAuthUrl(userId) {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: String(userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }
  return res.json();
}

async function getValidToken(userId) {
  const tokens = storage.getGoogleTokens(userId);
  if (!tokens) return null;

  // Check if token is expired (with 5 min buffer)
  if (tokens.expiry && Date.now() > tokens.expiry - 300000) {
    try {
      const refreshed = await refreshAccessToken(tokens.refresh_token);
      const updated = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry: Date.now() + (refreshed.expires_in * 1000),
      };
      storage.saveGoogleTokens(userId, updated);
      return updated.access_token;
    } catch (err) {
      console.error(`Token refresh failed for ${userId}:`, err.message);
      return null;
    }
  }
  return tokens.access_token;
}

async function fetchSteps(userId, date) {
  const token = await getValidToken(userId);
  if (!token) return null;

  // Build time range for the given date (Israel timezone)
  const startDate = new Date(`${date}T00:00:00+03:00`);
  const endDate = new Date(`${date}T23:59:59+03:00`);

  const body = {
    aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
    bucketByTime: { durationMillis: 86400000 },
    startTimeMillis: startDate.getTime(),
    endTimeMillis: endDate.getTime(),
  };

  const res = await fetch(FITNESS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`Fitness API error for ${userId}:`, err);
    return null;
  }

  const data = await res.json();
  let steps = 0;
  if (data.bucket) {
    for (const bucket of data.bucket) {
      for (const dataset of bucket.dataset) {
        for (const point of dataset.point) {
          for (const val of point.value) {
            steps += val.intVal || 0;
          }
        }
      }
    }
  }

  // Debug log
  console.log(`Fitness API response for ${userId}/${date}:`, JSON.stringify(data).slice(0, 500));
  console.log(`Steps parsed: ${steps}`);

  // Save to storage
  storage.saveSteps(userId, date, steps);
  return steps;
}

async function fetchTodaySteps(userId) {
  const today = storage.getTodayKey();
  return fetchSteps(userId, today);
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  fetchSteps,
  fetchTodaySteps,
};
