require('dotenv').config();

console.log('ENV check - BOT_TOKEN exists:', !!process.env.BOT_TOKEN);

const config = {
  botToken: process.env.BOT_TOKEN,
  dataDir: require('path').join(__dirname, '..', 'data'),

  // Allowed Telegram user IDs (only these users can interact with the bot)
  allowedUsers: {
    338344223: 'Ohad',
    6316115350: 'Adi',
  },

  // Default daily portion limits per user ID
  defaultLimits: {
    338344223: 10,   // Ohad
    6316115350: 7,   // Adi
  },

  // Default limit for unregistered users
  defaultLimit: 8,
};

module.exports = config;
