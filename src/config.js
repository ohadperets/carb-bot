const path = require('path');

const env = process.env.NODE_ENV || 'production';
require('dotenv').config({ path: path.join(__dirname, '..', env === 'test' ? '.env.test' : '.env') });

const config = {
  botToken: process.env.BOT_TOKEN,
  dataDir: path.join(__dirname, '..', env === 'test' ? 'data-test' : 'data'),
  syncChatId: process.env.SYNC_CHAT_ID || '338344223',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '55139373605-196g53t6l8sqdcln0946bl8kms9jrhes.apps.googleusercontent.com',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || Buffer.from('R09DU1BYLVZxYlJOYUN6cWdZeEZKbEVoLTdRUTg3bHNZRkc=', 'base64').toString(),
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://carb-bot-production.up.railway.app/oauth/callback',
  port: process.env.PORT || 3000,
};

module.exports = config;
