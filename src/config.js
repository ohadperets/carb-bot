require('dotenv').config();

const config = {
  botToken: process.env.BOT_TOKEN,
  dataDir: require('path').join(__dirname, '..', 'data'),
};

module.exports = config;
