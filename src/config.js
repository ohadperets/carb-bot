const path = require('path');

const env = process.env.NODE_ENV || 'production';
require('dotenv').config({ path: path.join(__dirname, '..', env === 'test' ? '.env.test' : '.env') });

const config = {
  botToken: process.env.BOT_TOKEN,
  dataDir: path.join(__dirname, '..', env === 'test' ? 'data-test' : 'data'),
  syncChatId: process.env.SYNC_CHAT_ID || '338344223', // owner's chat for backup  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://carb-bot-production.up.railway.app/oauth/callback',
  port: process.env.PORT || 3000,};

module.exports = config;
