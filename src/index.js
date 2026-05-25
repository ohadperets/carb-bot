process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const config = require('./config');
const storage = require('./storage');
const { CARB_ITEMS } = require('./carbs');

if (!config.botToken) {
  console.error('ERROR: BOT_TOKEN is not set in .env file');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// ─── Restrict to allowed users only ──────────────────────
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  console.log(`📩 Message from user ${userId} (${ctx.from?.first_name}): ${ctx.message?.text || ctx.callbackQuery?.data || 'no text'}`);
  if (!userId || !config.allowedUsers[userId]) {
    console.log(`🚫 Blocked - user ${userId} not in allowedUsers`);
    return; // Silently ignore unauthorized users
  }
  return next();
});

// ─── /start ───────────────────────────────────────────────
bot.start((ctx) => {
  const user = storage.ensureUser(
    ctx.from.id,
    ctx.from.first_name,
    ctx.from.username
  );
  const status = storage.getTodayStatus(ctx.from.id);

  ctx.reply(
    `שלום ${ctx.from.first_name}! 👋\n\n` +
    `אני הבוט שעוקב אחרי מנות הפחמימה שלך.\n` +
    `המגבלה היומית שלך: ${user.dailyLimit} מנות\n\n` +
    `📋 פקודות:\n` +
    `/add - הוסף מנת פחמימה\n` +
    `/status - סטטוס יומי\n` +
    `/history - היסטוריה\n` +
    `/limit - שנה מגבלה יומית\n` +
    `/reset - אפס את היום`
  );
});

// ─── /add - show food keyboard ────────────────────────────
bot.command('add', (ctx) => {
  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  showFoodKeyboard(ctx);
});

function showFoodKeyboard(ctx, page = 0) {
  const itemsPerPage = 8;
  const start = page * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = CARB_ITEMS.slice(start, end);
  const totalPages = Math.ceil(CARB_ITEMS.length / itemsPerPage);

  const buttons = pageItems.map((item) => [
    Markup.button.callback(
      `${item.emoji} ${item.name} (${item.portions} מנות)`,
      `add_${item.id}`
    ),
  ]);

  // Navigation buttons
  const navRow = [];
  if (page > 0) {
    navRow.push(Markup.button.callback('⬅️ הקודם', `page_${page - 1}`));
  }
  if (end < CARB_ITEMS.length) {
    navRow.push(Markup.button.callback('הבא ➡️', `page_${page + 1}`));
  }
  if (navRow.length > 0) {
    buttons.push(navRow);
  }

  // Custom amount button
  buttons.push([Markup.button.callback('✏️ כמות מותאמת אישית', 'custom_amount')]);

  const keyboard = Markup.inlineKeyboard(buttons);

  const status = storage.getTodayStatus(ctx.from.id);
  const header = `📊 היום: ${status.total}/${status.limit} מנות (נשאר: ${status.remaining})\n\nבחר מה אכלת:`;

  if (ctx.callbackQuery) {
    ctx.editMessageText(header, keyboard);
  } else {
    ctx.reply(header, keyboard);
  }
}

// ─── Handle page navigation ──────────────────────────────
bot.action(/^page_(\d+)$/, (ctx) => {
  const page = parseInt(ctx.match[1]);
  showFoodKeyboard(ctx, page);
  ctx.answerCbQuery();
});

// ─── Handle food selection ────────────────────────────────
bot.action(/^add_(.+)$/, (ctx) => {
  const itemId = ctx.match[1];
  const item = CARB_ITEMS.find((i) => i.id === itemId);
  if (!item) {
    ctx.answerCbQuery('פריט לא נמצא');
    return;
  }

  const dayData = storage.addPortions(ctx.from.id, item.name, item.portions);
  const status = storage.getTodayStatus(ctx.from.id);

  let message = `✅ נוסף: ${item.emoji} ${item.name} (${item.portions} מנות)\n\n`;
  message += `📊 סה"כ היום: ${status.total}/${status.limit} מנות\n`;
  message += `👉 נשאר: ${status.remaining} מנות`;

  if (status.remaining <= 0) {
    message += `\n\n⚠️ הגעת למגבלה היומית!`;
  } else if (status.remaining <= 2) {
    message += `\n\n⚡ כמעט הגעת למגבלה!`;
  }

  ctx.editMessageText(message);
  ctx.answerCbQuery(`${item.name} נוסף!`);
});

// ─── Custom amount ────────────────────────────────────────
bot.action('custom_amount', (ctx) => {
  ctx.editMessageText(
    'שלח לי את מספר המנות שאכלת (אפשר גם מספר עשרוני, למשל 1.5):'
  );
  ctx.answerCbQuery();
});

bot.hears(/^(\d+\.?\d*)$/, (ctx) => {
  const portions = parseFloat(ctx.match[1]);
  if (isNaN(portions) || portions <= 0 || portions > 50) {
    ctx.reply('❌ מספר לא תקין. שלח מספר בין 0.5 ל-50.');
    return;
  }

  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  storage.addPortions(ctx.from.id, 'מותאם אישית', portions);
  const status = storage.getTodayStatus(ctx.from.id);

  let message = `✅ נוסף: ${portions} מנות\n\n`;
  message += `📊 סה"כ היום: ${status.total}/${status.limit} מנות\n`;
  message += `👉 נשאר: ${status.remaining} מנות`;

  if (status.remaining <= 0) {
    message += `\n\n⚠️ הגעת למגבלה היומית!`;
  }

  ctx.reply(message);
});

// ─── /status ──────────────────────────────────────────────
bot.command('status', (ctx) => {
  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const status = storage.getTodayStatus(ctx.from.id);

  let message = `📊 סטטוס יומי - ${ctx.from.first_name}\n\n`;
  message += `מגבלה: ${status.limit} מנות\n`;
  message += `נצרך: ${status.total} מנות\n`;
  message += `נשאר: ${status.remaining} מנות\n`;

  // Progress bar
  const progress = Math.min(status.total / status.limit, 1);
  const filled = Math.round(progress * 10);
  const empty = 10 - filled;
  message += `\n${'🟩'.repeat(filled)}${'⬜'.repeat(empty)} ${Math.round(progress * 100)}%\n`;

  if (status.entries.length > 0) {
    message += `\n📝 מה אכלת היום:\n`;
    status.entries.forEach((entry) => {
      message += `  • ${entry.time} - ${entry.item} (${entry.portions})\n`;
    });
  } else {
    message += `\n✨ עדיין לא אכלת פחמימות היום!`;
  }

  ctx.reply(message);
});

// ─── /history ─────────────────────────────────────────────
bot.command('history', (ctx) => {
  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  const history = storage.getHistory(ctx.from.id, 7);

  let message = `📅 היסטוריה - 7 ימים אחרונים\n\n`;

  const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  history.forEach((day) => {
    const date = new Date(day.date);
    const dayName = dayNames[date.getDay()];
    const status = day.total <= day.limit ? '✅' : '⚠️';
    message += `${status} יום ${dayName} (${day.date}): ${day.total}/${day.limit} מנות\n`;
  });

  ctx.reply(message);
});

// ─── /limit ───────────────────────────────────────────────
bot.command('limit', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const user = storage.getUser(ctx.from.id);
    ctx.reply(
      `המגבלה היומית הנוכחית שלך: ${user ? user.dailyLimit : config.defaultLimit} מנות\n\n` +
      `לשינוי, שלח: /limit <מספר>\n` +
      `לדוגמה: /limit 8`
    );
    return;
  }

  const newLimit = parseInt(args[1]);
  if (isNaN(newLimit) || newLimit < 1 || newLimit > 50) {
    ctx.reply('❌ מספר לא תקין. בחר מספר בין 1 ל-50.');
    return;
  }

  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  storage.setUserLimit(ctx.from.id, newLimit);
  ctx.reply(`✅ המגבלה היומית שונתה ל-${newLimit} מנות.`);
});

// ─── /reset ───────────────────────────────────────────────
bot.command('reset', (ctx) => {
  storage.ensureUser(ctx.from.id, ctx.from.first_name, ctx.from.username);
  storage.resetToday(ctx.from.id);
  ctx.reply('🔄 הנתונים של היום אופסו.');
});

// ─── Midnight cron job (auto-notification) ────────────────
cron.schedule('0 0 * * *', () => {
  console.log('🕛 New day started - counters reset automatically');
  // Data resets automatically since we use date-based keys
  // Optionally send a summary to users here
}, {
  timezone: 'Asia/Jerusalem',
});

// ─── Error handling ───────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// ─── Launch (manual polling to bypass node-fetch TLS issues) ──
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
          console.error('Error handling update:', err);
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
  // Initialize bot info (normally done by bot.launch())
  const meRes = await fetch(`${API_BASE}/getMe`);
  const meData = await meRes.json();
  if (!meData.ok) throw new Error('getMe failed: ' + JSON.stringify(meData));
  bot.botInfo = meData.result;
  console.log(`Bot: @${bot.botInfo.username}`);

  const res = await fetch(`${API_BASE}/deleteWebhook?drop_pending_updates=true`);
  const data = await res.json();
  console.log('Webhook cleared:', data.description || 'ok');
  console.log('✅ Bot polling started');
  poll();
}

start().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});
console.log('🤖 Carb Bot is running!');

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
