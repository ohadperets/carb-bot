process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const config = require('./config');
const storage = require('./storage');

if (!config.botToken) {
  console.error('ERROR: BOT_TOKEN is not set');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// Track users waiting for input (userId -> state)
const userStates = {};

// ─── Track group chats ────────────────────────────────────
bot.use((ctx, next) => {
  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
    storage.saveGroup(ctx.chat.id);
  }
  return next();
});

// ─── /start - Onboarding ─────────────────────────────────
bot.start((ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (user) {
    const status = storage.getTodayStatus(ctx.from.id);
    ctx.reply(
      `שלום ${ctx.from.first_name}! 👋\n\n` +
      `המגבלה היומית שלך: ${user.dailyLimit} מנות\n` +
      `סטטוס היום: ${status.total}/${status.limit}\n\n` +
      `פשוט שלח את שם המאכל (למשל "פיתה" או "2 בננות")\n\n` +
      `📋 פקודות:\n` +
      `/status - סטטוס יומי\n` +
      `/limit - שנה מגבלה יומית\n` +
      `/reset - אפס את היום`
    );
  } else {
    userStates[ctx.from.id] = { action: 'set_limit' };
    ctx.reply(
      `שלום ${ctx.from.first_name}! 👋\n\n` +
      `אני בוט שעוקב אחרי מנות הפחמימה שלך.\n` +
      `כלל: 1 מנת פחמימה = 15 גרם פחמימה\n\n` +
      `כמה מנות פחמימה מותרות לך ביום? (שלח מספר)`
    );
  }
});

// ─── /status ──────────────────────────────────────────────
bot.command('status', (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  const status = storage.getTodayStatus(ctx.from.id);
  ctx.reply(formatStatus(ctx.from.first_name, status));
});

// ─── /limit ───────────────────────────────────────────────
bot.command('limit', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const user = storage.getUser(ctx.from.id);
    ctx.reply(
      `המגבלה היומית שלך: ${user ? user.dailyLimit : '?'} מנות\n` +
      `לשינוי: /limit <מספר>`
    );
    return;
  }
  const newLimit = parseFloat(args[1]);
  if (isNaN(newLimit) || newLimit < 1 || newLimit > 50) {
    ctx.reply('❌ מספר לא תקין (1-50)');
    return;
  }
  storage.setUserLimit(ctx.from.id, newLimit);
  ctx.reply(`✅ המגבלה שונתה ל-${newLimit} מנות.`);
});

// ─── /reset ───────────────────────────────────────────────
bot.command('reset', (ctx) => {
  if (!storage.getUser(ctx.from.id)) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }
  storage.resetToday(ctx.from.id);
  ctx.reply('🔄 הנתונים של היום אופסו.');
});

// ─── Handle all text messages (food input) ────────────────
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Skip commands
  if (text.startsWith('/')) return;

  // Check if user is registered
  const user = storage.getUser(userId);
  if (!user) {
    // Check if waiting for limit setup
    if (userStates[userId]?.action === 'set_limit') {
      const limit = parseFloat(text);
      if (isNaN(limit) || limit < 1 || limit > 50) {
        ctx.reply('❌ שלח מספר בין 1 ל-50');
        return;
      }
      storage.createUser(userId, ctx.from.first_name, limit);
      delete userStates[userId];
      ctx.reply(
        `✅ מעולה! המגבלה היומית שלך: ${limit} מנות.\n\n` +
        `עכשיו פשוט שלח את שם המאכל שאכלת.\n` +
        `למשל: "פיתה", "2 בננות", "3 משולשי פיצה"`
      );
      return;
    }
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  // Check if waiting for portions for new food
  if (userStates[userId]?.action === 'add_food_portions') {
    const portions = parseFloat(text);
    if (isNaN(portions) || portions <= 0 || portions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0.5-50)');
      return;
    }
    const foodName = userStates[userId].foodName;
    const quantity = userStates[userId].quantity;
    storage.addFood(foodName, portions);
    delete userStates[userId];

    // Now add it to today's count
    const totalPortions = portions * quantity;
    const status = storage.getTodayStatus(userId);

    // Over-limit warning
    if (status.total + totalPortions > status.limit) {
      const willBe = status.total + totalPortions;
      ctx.reply(
        `⚠️ אזהרה! אם תאכל ${quantity > 1 ? quantity + ' ' : ''}${foodName} (${totalPortions} מנות) תגיע ל-${willBe}/${status.limit} מנות!\n\n` +
        `להוסיף בכל זאת? שלח "כן" או "לא"`
      );
      userStates[userId] = { action: 'confirm_over', foodName, portions: totalPortions };
      return;
    }

    storage.addPortions(userId, foodName, totalPortions);
    const newStatus = storage.getTodayStatus(userId);
    ctx.reply(
      `✅ נוסף: ${foodName} = ${portions} מנות (שמרתי למאגר)\n` +
      formatQuickStatus(newStatus)
    );
    return;
  }

  // Check if confirming over-limit
  if (userStates[userId]?.action === 'confirm_over') {
    if (text === 'כן' || text.toLowerCase() === 'yes' || text === 'כ') {
      const { foodName, portions } = userStates[userId];
      storage.addPortions(userId, foodName, portions);
      const newStatus = storage.getTodayStatus(userId);
      delete userStates[userId];
      ctx.reply(`✅ נוסף: ${foodName} (${portions} מנות)\n` + formatQuickStatus(newStatus));
    } else {
      delete userStates[userId];
      ctx.reply('👍 ביטלתי. לא נוסף.');
    }
    return;
  }

  // ─── Parse food input ─────────────────────────────────
  const { quantity, foodName } = parseInput(text);

  // Look up food in DB
  const food = storage.findFood(foodName);

  if (food) {
    const totalPortions = food.portions * quantity;
    const status = storage.getTodayStatus(userId);

    // Over-limit warning
    if (status.total + totalPortions > status.limit) {
      const willBe = status.total + totalPortions;
      ctx.reply(
        `⚠️ אזהרה! ${quantity > 1 ? quantity + ' ' : ''}${food.name} = ${totalPortions} מנות.\n` +
        `אתה על ${status.total}/${status.limit}, תגיע ל-${willBe}!\n\n` +
        `להוסיף בכל זאת? שלח "כן" או "לא"`
      );
      userStates[userId] = { action: 'confirm_over', foodName: food.name, portions: totalPortions };
      return;
    }

    storage.addPortions(userId, food.name, totalPortions);
    const newStatus = storage.getTodayStatus(userId);
    ctx.reply(
      `✅ ${quantity > 1 ? quantity + ' × ' : ''}${food.name} = ${totalPortions} מנות\n` +
      formatQuickStatus(newStatus)
    );
  } else {
    // Unknown food - ask for portions
    userStates[userId] = { action: 'add_food_portions', foodName, quantity };
    ctx.reply(
      `🆕 לא מכיר את "${foodName}".\n` +
      `כמה מנות פחמימה זה? (1 מנה = 15 גרם פחמימה)`
    );
  }
});

// ─── Helpers ──────────────────────────────────────────────
function parseInput(text) {
  // Match patterns like "3 בננות", "2 פיתות", or just "פיתה"
  const match = text.match(/^(\d+\.?\d*)\s+(.+)$/);
  if (match) {
    return { quantity: parseFloat(match[1]), foodName: match[2].trim() };
  }
  return { quantity: 1, foodName: text };
}

function formatStatus(firstName, status) {
  const progress = Math.min(status.total / status.limit, 1);
  const filled = Math.round(progress * 10);
  const empty = 10 - filled;
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);

  let msg = `📊 ${firstName} - סטטוס יומי\n\n`;
  msg += `${bar} ${Math.round(progress * 100)}%\n`;
  msg += `נצרך: ${status.total}/${status.limit} מנות\n`;
  msg += `נשאר: ${Math.max(0, status.remaining)} מנות\n`;

  if (status.entries.length > 0) {
    msg += `\n📝 היום:\n`;
    status.entries.forEach((e) => {
      msg += `  ${e.time} • ${e.item} (${e.portions})\n`;
    });
  }

  if (status.remaining <= 0) {
    msg += `\n🚫 עברת את המגבלה!`;
  } else if (status.remaining <= 2) {
    msg += `\n⚡ כמעט הגעת למגבלה!`;
  }

  return msg;
}

function formatQuickStatus(status) {
  const emoji = status.remaining <= 0 ? '🚫' : status.remaining <= 2 ? '⚡' : '📊';
  return `${emoji} סה"כ: ${status.total}/${status.limit} | נשאר: ${Math.max(0, status.remaining)}`;
}

// ─── Scheduled status every 4 hours (8,12,16,20) ─────────
cron.schedule('0 8,12,16,20 * * *', async () => {
  const groups = storage.getGroups();
  const usersStatus = storage.getAllUsersStatus();

  if (usersStatus.length === 0) return;

  let msg = '📊 עדכון סטטוס:\n\n';
  usersStatus.forEach((u) => {
    const emoji = u.remaining <= 0 ? '🚫' : u.remaining <= 2 ? '⚡' : '✅';
    msg += `${emoji} ${u.firstName}: ${u.total}/${u.limit} (נשאר: ${Math.max(0, u.remaining)})\n`;
  });

  for (const chatId of groups) {
    try {
      await bot.telegram.sendMessage(chatId, msg);
    } catch (err) {
      console.error(`Failed to send status to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Daily report at 23:00 ────────────────────────────────
cron.schedule('0 23 * * *', async () => {
  const groups = storage.getGroups();
  const usersStatus = storage.getAllUsersStatus();

  if (usersStatus.length === 0) return;

  let msg = '📋 דוח יומי - סיכום:\n\n';
  usersStatus.forEach((u) => {
    const emoji = u.success ? '🏆' : '❌';
    const verdict = u.success ? 'עמד/ה במגבלה!' : `חרג/ה ב-${u.total - u.limit} מנות`;
    msg += `${emoji} ${u.firstName}: ${u.total}/${u.limit} - ${verdict}\n`;
  });

  for (const chatId of groups) {
    try {
      await bot.telegram.sendMessage(chatId, msg);
    } catch (err) {
      console.error(`Failed to send report to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Error handling ───────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// ─── Launch (manual polling for TLS compatibility) ────────
const API_BASE = `https://api.telegram.org/bot${config.botToken}`;
let offset = 0;

async function poll() {
  try {
    const res = await fetch(`${API_BASE}/getUpdates?timeout=10&offset=${offset}`);
    const data = await res.json();
    if (data.ok && data.result.length > 0) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        try {
          await bot.handleUpdate(update);
        } catch (err) {
          console.error('Error handling update:', err.message);
        }
      }
    }
  } catch (err) {
    console.error('Polling error:', err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
  poll();
}

async function start() {
  const meRes = await fetch(`${API_BASE}/getMe`);
  const meData = await meRes.json();
  if (!meData.ok) throw new Error('getMe failed: ' + JSON.stringify(meData));
  bot.botInfo = meData.result;
  console.log(`Bot: @${bot.botInfo.username}`);

  const res = await fetch(`${API_BASE}/deleteWebhook?drop_pending_updates=true`);
  await res.json();
  console.log('✅ Bot polling started');
  poll();
}

start().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
