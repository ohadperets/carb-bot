const path = require('path');

const env = process.env.NODE_ENV || 'production';
require('dotenv').config({ path: path.join(__dirname, '..', env === 'test' ? '.env.test' : '.env') });

const config = {
  botToken: process.env.BOT_TOKEN,
  dataDir: path.join(__dirname, '..', env === 'test' ? 'data-test' : 'data'),
  githubToken: process.env.GITHUB_TOKEN,
  githubRepo: process.env.GITHUB_REPO || 'ohadperets/carb-bot',
};

module.exports = config;
