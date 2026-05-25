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

    const sent = await ctx.reply(
      `שלום ${ctx.from.first_name}! 👋\n\n` +
      `📊 סטטוס היום:\n` +
      `🍞 פחמימות: ${status.total}/${status.limit} מנות\n` +
      `💧 מים: ${waterStatus.total}/${waterStatus.limit}ml\n\n` +
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
bot.command('status', (ctx) => {
  const user = storage.getUser(ctx.from.id);
  if (!user) {
    ctx.reply('שלח /start כדי להתחיל.');
    return;
  }

  const status = storage.getTodayStatus(ctx.from.id);
  const waterStatus = storage.getWaterStatus(ctx.from.id);
  let msg = formatStatus(ctx.from.first_name, status);
  msg += '\n\n' + formatWaterStatus(ctx.from.first_name, waterStatus);
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

  // Group by portions
  const grouped = {};
  entries.forEach(([name, portions]) => {
    const key = portions;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(name);
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
  const args = ctx.message.text.replace('/editfood', '').trim();
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
  const args = ctx.message.text.replace('/addfood', '').trim();
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
    if (isNaN(newPortions) || newPortions <= 0 || newPortions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0.5-50) או "מחק"');
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
    if (isNaN(portions) || portions <= 0 || portions > 50) {
      ctx.reply('❌ שלח מספר מנות תקין (0.5-50)');
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
      if (isNaN(newPortions) || newPortions <= 0 || newPortions > 50) {
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
  return `${emoji} סה"כ: ${status.total}/${status.limit} | נשאר: ${Math.max(0, status.remaining)}`;
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
  });

  for (const chatId of groups) {
    try {
      await sendMessage(chatId, msg);
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
        { command: 'reset', description: 'אפס את היום' },
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
