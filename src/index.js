process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const config = require('./config');
const storage = require('./storage');
const { generateHTML } = require('./dashboard');


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
bot.start(async (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (user) {
    const status = storage.getTodayStatus(ctx.from.id);
    const waterStatus = storage.getWaterStatus(ctx.from.id);
    const guideMsg =
      `📖 איך משתמשים?\n\n` +
      `🍞 פחמימות:\n` +
      `• שלח שם מאכל ← "פיתה", "2 בננות"\n` +
      `• הבוט מזהה אוטומטית ומוסיף למונה\n` +
      `• מאכל לא מוכר? הבוט ישאל כמה מנות\n\n` +
      `💧 מים:\n` +
      `• שלח "מים" או /water\n` +
      `• לחץ על הכפתורים להוספה מהירה\n\n` +
      `📋 כל הפקודות:\n` +
      `/status - סטטוס יומי מלא\n` +
      `/water - מעקב מים + כפתורים\n` +
      `/foods - מאגר מאכלים\n` +
      `/addfood - הוסף מאכל למאגר\n` +
      `/edit - ערוך/מחק רשומה\n` +
      `/limit - שנה מגבלת פחמימות\n` +
      `/waterlimit - שנה יעד מים\n` +
      `/reset - אפס את היום\n\n` +
      `⏰ דוחות אוטומטיים ב-8, 12, 16, 20 + סיכום ב-23:00`;

    const weightNote = !status.weightSet
      ? `\n⚠️ משקל לא הוגדר — שלח /setweight <משקל_בק"ג> לקביעת יעד חלבון אישי`
      : `\n💪 יעד חלבון: ${status.proteinGoal} גרם (${user.weight} ק"ג)`;

    const sent = await ctx.reply(
      `שלום ${ctx.from.first_name}! 👋\n\n` +
      `📊 סטטוס היום:\n` +
      `🍞 פחמימות: ${status.total}/${status.limit} מנות\n` +
      `🧈 שומן: ${status.fatTotal}/${status.fatLimit} נקודות\n` +
      `💧 מים: ${waterStatus.total}/${waterStatus.limit}ml` +
      weightNote + `\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      guideMsg
    );

    // Pin in group chats
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      try {
        await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
      } catch (err) {
        // Bot may not have pin permissions - ignore
      }
    }
  } else {
    userStates[ctx.from.id] = { action: 'set_limit' };
    const sent = await ctx.reply(
      `שלום ${ctx.from.first_name}! 👋\n\n` +
      `אני בוט שעוזר לך לעקוב אחרי פחמימות ושתיית מים.\n\n` +
      `📖 איך זה עובד?\n` +
      `• שלח שם מאכל (למשל "פיתה") ואני סופר מנות\n` +
      `• שלח "מים" ותקבל כפתורים לדיווח שתייה\n` +
      `• כל 4 שעות אשלח עדכון סטטוס\n` +
      `• ב-23:00 דוח סיכום יומי\n\n` +
      `כלל: 1 מנת פחמימה = 15 גרם פחמימה\n\n` +
      `בוא נתחיל! כמה מנות פחמימה מותרות לך ביום? (שלח מספר)`
    );

    // Pin in group chats
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
      try {
        await ctx.pinChatMessage(sent.message_id, { disable_notification: true });
      } catch (err) {
        // Bot may not have pin permissions - ignore
      }
    }
  }
});

// ─── /status ──────────────────────────────────────────────
bot.command('status', async (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  const status = storage.getTodayStatus(ctx.from.id);
  const waterStatus = storage.getWaterStatus(ctx.from.id);
  let msg = formatStatus(ctx.from.first_name, status);
  msg += '\n\n' + formatWaterStatus(ctx.from.first_name, waterStatus);

  // Add steps from storage
  const today = storage.getTodayKey();
  const steps = storage.getSteps(ctx.from.id, today);
  if (steps !== null && steps !== undefined) {
    const goal = storage.getStepsGoal(ctx.from.id);
    const pct = Math.min(Math.round((steps / goal) * 100), 100);
    const filled = Math.round(pct / 10);
    const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    const emoji = steps >= goal ? '🏆' : '🚶';
    msg += `\n\n${emoji} צעדים: ${steps.toLocaleString()}/${goal.toLocaleString()}\n${bar} ${pct}%`;
  }

  ctx.reply(msg);
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

// ─── /setweight ───────────────────────────────────────────
bot.command('setweight', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const user = storage.getUser(ctx.from.id);
    ctx.reply(
      `⚖️ המשקל הנוכחי שלך: ${user?.weight || 70} ק"ג\n` +
      `(ישמש ליעד חלבון יומי של ${user?.weight || 70} גרם)\n` +
      `לשינוי: /setweight <משקל>`
    );
    return;
  }
  const kg = parseFloat(args[1]);
  if (isNaN(kg) || kg < 30 || kg > 250) {
    ctx.reply('❌ מספר לא תקין (30-250)');
    return;
  }
  storage.setWeight(ctx.from.id, kg);
  ctx.reply(`✅ משקל עודכן ל-${kg} ק"ג | יעד חלבון: ${kg} גרם/יום`);
});

// ─── /sync (debug) ────────────────────────────────────────
bot.command('sync', async (ctx) => {
  const result = await storage.syncToCloud();
  ctx.reply(`סנכרון: ${result}\nPORT=${process.env.PORT || 'unset'} listening=${config.port}`);
});

// ─── /dashboard ───────────────────────────────────────────
bot.command('dashboard', async (ctx) => {
  if (!storage.getUser(ctx.from.id)) {
    return ctx.reply('❌ לא נרשמת. השתמש ב-/start כדי להירשם.');
  }
  await ctx.reply('⏳ מכין דשבורד...');
  try {
    const html = generateHTML(storage.loadUsers(), storage.getAllFoods());
    const dateStr = new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }).replace(/\//g, '-');
    await ctx.replyWithDocument(
      { source: Buffer.from(html, 'utf8'), filename: `dashboard-${dateStr}.html` },
      { caption: '📊 דשבורד מעקב בריאות — פתח בדפדפן' }
    );
  } catch (err) {
    console.error('Dashboard command error:', err.message);
    ctx.reply('❌ שגיאה ביצירת הדשבורד.');
  }
});

// ─── /export ─────────────────────────────────────────────
bot.command('export', async (ctx) => {
  if (!storage.getUser(ctx.from.id)) {
    return ctx.reply('שלח /start כדי להתחיל.');
  }
  await ctx.reply('⏳ מכין ייצוא נתונים...');
  try {
    const usersData = storage.loadUsers();
    const foodsData = storage.getAllFoods();
    const nowIL     = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
    const dateStr   = `${nowIL.getFullYear()}-${String(nowIL.getMonth() + 1).padStart(2, '0')}-${String(nowIL.getDate()).padStart(2, '0')}`;

    // JSON backup
    const jsonBuf = Buffer.from(
      JSON.stringify({ exportDate: dateStr, users: usersData, foods: foodsData }, null, 2), 'utf8'
    );

    // Food-log CSV
    const BOM = '﻿';
    const csvRows = [['שם', 'תאריך', 'שעה', 'מאכל', 'פחמימות', 'שומן', 'חלבון'].join(',')];
    for (const [, user] of Object.entries(usersData)) {
      const name = user.firstName || '';
      for (const [date, dayData] of Object.entries(user.days || {})) {
        for (const entry of (dayData.entries || [])) {
          const food = foodsData[entry.item];
          const carbs = typeof food === 'object' ? food.carbs || 0 : (food || 0);
          const quantity = carbs > 0 ? entry.portions / carbs : 1;
          const fat  = food && typeof food === 'object' ? Math.round((food.fat     || 0) * quantity * 10) / 10 : 0;
          const prot = food && typeof food === 'object' ? Math.round((food.protein || 0) * quantity * 10) / 10 : 0;
          csvRows.push([`"${name}"`, date, entry.time || '', `"${entry.item}"`, entry.portions, fat, prot].join(','));
        }
      }
    }
    const logCsvBuf = Buffer.from(BOM + csvRows.join('\n'), 'utf8');

    await ctx.replyWithDocument(
      { source: jsonBuf,   filename: `backup-${dateStr}.json` },
      { caption: '📄 גיבוי JSON מלא' }
    );
    await ctx.replyWithDocument(
      { source: logCsvBuf, filename: `food-log-${dateStr}.csv` },
      { caption: '📋 יומן מזון CSV (Excel/Sheets)' }
    );
  } catch (err) {
    console.error('Export error:', err.message);
    ctx.reply('❌ שגיאה בייצוא.');
  }
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

// ─── /edit - Edit/delete entries ──────────────────────────
bot.command('edit', (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  const status = storage.getTodayStatus(ctx.from.id);
  const waterStatus = storage.getWaterStatus(ctx.from.id);

  let msg = '📝 עריכה:\n\n';

  if (status.entries.length > 0) {
    msg += '🍞 רשומות פחמימות היום:\n';
    status.entries.forEach((e, i) => {
      msg += `${i + 1}. ${e.time} • ${e.item} (${e.portions} מנות)\n`;
    });
    msg += '\nשלח מספר למחיקה 🗑️\n';
    msg += 'או "מספר מנות_חדשות" לעריכה (למשל: "2 3")\n';
  } else {
    msg += '🍞 אין רשומות פחמימות היום.\n';
  }

  msg += `\n💧 מים היום: ${waterStatus.total}ml`;

  const buttons = [];
  if (waterStatus.total > 0) {
    buttons.push([
      Markup.button.callback('💧 אפס מים', 'water_reset'),
      Markup.button.callback('💧 הורד 250ml', 'water_undo_250'),
    ]);
  }

  if (status.entries.length > 0) {
    userStates[ctx.from.id] = { action: 'edit_entry', entries: status.entries };
  }

  if (buttons.length > 0) {
    ctx.reply(msg, Markup.inlineKeyboard(buttons));
  } else {
    ctx.reply(msg);
  }
});

// ─── Water edit callbacks ─────────────────────────────────
bot.action('water_reset', (ctx) => {
  const userId = ctx.from.id;
  storage.resetWater(userId);
  ctx.answerCbQuery('💧 מים אופסו');
  ctx.editMessageText('💧 מים אופסו ל-0ml');
});

bot.action('water_undo_250', (ctx) => {
  const userId = ctx.from.id;
  const result = storage.addWater(userId, -250);
  if (result) {
    ctx.answerCbQuery(`💧 הורדו 250ml`);
    ctx.editMessageText(`💧 מים עודכנו: ${result.total}/${result.limit}ml`);
  } else {
    ctx.answerCbQuery('❌ שגיאה');
  }
});

// ─── /foods - Show food database ─────────────────────────
bot.command('foods', (ctx) => {
  const foods = storage.getAllFoods();
  const entries = Object.entries(foods);

  if (entries.length === 0) {
    ctx.reply('📋 מאגר המאכלים ריק.');
    return;
  }

  // Group by carbs
  const grouped = {};
  entries.forEach(([name, data]) => {
    if (name.startsWith('_')) return;
    const carbs = typeof data === 'number' ? data : (data.carbs ?? 0);
    if (!grouped[carbs]) grouped[carbs] = [];
    grouped[carbs].push(name);
  });

  // Sort by portions
  const sortedKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  let msg = '📋 מאגר מאכלים (מנות פחמימה):\n';
  msg += '━━━━━━━━━━━━━━━━━━\n';

  sortedKeys.forEach((portions) => {
    msg += `\n🔸 ${portions} ${portions === 1 ? 'מנה' : 'מנות'}:\n`;
    grouped[portions].forEach((name) => {
      msg += `   • ${name}\n`;
    });
  });

  // Telegram message limit is 4096 chars
  if (msg.length > 4000) {
    // Split into multiple messages
    const chunks = [];
    let chunk = '📋 מאגר מאכלים:\n━━━━━━━━━━━━━━━━━━\n';
    sortedKeys.forEach((portions) => {
      let section = `\n🔸 ${portions} ${portions === 1 ? 'מנה' : 'מנות'}:\n`;
      grouped[portions].forEach((name) => {
        section += `   • ${name}\n`;
      });
      if (chunk.length + section.length > 4000) {
        chunks.push(chunk);
        chunk = '(המשך...)\n';
      }
      chunk += section;
    });
    if (chunk.length > 0) chunks.push(chunk);
    chunks.forEach((c) => ctx.reply(c));
  } else {
    ctx.reply(msg);
  }
});

// ─── /editfood - Edit/delete food from database ──────────
bot.command('editfood', (ctx) => {
  const args = ctx.message.text.replace(/^\/editfood(@\S+)?/, '').trim();
  if (!args) {
    userStates[ctx.from.id] = { action: 'edit_food_search' };
    ctx.reply('🔍 שלח את שם המאכל שתרצה לערוך/למחוק:');
    return;
  }

  const food = storage.findFood(args);
  if (!food) {
    ctx.reply(`❌ לא נמצא "${args}" במאגר.`);
    return;
  }

  userStates[ctx.from.id] = { action: 'edit_food_value', foodName: food.name };
  ctx.reply(
    `📝 "${food.name}" = ${food.portions} מנות\n\n` +
    `שלח מספר חדש לעדכון, או "מחק" למחיקה:`
  );
});

// ─── /addfood - Add food to database ──────────────────────
bot.command('addfood', (ctx) => {
  const args = ctx.message.text.replace(/^\/addfood(@\S+)?/, '').trim();
  if (!args) {
    userStates[ctx.from.id] = { action: 'add_food_name' };
    ctx.reply('🍽️ מה שם המאכל שתרצה להוסיף?');
    return;
  }
  // Support inline: /addfood שם_מאכל מנות
  const parts = args.split(/\s+/);
  const portions = parseFloat(parts[parts.length - 1]);
  if (parts.length >= 2 && !isNaN(portions)) {
    const name = parts.slice(0, -1).join(' ');
    storage.addFood(name, portions);
    ctx.reply(`✅ "${name}" נוסף למאגר (${portions} מנות)`);
  } else {
    userStates[ctx.from.id] = { action: 'add_food_portions', foodName: args };
    ctx.reply(`כמה מנות פחמימה ב"${args}"? (שלח מספר, למשל 1 או 0.5)`);
  }
});

// ─── /water - Water tracking ──────────────────────────────
bot.command('water', (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  const status = storage.getWaterStatus(ctx.from.id);
  const msg = formatWaterStatus(ctx.from.first_name, status);

  ctx.reply(msg, Markup.inlineKeyboard([
    [
      Markup.button.callback('🥤 כוס (250ml)', 'water_250'),
      Markup.button.callback('🍶 בקבוק (500ml)', 'water_500'),
    ],
    [
      Markup.button.callback('💧 100ml', 'water_100'),
      Markup.button.callback('🚰 ליטר (1000ml)', 'water_1000'),
    ],
  ]));
});

// ─── /waterlimit - Set water goal ─────────────────────────
bot.command('waterlimit', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const status = storage.getWaterStatus(ctx.from.id);
    ctx.reply(
      `🎯 יעד המים היומי שלך: ${status ? status.limit : 2000}ml\n` +
      `לשינוי: /waterlimit <מספר ml>\n` +
      `למשל: /waterlimit 2500`
    );
    return;
  }
  const newLimit = parseInt(args[1]);
  if (isNaN(newLimit) || newLimit < 500 || newLimit > 5000) {
    ctx.reply('❌ מספר לא תקין (500-5000 ml)');
    return;
  }
  storage.setWaterLimit(ctx.from.id, newLimit);
  ctx.reply(`✅ יעד המים שונה ל-${newLimit}ml (${(newLimit / 1000).toFixed(1)}L)`);
});

// ─── /steps - Show today's steps ──────────────────────────
bot.command('steps', async (ctx) => {
  const args = ctx.message.text.replace(/^\/steps(@\S+)?/, '').trim();
  const today = storage.getTodayKey();

  // If a number is provided, set today's steps
  if (args) {
    const steps = parseInt(args);
    if (isNaN(steps) || steps < 0 || steps > 200000) {
      ctx.reply('❌ מספר לא תקין');
      return;
    }
    storage.saveSteps(ctx.from.id, today, steps);
    const goal = storage.getStepsGoal(ctx.from.id);
    const emoji = steps >= goal ? '🏆' : '🚶';
    ctx.reply(`${emoji} צעדים עודכנו: ${steps.toLocaleString()}/${goal.toLocaleString()}` +
      (steps >= goal ? '\n\n🎉 עמדת ביעד! 💪' : ''));
    return;
  }

  // Show current steps
  const steps = storage.getSteps(ctx.from.id, today);
  const goal = storage.getStepsGoal(ctx.from.id);
  const pct = Math.min(Math.round((steps / goal) * 100), 100);
  const filled = Math.round(pct / 10);
  const bar = '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
  const emoji = steps >= goal ? '🏆' : '🚶';
  ctx.reply(
    `${emoji} צעדים היום: ${steps.toLocaleString()}/${goal.toLocaleString()}\n` +
    `${bar} ${pct}%\n\n` +
    `לעדכון: /steps <מספר>\nלמשל: /steps 5000` +
    (steps >= goal ? '\n\n🎉 עמדת ביעד הצעדים! 💪' : '')
  );
});

// ─── /stepsgoal - Set steps goal ──────────────────────────
bot.command('stepsgoal', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    const goal = storage.getStepsGoal(ctx.from.id);
    ctx.reply(`🎯 יעד צעדים יומי: ${goal.toLocaleString()}\nלשינוי: /stepsgoal <מספר>`);
    return;
  }
  const goal = parseInt(args[1]);
  if (isNaN(goal) || goal < 1000 || goal > 50000) {
    ctx.reply('❌ מספר לא תקין (1,000-50,000)');
    return;
  }
  storage.setStepsGoal(ctx.from.id, goal);
  ctx.reply(`✅ יעד הצעדים שונה ל-${goal.toLocaleString()}`);
});

// ─── Water button callbacks ───────────────────────────────
bot.action(/^water_(\d+)$/, (ctx) => {
  const ml = parseInt(ctx.match[1]);
  const result = storage.addWater(ctx.from.id, ml);
  if (!result) {
    ctx.answerCbQuery('שלח /start כדי להתחיל');
    return;
  }

  const justHitGoal = result.total >= result.limit && (result.total - ml) < result.limit;
  const emoji = result.total >= result.limit ? '🎉' : '👍';
  ctx.answerCbQuery(`${emoji} +${ml}ml`);

  let statusMsg = formatWaterStatus(ctx.from.first_name, { total: result.total, limit: result.limit, remaining: result.limit - result.total });
  if (justHitGoal) {
    statusMsg += '\n\n🎊🎊🎊🎊🎊🎊🎊🎊\n';
    statusMsg += '🏆 כל הכבוד!! עמדת ביעד המים היומי! 💪🔥\n';
    statusMsg += '🎊🎊🎊🎊🎊🎊🎊🎊';
  }

  ctx.editMessageText(
    statusMsg,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🥤 כוס (250ml)', 'water_250'),
        Markup.button.callback('🍶 בקבוק (500ml)', 'water_500'),
      ],
      [
        Markup.button.callback('💧 100ml', 'water_100'),
        Markup.button.callback('🚰 ליטר (1000ml)', 'water_1000'),
      ],
    ])
  );
});

// ─── Handle all text messages (food input) ────────────────
bot.on('text', (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Skip commands
  if (text.startsWith('/')) return;

  // "בטל" cancels any pending action
  if (text === 'בטל' || text === 'ביטול') {
    if (userStates[userId]) {
      delete userStates[userId];
      ctx.reply('✅ בוטל.');
    } else {
      ctx.reply('👍 אין פעולה לביטול.');
    }
    return;
  }

  // "מים" opens water tracking
  if (text === 'מים') {
    const user = storage.getUser(userId);
    if (!user) {
      ctx.reply('שלח /start כדי להתחיל.');
      return;
    }
    const status = storage.getWaterStatus(userId);
    ctx.reply(formatWaterStatus(ctx.from.first_name, status), Markup.inlineKeyboard([
      [
        Markup.button.callback('🥤 כוס (250ml)', 'water_250'),
        Markup.button.callback('🍶 בקבוק (500ml)', 'water_500'),
      ],
      [
        Markup.button.callback('💧 100ml', 'water_100'),
        Markup.button.callback('🚰 ליטר (1000ml)', 'water_1000'),
      ],
    ]));
    return;
  }

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
      userStates[userId] = { action: 'set_weight', dailyLimit: limit };
      ctx.reply(
        `✅ מגבלת פחמימות: ${limit} מנות.\n\n` +
        `💪 כמה אתה שוקל בק"ג? (המספר ישמש ליעד החלבון היומי שלך)\n` +
        `למשל: 75`
      );
      return;
    }

    if (userStates[userId]?.action === 'set_weight') {
      const kg = parseFloat(text);
      if (isNaN(kg) || kg < 30 || kg > 250) {
        ctx.reply('❌ שלח משקל תקין בק"ג (30-250)');
        return;
      }
      const { dailyLimit } = userStates[userId];
      storage.createUser(userId, ctx.from.first_name, dailyLimit, kg);
      delete userStates[userId];
      ctx.reply(
        `✅ מעולה! ההגדרות שלך:\n` +
        `🍞 מגבלת פחמימות: ${dailyLimit} מנות\n` +
        `🧈 מגבלת שומן: 8 נקודות\n` +
        `💪 יעד חלבון: ${kg} גרם (לפי משקל ${kg}ק"ג)\n\n` +
        `עכשיו פשוט שלח את שם המאכל שאכלת.\n` +
        `למשל: "פיתה", "2 בננות", "חזה עוף"`
      );
      return;
    }
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  // Edit food - search
  if (userStates[userId]?.action === 'edit_food_search') {
    const food = storage.findFood(text);
    if (!food) {
      ctx.reply(`❌ לא נמצא "${text}" במאגר. נסה שם אחר:`);
      return;
    }
    userStates[userId] = { action: 'edit_food_value', foodName: food.name };
    ctx.reply(
      `📝 "${food.name}" = ${food.portions} מנות\n\n` +
      `שלח מספר חדש לעדכון, או "מחק" למחיקה:`
    );
    return;
  }

  // Edit food - set new value or delete
  if (userStates[userId]?.action === 'edit_food_value') {
    const foodName = userStates[userId].foodName;
    if (text === 'מחק' || text === 'delete') {
      storage.deleteFood(foodName);
      delete userStates[userId];
      ctx.reply(`🗑️ "${foodName}" נמחק מהמאגר.`);
      return;
    }
    const newPortions = parseFloat(text);
    if (isNaN(newPortions) || newPortions < 0 || newPortions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0-50) או "מחק"');
      return;
    }
    storage.addFood(foodName, newPortions);
    delete userStates[userId];
    ctx.reply(`✅ "${foodName}" עודכן ל-${newPortions} מנות.`);
    return;
  }

  // Check if waiting for portions for new food
  if (userStates[userId]?.action === 'add_food_name') {
    userStates[userId] = { action: 'add_food_portions_only', foodName: text };
    ctx.reply(`כמה מנות פחמימה ב"${text}"? (שלח מספר, למשל 1 או 0.5)`);
    return;
  }

  if (userStates[userId]?.action === 'add_food_portions_only') {
    const portions = parseFloat(text);
    if (isNaN(portions) || portions < 0 || portions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0-50)');
      return;
    }
    const foodName = userStates[userId].foodName;
    storage.addFood(foodName, portions);
    delete userStates[userId];
    ctx.reply(`✅ "${foodName}" נוסף למאגר (${portions} מנות)`);
    return;
  }

  // Check if waiting for portions for new food
  if (userStates[userId]?.action === 'add_food_portions') {
    const portions = parseFloat(text);
    if (isNaN(portions) || portions < 0 || portions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0-50)');
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

  // Check if editing an entry
  if (userStates[userId]?.action === 'edit_entry') {
    const parts = text.split(/\s+/);
    const index = parseInt(parts[0]) - 1;
    const entries = userStates[userId].entries;

    if (isNaN(index) || index < 0 || index >= entries.length) {
      ctx.reply(`❌ שלח מספר בין 1 ל-${entries.length}`);
      return;
    }

    if (parts.length >= 2) {
      // Edit: "2 3" = change entry 2 to 3 portions
      const newPortions = parseFloat(parts[1]);
      if (isNaN(newPortions) || newPortions < 0 || newPortions > 50) {
        ctx.reply('❌ מספר מנות לא תקין');
        return;
      }
      const edited = storage.editEntry(userId, index, newPortions);
      delete userStates[userId];
      if (edited) {
        const newStatus = storage.getTodayStatus(userId);
        ctx.reply(`✏️ עודכן: ${edited.item} → ${newPortions} מנות\n` + formatQuickStatus(newStatus));
      } else {
        ctx.reply('❌ שגיאה בעדכון');
      }
    } else {
      // Delete entry
      const removed = storage.deleteEntry(userId, index);
      delete userStates[userId];
      if (removed) {
        const newStatus = storage.getTodayStatus(userId);
        ctx.reply(`🗑️ נמחק: ${removed.item} (${removed.portions} מנות)\n` + formatQuickStatus(newStatus));
      } else {
        ctx.reply('❌ שגיאה במחיקה');
      }
    }
    return;
  }

  // ─── Parse food input ─────────────────────────────────
  const { quantity, foodName } = parseInput(text);

  // Look up food in DB
  const food = storage.findFood(foodName);

  if (food && food.matchType === 'exact') {
    // ── Salad special case: show ingredient picker ──────────
    if (food.name === 'סלט') {
      showSaladPicker(ctx);
      return;
    }

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

  } else if (food && food.matchType === 'partial') {
    // ── Partial match: ask confirmation ─────────────────────
    userStates[userId] = { action: 'confirm_partial_match', food, quantity, originalInput: foodName };
    ctx.reply(
      `🔍 "${foodName}" לא נמצא במאגר.\n` +
      `האם התכוונת ל-"${food.name}"? (${food.carbs} מנות פחמימה)`,
      Markup.inlineKeyboard([[
        Markup.button.callback(`✅ כן, "${food.name}"`, 'match_yes'),
        Markup.button.callback('❌ לא, הוסף חדש', 'match_no'),
      ]])
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

// ─── Partial-match confirmation callbacks ─────────────────
bot.action('match_yes', (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates[userId];
  if (!state || state.action !== 'confirm_partial_match') {
    ctx.answerCbQuery();
    return;
  }

  const { food, quantity } = state;
  delete userStates[userId];
  ctx.answerCbQuery(`✅ נוסף: ${food.name}`);

  const totalPortions = food.portions * quantity;
  const status = storage.getTodayStatus(userId);

  if (status.total + totalPortions > status.limit) {
    const willBe = status.total + totalPortions;
    ctx.editMessageText(
      `⚠️ אזהרה! ${quantity > 1 ? quantity + ' ' : ''}${food.name} = ${totalPortions} מנות.\n` +
      `אתה על ${status.total}/${status.limit}, תגיע ל-${willBe}!\n\nלהוסיף בכל זאת? שלח "כן" או "לא"`,
      { reply_markup: undefined }
    );
    userStates[userId] = { action: 'confirm_over', foodName: food.name, portions: totalPortions };
    return;
  }

  storage.addPortions(userId, food.name, totalPortions);
  const newStatus = storage.getTodayStatus(userId);
  ctx.editMessageText(
    `✅ ${quantity > 1 ? quantity + ' × ' : ''}${food.name} = ${totalPortions} מנות\n` +
    formatQuickStatus(newStatus),
    { reply_markup: undefined }
  );
});

bot.action('match_no', (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates[userId];
  if (!state || state.action !== 'confirm_partial_match') {
    ctx.answerCbQuery();
    return;
  }
  const { originalInput, quantity } = state;
  userStates[userId] = { action: 'add_food_portions', foodName: originalInput, quantity };
  ctx.answerCbQuery();
  ctx.editMessageText(
    `🆕 הוספת "${originalInput}" כמאכל חדש.\nכמה מנות פחמימה זה? (1 מנה = 15 גרם)`,
    { reply_markup: undefined }
  );
});

// ─── Salad ingredient picker ──────────────────────────────
const SALAD_ROWS = [
  ['עגבניה', 'מלפפון', 'חסה', 'גמבה'],
  ['בצל', 'גזר', 'פטריות', 'זיתים'],
  ['טונה', 'ביצה קשה', 'גבינה צפתית', 'אבוקדו'],
  ['פלפל אדום', 'צנונית', 'גבינה לבנה', 'גבינת פטה'],
  ['כרוב', 'רוקט', 'עלי תרד', 'סלמון נא'],
];

function saladKeyboard() {
  const rows = SALAD_ROWS.map(row =>
    row.map(item => Markup.button.callback(item, `salad_add:${item}`))
  );
  rows.push([Markup.button.callback('✅ סיימתי', 'salad_done')]);
  return Markup.inlineKeyboard(rows);
}

function showSaladPicker(ctx) {
  ctx.reply('🥗 בחר/י מרכיבי הסלט — לחץ/י להוסיף:', saladKeyboard());
}

bot.action(/^salad_add:(.+)$/, (ctx) => {
  const userId    = ctx.from.id;
  const itemName  = ctx.match[1];
  const food      = storage.findFood(itemName);
  const portions  = food ? food.portions : 0;

  storage.addPortions(userId, food ? food.name : itemName, portions);
  ctx.answerCbQuery(`✅ ${itemName} נוסף`);
});

bot.action('salad_done', (ctx) => {
  const userId = ctx.from.id;
  const status = storage.getTodayStatus(userId);
  ctx.answerCbQuery('✅ סלט נשמר');
  ctx.editMessageText(
    `🥗 הסלט נשמר!\n${formatQuickStatus(status)}`,
    { reply_markup: undefined }
  );
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

function makeBar(value, limit, filledEmoji, emptyEmoji = '⬜', size = 10) {
  const pct  = Math.min(value / (limit || 1), 1);
  const done = Math.round(pct * size);
  return filledEmoji.repeat(done) + emptyEmoji.repeat(size - done) + ` ${Math.round(pct * 100)}%`;
}

function formatStatus(firstName, status) {
  let msg = `📊 ${firstName} - סטטוס יומי\n\n`;

  // Carbs
  msg += `🍞 פחמימות: ${status.total}/${status.limit} מנות\n`;
  msg += `${makeBar(status.total, status.limit, '🟩')}\n`;
  if (status.remaining <= 0)    msg += `🚫 חריגה של ${(status.total - status.limit).toFixed(1)}!\n`;
  else if (status.remaining <= 2) msg += `⚡ נשאר ${status.remaining.toFixed(1)} מנות בלבד!\n`;
  else                          msg += `נשאר: ${status.remaining.toFixed(1)} מנות\n`;

  // Fat
  const fatR = (status.fatLimit - status.fatTotal).toFixed(1);
  msg += `\n🧈 שומן: ${status.fatTotal}/${status.fatLimit} נקודות\n`;
  msg += `${makeBar(status.fatTotal, status.fatLimit, '🟧')}\n`;
  msg += status.fatTotal >= status.fatLimit
    ? `🚫 חריגה בשומן!\n`
    : `נשאר: ${fatR} נקודות\n`;

  // Protein
  if (!status.weightSet) {
    msg += `\n💪 חלבון: ${status.proteinTotal} גרם\n`;
    msg += `⚠️ משקל לא הוגדר — שלח /setweight <משקל> לקביעת יעד חלבון אישי\n`;
  } else {
    const proteinR   = Math.max(0, status.proteinGoal - status.proteinTotal).toFixed(1);
    const proteinPct = Math.round(Math.min(status.proteinTotal / status.proteinGoal, 1) * 100);
    msg += `\n💪 חלבון: ${status.proteinTotal}/${status.proteinGoal} גרם\n`;
    msg += `${makeBar(status.proteinTotal, status.proteinGoal, '🟦')}\n`;
    msg += proteinPct >= 100 ? `✅ יעד חלבון הושג!\n` : `עוד: ${proteinR} גרם\n`;
  }

  if (status.entries.length > 0) {
    msg += `\n📝 היום:\n`;
    status.entries.forEach((e) => {
      const f = (n) => parseFloat((n || 0).toFixed(1));
      msg += `  ${e.time} • ${e.item}`;
      msg += `  (פחמימה: ${f(e.portions)},  שומן: ${f(e.fat)}, חלבון: ${f(e.protein)})\n`;
    });
  }

  return msg;
}

function formatStatusLine(u) {
  const fatOk  = u.fatTotal <= u.fatLimit;
  const protPct = Math.round(Math.min(u.proteinTotal / (u.proteinGoal || 1), 1) * 100);
  return (
    `🍞 ${u.fatTotal !== undefined ? `${u.total}/${u.limit}` : `${u.total}/${u.limit}`} מנות` +
    (u.fatTotal   !== undefined ? `  🧈 ${u.fatTotal}/${u.fatLimit}` + (fatOk ? '' : '🚫') : '') +
    (u.proteinTotal !== undefined ? `  💪 ${u.proteinTotal}/${u.proteinGoal}גר` : '')
  );
}

function formatWaterStatus(firstName, status) {
  const progress = Math.min(status.total / status.limit, 1);
  const filled = Math.round(progress * 10);
  const empty = 10 - filled;
  const bar = '💧'.repeat(filled) + '⬜'.repeat(empty);

  let msg = `💧 ${firstName} - מעקב מים\n\n`;
  msg += `${bar} ${Math.round(progress * 100)}%\n`;
  msg += `שתית: ${status.total}ml / ${status.limit}ml`;
  msg += ` (${(status.total / 1000).toFixed(1)}L / ${(status.limit / 1000).toFixed(1)}L)\n`;
  msg += `נשאר: ${Math.max(0, status.remaining)}ml\n`;

  if (status.total >= status.limit) {
    msg += `\n🎉 כל הכבוד! הגעת ליעד!`;
  } else if (status.remaining <= 500) {
    msg += `\n💪 כמעט שם!`;
  }

  return msg;
}

function formatQuickStatus(status) {
  const emoji = status.remaining <= 0 ? '🚫' : status.remaining <= 2 ? '⚡' : '📊';
  let msg = `${emoji} פח: ${status.total}/${status.limit}`;
  if (status.fatTotal !== undefined) msg += ` | 🧈 ${status.fatTotal}/${status.fatLimit}`;
  if (status.proteinTotal !== undefined) {
    msg += status.weightSet
      ? ` | 💪 ${status.proteinTotal}/${status.proteinGoal}גר`
      : ` | 💪 ${status.proteinTotal}גר ⚠️/setweight`;
  }
  return msg;
}

// ─── Scheduled status every 4 hours (8,12,16,20) ─────────
cron.schedule('0 8,12,16,20 * * *', async () => {
  const groups = storage.getGroups();
  const usersStatus = storage.getAllUsersStatus();
  const waterStatus = storage.getAllUsersWaterStatus();

  if (usersStatus.length === 0) return;

  let msg = '📊 עדכון סטטוס:\n';
  msg += '━━━━━━━━━━━━━━━━━━\n';

  usersStatus.forEach((u) => {
    const progress = Math.min(u.total / u.limit, 1);
    const filled = Math.round(progress * 10);
    const empty = 10 - filled;
    const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);
    const emoji = u.remaining <= 0 ? '🚫' : u.remaining <= 2 ? '⚡' : '✅';

    msg += `\n${emoji} ${u.firstName}\n`;
    msg += `${bar} ${u.total}/${u.limit} מנות\n`;

    // Fat & protein inline
    if (u.fatTotal !== undefined) {
      const fatBar  = makeBar(u.fatTotal,   u.fatLimit,   '🟧', '⬜', 8);
      const protBar = makeBar(u.proteinTotal, u.proteinGoal, '🟦', '⬜', 8);
      msg += `   🧈 ש: ${u.fatTotal}/${u.fatLimit}  ${fatBar}\n`;
      msg += `   💪 ח: ${u.proteinTotal}/${u.proteinGoal}גר  ${protBar}\n`;
    }

    if (u.entries.length > 0) {
      u.entries.forEach((e) => {
        msg += `   ${e.time} • ${e.item} (${e.portions})\n`;
      });
    } else {
      msg += `   ✨ לא אכל/ה פחמימות עדיין\n`;
    }

    // Water status for this user
    const w = waterStatus.find((ws) => ws.userId === u.userId);
    if (w) {
      const wPct = Math.min(Math.round((w.total / w.limit) * 100), 100);
      const wFilled = Math.round(wPct / 10);
      const wEmpty = 10 - wFilled;
      const wBar = '💧'.repeat(wFilled) + '⬜'.repeat(wEmpty);
      msg += `   ${wBar} 💧 ${w.total}/${w.limit}ml\n`;
    }

    // Steps status
    const today = storage.getTodayKey();
    const steps = storage.getSteps(u.userId, today);
    if (steps !== null && steps !== undefined) {
      const goal = storage.getStepsGoal(u.userId);
      const sPct = Math.min(Math.round((steps / goal) * 100), 100);
      const sFilled = Math.round(sPct / 10);
      const sBar = '🟩'.repeat(sFilled) + '⬜'.repeat(10 - sFilled);
      const sEmoji = steps >= goal ? '🏆' : '🚶';
      msg += `   ${sBar} ${sEmoji} ${steps.toLocaleString()}/${goal.toLocaleString()} צעדים\n`;
    }
  });

  const statusDashBuf = Buffer.from(generateHTML(storage.loadUsers(), storage.getAllFoods()), 'utf8');

  for (const chatId of groups) {
    try {
      await sendMessage(chatId, msg);
      await bot.telegram.sendDocument(
        chatId,
        { source: statusDashBuf, filename: 'status-dashboard.html' },
        { caption: '📊 דשבורד עדכני — פתח בדפדפן' }
      );
    } catch (err) {
      console.error(`Failed to send status to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Daily report at 23:00 ────────────────────────────────
cron.schedule('0 23 * * *', async () => {
  const groups = storage.getGroups();
  const usersStatus = storage.getAllUsersStatus();
  const waterStatus = storage.getAllUsersWaterStatus();

  if (usersStatus.length === 0) return;

  let msg = '📋 דוח סוף יום\n';
  msg += '━━━━━━━━━━━━━━━━━━\n';

  usersStatus.forEach((u) => {
    const emoji = u.success ? '🏆' : '❌';
    const verdict = u.success ? 'עמד/ה במגבלה! 💪' : `חרג/ה ב-${u.total - u.limit} מנות`;
    const progress = Math.min(u.total / u.limit, 1);
    const filled = Math.round(progress * 10);
    const empty = 10 - filled;
    const bar = '🟩'.repeat(filled) + '⬜'.repeat(empty);

    msg += `\n${emoji} ${u.firstName} - ${verdict}\n`;
    msg += `${bar} ${u.total}/${u.limit} מנות\n`;

    // Fat & protein summary
    if (u.fatTotal !== undefined) {
      const fatEmoji = u.fatTotal <= u.fatLimit ? '✅' : '🚫';
      const protEmoji = u.proteinTotal >= u.proteinGoal ? '✅' : '⚠️';
      msg += `   ${fatEmoji} שומן: ${u.fatTotal}/${u.fatLimit} נקודות\n`;
      msg += `   ${protEmoji} חלבון: ${u.proteinTotal}/${u.proteinGoal} גרם\n`;
    }

    if (u.entries.length > 0) {
      msg += `📝 מה אכל/ה:\n`;
      u.entries.forEach((e) => {
        msg += `   ${e.time} • ${e.item} (${e.portions})\n`;
      });
    } else {
      msg += `   ✨ לא אכל/ה פחמימות היום!\n`;
    }

    // Water status for this user
    const w = waterStatus.find((ws) => ws.userId === u.userId);
    if (w) {
      if (w.success) {
        msg += `   🎊💧 עמד/ה ביעד המים! ${w.total}/${w.limit}ml 🏆💪\n`;
      } else {
        msg += `   💧❌ מים: ${w.total}/${w.limit}ml (חסרו ${w.remaining}ml)\n`;
      }
    }

    // Steps status
    const today = storage.getTodayKey();
    const steps = storage.getSteps(u.userId, today);
    if (steps !== null && steps !== undefined) {
      const goal = storage.getStepsGoal(u.userId);
      const sEmoji = steps >= goal ? '🏆' : '❌';
      if (steps >= goal) {
        msg += `   🎊🚶 עמד/ה ביעד הצעדים! ${steps.toLocaleString()}/${goal.toLocaleString()} 🏆💪\n`;
      } else {
        msg += `   🚶❌ צעדים: ${steps.toLocaleString()}/${goal.toLocaleString()} (חסרו ${(goal - steps).toLocaleString()})\n`;
      }
    }
  });

  // Water achievements summary
  const waterAchievers = waterStatus.filter((w) => w.success);
  if (waterAchievers.length > 0) {
    msg += `\n🎊🎊🎊🎊🎊🎊🎊🎊\n`;
    msg += `🏆 עמדו ביעד המים היום:\n`;
    waterAchievers.forEach((w) => {
      msg += `   💪 ${w.firstName} - ${w.total}ml!\n`;
    });
    msg += `🎊🎊🎊🎊🎊🎊🎊🎊\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `לילה טוב! 🌙 המונה מתאפס.`;

  for (const chatId of groups) {
    try {
      await sendMessage(chatId, msg);
    } catch (err) {
      console.error(`Failed to send report to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Weekly report - Friday at 21:00 ─────────────────────
cron.schedule('0 21 * * 5', async () => {
  const groups = storage.getGroups();
  const allStats = storage.getAllUsersPeriodStats(7);
  if (allStats.length === 0) return;

  let msg = '📊 דוח שבועי\n';
  msg += '━━━━━━━━━━━━━━━━━━\n';

  for (const s of allStats) {
    const carbScore = `${s.daysInLimit}/${s.totalDays}`;
    const waterScore = `${s.daysWaterGoal}/${s.totalDays}`;
    const carbEmoji = s.daysInLimit >= 5 ? '🏆' : s.daysInLimit >= 3 ? '👍' : '⚠️';
    const waterEmoji = s.daysWaterGoal >= 5 ? '💧🏆' : s.daysWaterGoal >= 3 ? '💧👍' : '💧⚠️';

    msg += `\n${carbEmoji} ${s.firstName}\n`;
    msg += `   🍞 פחמימות: ממוצע ${s.avgPortions}/${s.limit} | עמד/ה ${carbScore} ימים\n`;
    msg += `   ${waterEmoji} מים: ממוצע ${s.avgWater}/${s.waterLimit}ml | עמד/ה ${waterScore} ימים\n`;
    msg += `   📅 פירוט:\n`;

    const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    for (const day of s.days) {
      const d = new Date(day.date);
      const dayName = dayNames[d.getDay()];
      const carbIcon = day.inLimit ? '✅' : '❌';
      const waterIcon = day.waterGoal ? '💧' : '🚫';
      msg += `      ${dayName} ${carbIcon} ${day.total}/${day.limit} ${waterIcon} ${day.water}ml\n`;
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `שבת שלום! 🕯️`;

  const dashboardHtml = generateHTML(storage.loadUsers(), storage.getAllFoods());
  const dashBuf = Buffer.from(dashboardHtml, 'utf8');

  for (const chatId of groups) {
    try {
      await sendMessage(chatId, msg);
      await bot.telegram.sendDocument(
        chatId,
        { source: dashBuf, filename: 'weekly-dashboard.html' },
        { caption: '📊 דשבורד שבועי — פתח בדפדפן' }
      );
    } catch (err) {
      console.error(`Failed to send weekly report to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Weekly data export — Sunday 21:00 ───────────────────
// Sends full JSON backup + two CSV files to every group so the data
// is always reachable in Telegram history regardless of the bot's state.
cron.schedule('0 21 * * 0', async () => {
  const groups = storage.getGroups();
  if (!groups.length) return;

  const usersData  = storage.loadUsers();
  const foodsData  = storage.getAllFoods();
  const nowIL      = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const dateStr    = `${nowIL.getFullYear()}-${String(nowIL.getMonth() + 1).padStart(2, '0')}-${String(nowIL.getDate()).padStart(2, '0')}`;

  // ── 1. Full JSON backup ──────────────────────────────────
  const jsonPayload = JSON.stringify({ exportDate: dateStr, users: usersData, foods: foodsData }, null, 2);
  const jsonBuf     = Buffer.from(jsonPayload, 'utf8');

  // ── 2. Food-log CSV (one row per entry, all history) ────
  const BOM = '﻿'; // Excel Hebrew compatibility
  const csvRows = [['שם', 'תאריך', 'שעה', 'מאכל', 'פחמימות', 'שומן', 'חלבון'].join(',')];
  for (const [, user] of Object.entries(usersData)) {
    const name = user.firstName || '';
    for (const [date, dayData] of Object.entries(user.days || {})) {
      for (const entry of (dayData.entries || [])) {
        const food = foodsData[entry.item];
        const carbs = typeof food === 'object' ? food.carbs || 0 : (food || 0);
        const quantity = carbs > 0 ? entry.portions / carbs : 1;
        const fat  = food && typeof food === 'object' ? Math.round((food.fat     || 0) * quantity * 10) / 10 : 0;
        const prot = food && typeof food === 'object' ? Math.round((food.protein || 0) * quantity * 10) / 10 : 0;
        csvRows.push([
          `"${name}"`, date, entry.time || '', `"${entry.item}"`,
          entry.portions, fat, prot,
        ].join(','));
      }
    }
  }
  const logCsvBuf = Buffer.from(BOM + csvRows.join('\n'), 'utf8');

  // ── 3. Foods database CSV ────────────────────────────────
  const foodRows = [['מאכל', 'פחמימות', 'שומן (נק׳)', 'חלבון (גר׳)'].join(',')];
  for (const [name, data] of Object.entries(foodsData)) {
    if (name.startsWith('_')) continue;
    const c = typeof data === 'object' ? data.carbs || 0 : data;
    const f = typeof data === 'object' ? data.fat   || 0 : 0;
    const p = typeof data === 'object' ? data.protein || 0 : 0;
    foodRows.push([`"${name}"`, c, f, p].join(','));
  }
  const foodCsvBuf = Buffer.from(BOM + foodRows.join('\n'), 'utf8');

  // ── 4. Send to every group ───────────────────────────────
  const caption = `📦 גיבוי שבועי — ${dateStr}`;
  for (const chatId of groups) {
    try {
      await bot.telegram.sendDocument(chatId,
        { source: jsonBuf,    filename: `backup-${dateStr}.json` },
        { caption: `${caption}\n📄 גיבוי JSON מלא (משתמשים + מאגר מזון)` }
      );
      await bot.telegram.sendDocument(chatId,
        { source: logCsvBuf,  filename: `food-log-${dateStr}.csv` },
        { caption: `${caption}\n📋 יומן מזון — כל הרשומות (Excel/Sheets)` }
      );
      await bot.telegram.sendDocument(chatId,
        { source: foodCsvBuf, filename: `foods-db-${dateStr}.csv` },
        { caption: `${caption}\n🥗 מאגר מזון — ${foodRows.length - 1} פריטים (Excel/Sheets)` }
      );
    } catch (err) {
      console.error(`Weekly export to ${chatId} failed:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Monthly report - last day of month at 22:00 ─────────
cron.schedule('0 22 28-31 * *', async () => {
  // Check if tomorrow is a new month
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (tomorrow.getMonth() === now.getMonth()) return; // not last day

  const groups = storage.getGroups();
  const daysInMonth = now.getDate();
  const allStats = storage.getAllUsersPeriodStats(daysInMonth);
  if (allStats.length === 0) return;

  const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  let msg = `📊 דוח חודשי - ${monthNames[now.getMonth()]} ${now.getFullYear()}\n`;
  msg += '━━━━━━━━━━━━━━━━━━\n';

  for (const s of allStats) {
    const carbPct = Math.round((s.daysInLimit / s.totalDays) * 100);
    const waterPct = Math.round((s.daysWaterGoal / s.totalDays) * 100);
    const overallEmoji = carbPct >= 70 ? '🏆' : carbPct >= 50 ? '👍' : '💪';

    msg += `\n${overallEmoji} ${s.firstName}\n`;
    msg += `   🍞 פחמימות:\n`;
    msg += `      ממוצע יומי: ${s.avgPortions}/${s.limit} מנות\n`;
    msg += `      ימים במגבלה: ${s.daysInLimit}/${s.totalDays} (${carbPct}%)\n`;
    msg += `      סה"כ מנות: ${s.totalPortions}\n`;
    msg += `   💧 מים:\n`;
    msg += `      ממוצע יומי: ${s.avgWater}ml\n`;
    msg += `      ימים ביעד: ${s.daysWaterGoal}/${s.totalDays} (${waterPct}%)\n`;
    msg += `      סה"כ: ${(s.totalWater / 1000).toFixed(1)} ליטר\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  msg += `חודש חדש, התחלה חדשה! 🚀`;

  for (const chatId of groups) {
    try {
      await sendMessage(chatId, msg);
    } catch (err) {
      console.error(`Failed to send monthly report to ${chatId}:`, err.message);
    }
  }
}, { timezone: 'Asia/Jerusalem' });

// ─── Error handling ───────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// ─── Telegram API helper ──────────────────────────────────
const API_BASE = `https://api.telegram.org/bot${config.botToken}`;

async function sendMessage(chatId, text) {
  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.json();
}

// ─── Launch (manual polling for TLS compatibility) ────────
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
  // Start HTTP server for OAuth callback (start early for Railway health checks)
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.port}`);

    if (url.pathname === '/api/steps') {
      const key = url.searchParams.get('key');
      const steps = parseInt(url.searchParams.get('steps'), 10);

      // Authenticate with a simple key derived from bot token
      const expectedKey = config.botToken.split(':')[1].slice(0, 16);
      if (key !== expectedKey) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }

      if (isNaN(steps) || steps < 0) {
        res.writeHead(400);
        res.end('Invalid steps value');
        return;
      }

      const userId = config.syncChatId; // owner's ID
      const today = storage.getTodayKey();
      storage.saveSteps(userId, today, steps);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, steps, date: today }));
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`🌐 HTTP server on port ${config.port}`);
  });

  // Warn loudly if backup/restore is disabled (missing SYNC_CHAT_ID env var)
  if (!config.syncChatId) {
    console.error('⚠️  WARNING: SYNC_CHAT_ID is not set. Telegram backup/restore is DISABLED.');
    console.error('⚠️  User data will be lost on every redeploy. Set SYNC_CHAT_ID in env vars.');
  }

  // Pull data from cloud on fresh deploy
  await storage.pullFromCloud();
  if (config.syncChatId) {
    console.log('✅ Cloud restore complete.');
  }

  const meRes = await fetch(`${API_BASE}/getMe`);
  const meData = await meRes.json();
  if (!meData.ok) throw new Error('getMe failed: ' + JSON.stringify(meData));
  bot.botInfo = meData.result;
  console.log(`Bot: @${bot.botInfo.username}`);

  const res = await fetch(`${API_BASE}/deleteWebhook?drop_pending_updates=true`);
  await res.json();

  // Register command menu in Telegram
  await fetch(`${API_BASE}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'start', description: 'התחלה / הרשמה' },
        { command: 'status', description: 'סטטוס יומי' },
        { command: 'limit', description: 'שנה מגבלה יומית' },
        { command: 'edit', description: 'ערוך/מחק רשומה' },
        { command: 'foods', description: 'מאגר מאכלים' },
        { command: 'addfood', description: 'הוסף מאכל למאגר' },
        { command: 'editfood', description: 'ערוך/מחק מאכל מהמאגר' },
        { command: 'water', description: '💧 מעקב מים' },
        { command: 'waterlimit', description: 'שנה יעד מים יומי' },
        { command: 'steps', description: '🚶 צעדים היום' },
        { command: 'stepsgoal', description: 'שנה יעד צעדים' },
        { command: 'setweight', description: 'עדכן משקל (יעד חלבון)' },
        { command: 'export', description: '📦 ייצא נתונים (JSON + CSV)' },
        { command: 'reset', description: 'אפס את היום' },
        { command: 'dashboard', description: '📊 דשבורד HTML' },
      ],
    }),
  });

  console.log('✅ Bot polling started');
  poll();
}

start().catch((err) => {
  console.error('❌ Failed to start:', err);
  process.exit(1);
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
