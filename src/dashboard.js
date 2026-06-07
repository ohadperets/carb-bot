'use strict';

/**
 * Dashboard HTML generator — Hebrew RTL.
 * Pure function: takes raw users data object, returns HTML string.
 */

// ─── Date helpers (Jerusalem timezone) ───────────────────────────────────────

function dateKey(offsetDays = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  d.setDate(d.getDate() - offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateRange(n) {
  return Array.from({ length: n }, (_, i) => dateKey(n - 1 - i));
}

const HE_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
function shortDay(iso) {
  return HE_DAYS[new Date(iso + 'T12:00:00').getDay()];
}

const FAT_LIMIT = 8;

// ─── Stats ────────────────────────────────────────────────────────────────────

function computeDayNutrition(entries, foods) {
  let fatTotal = 0, proteinTotal = 0;
  for (const entry of (entries || [])) {
    const food = foods[entry.item];
    if (!food || typeof food !== 'object') continue;
    const carbs    = food.carbs || 0;
    const quantity = carbs > 0 ? entry.portions / carbs : 1;
    fatTotal     += (food.fat     || 0) * quantity;
    proteinTotal += (food.protein || 0) * quantity;
  }
  return {
    fatTotal:     Math.round(fatTotal     * 10) / 10,
    proteinTotal: Math.round(proteinTotal * 10) / 10,
  };
}

function buildDay(user, date, foods) {
  const dd    = user.days?.[date] || { entries: [], total: 0 };
  const water = user.water?.[date] || 0;
  const steps = user.steps?.[date] || 0;
  const total = +(dd.total || 0).toFixed(2);
  const { fatTotal, proteinTotal } = computeDayNutrition(dd.entries, foods || {});
  const proteinGoal = user.weight || 70;
  return {
    date,
    total,
    entries:      dd.entries || [],
    water,
    steps,
    fatTotal,
    proteinTotal,
    inLimit:      total <= user.dailyLimit,
    fatInLimit:   fatTotal <= FAT_LIMIT,
    proteinMet:   proteinTotal >= proteinGoal,
    waterGoal:    water >= (user.waterLimit || 2000),
    stepsGoalMet: steps > 0 && steps >= (user.stepsGoal || 10000),
    active:       total > 0 || water > 0 || steps > 0,
  };
}

function calcStreak(days, field) {
  let s = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (!days[i].active) break;
    if (days[i][field]) s++;
    else break;
  }
  return s;
}

function wavg(days, field) {
  const active = days.filter(d => d.active);
  if (!active.length) return 0;
  return Math.round((active.reduce((s, d) => s + d[field], 0) / active.length) * 10) / 10;
}

function buildRecs(u) {
  const recs = [];
  const { todayStat: t, week, carbStreak: cs, waterStreak: ws,
          avgCarbsWeek: ac, avgWaterWeek: aw,
          dailyLimit: dl, waterLimit: wl,
          weekCarbSuccess, weekActiveCount } = u;

  if      (cs >= 7) recs.push({ type: 'success', icon: '🏆', text: `${cs} ימים ברצף בגבול הפחמימות — עקביות מדהימה!` });
  else if (cs >= 3) recs.push({ type: 'success', icon: '🔥', text: `${cs} ימים ברצף בגבול הפחמימות — כל הכבוד, תמשיכו!` });
  if      (ws >= 5) recs.push({ type: 'success', icon: '💧', text: `${ws} ימים ברצף עם יעד המים — הרגל הידרציה מצוין!` });

  if (t.total > dl) {
    recs.push({ type: 'danger', icon: '🚫', text: `היום חרגת ב-${(t.total - dl).toFixed(1)} מנות מהגבול. נסה/י אפשרויות קלות יותר לשארית היום.` });
  } else if (!t.active) {
    recs.push({ type: 'info', icon: '📝', text: `לא נרשם כלום היום עדיין — אל תשכח/י לעקוב אחר הארוחות והמים.` });
  }

  if      (t.water === 0)       recs.push({ type: 'warning', icon: '💧', text: `לא נרשמו מים היום — התחל/י עם כוס מים עכשיו!` });
  else if (t.water < wl * 0.5) recs.push({ type: 'info',    icon: '🥤', text: `נותרו ${wl - t.water} מ"ל להיום. תמשיך/י לשתות!` });

  if (ac > dl * 1.1 && ac > 0)  recs.push({ type: 'warning', icon: '📈', text: `הממוצע השבועי (${ac}) מעל המגבלה שלך (${dl} מנות). שים/י לב לדפוסים עתירי פחמימות.` });
  if (aw < wl * 0.75 && aw > 0) recs.push({ type: 'warning', icon: '🚰', text: `ממוצע מים השבוע (${aw} מ"ל) מתחת ליעד (${wl} מ"ל). נסה/י תזכורות כל שעה.` });

  const overDays = week.filter(d => d.active && !d.inLimit);
  if (overDays.length >= 3 && weekActiveCount > 0)
    recs.push({ type: 'warning', icon: '🗓️', text: `${overDays.length} מתוך ${weekActiveCount} ימים פעילים חרגו מגבול הפחמימות השבוע.` });

  if (weekActiveCount >= 5 && weekCarbSuccess === weekActiveCount)
    recs.push({ type: 'success', icon: '⭐', text: `שבוע מושלם! כל ${weekActiveCount} הימים הפעילים בגבול הפחמימות.` });

  if (ac < dl * 0.6 && ac > 0)
    recs.push({ type: 'info', icon: '💡', text: `אתה/את מתחת לגבול הפחמימות (ממוצע ${ac}/${dl}). וודא/י שאוכלים מספיק!` });

  return recs.slice(0, 6);
}

function computeStats(usersData, foods) {
  const today = dateKey(0);
  const last7  = dateRange(7);
  const last30 = dateRange(30);
  const foodsMap = foods || {};

  return Object.entries(usersData).map(([userId, user]) => {
    const week      = last7.map(d  => buildDay(user, d, foodsMap));
    const month     = last30.map(d => buildDay(user, d, foodsMap));
    const todayStat = buildDay(user, today, foodsMap);

    const carbStreak  = calcStreak(month, 'inLimit');
    const waterStreak = calcStreak(month, 'waterGoal');
    const avgCarbsWeek  = wavg(week,  'total');
    const avgWaterWeek  = wavg(week,  'water');
    const avgCarbsMonth = wavg(month, 'total');
    const avgWaterMonth = wavg(month, 'water');

    const weekActiveCount   = week.filter(d  => d.active).length;
    const monthActiveCount  = month.filter(d => d.active).length;
    const weekCarbSuccess   = week.filter(d  => d.active && d.inLimit).length;
    const weekWaterSuccess  = week.filter(d  => d.active && d.waterGoal).length;
    const monthCarbSuccess  = month.filter(d => d.active && d.inLimit).length;
    const monthWaterSuccess = month.filter(d => d.active && d.waterGoal).length;

    const foodMap = {};
    for (const day of week)
      for (const e of day.entries)
        foodMap[e.item] = (foodMap[e.item] || 0) + e.portions;
    const topFoods = Object.entries(foodMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([item, portions]) => ({ item, portions: Math.round(portions * 10) / 10 }));

    const proteinGoal  = user.weight || 70;
    const avgFatWeek   = wavg(week,  'fatTotal');
    const avgProtWeek  = wavg(week,  'proteinTotal');
    const weekFatOk    = week.filter(d  => d.active && d.fatInLimit).length;
    const weekProtMet  = week.filter(d  => d.active && d.proteinMet).length;

    return {
      userId,
      firstName:   user.firstName || 'משתמש',
      dailyLimit:  user.dailyLimit,
      waterLimit:  user.waterLimit || 2000,
      stepsGoal:   user.stepsGoal  || 10000,
      fatLimit:    FAT_LIMIT,
      proteinGoal,
      today:       todayStat,
      week,
      month,
      carbStreak,  waterStreak,
      avgCarbsWeek, avgWaterWeek,
      avgCarbsMonth, avgWaterMonth,
      avgFatWeek,  avgProtWeek,
      weekCarbSuccess,  weekWaterSuccess,  weekActiveCount,
      monthCarbSuccess, monthWaterSuccess, monthActiveCount,
      weekFatOk,   weekProtMet,
      topFoods,
      recs: buildRecs({ todayStat, week, dailyLimit: user.dailyLimit, waterLimit: user.waterLimit || 2000, carbStreak, waterStreak, avgCarbsWeek, avgWaterWeek, weekCarbSuccess, weekActiveCount }),
    };
  });
}

// ─── SVG progress ring ────────────────────────────────────────────────────────

const COLOR = { success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#6366f1' };

function ring(pctVal, color, label) {
  const r = 38, c = 2 * Math.PI * r;
  const offset = c - (Math.min(pctVal, 100) / 100) * c;
  const col = COLOR[color] || COLOR.info;
  return `<svg viewBox="0 0 100 100" width="96" height="96">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="9"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 50 50)"/>
    <text x="50" y="55" text-anchor="middle" font-size="12" font-weight="700"
      font-family="inherit" fill="${col}" direction="ltr">${label}</text>
  </svg>`;
}

// ─── User section HTML ────────────────────────────────────────────────────────

function pct(v, total) { return total ? Math.min(100, Math.round((v / total) * 100)) : 0; }

function userSection(s, today) {
  const { dailyLimit: dl, waterLimit: wl, stepsGoal: sg, fatLimit: fl, proteinGoal: pg } = s;
  const t = s.today;

  const carbPct    = pct(t.total,        dl);
  const waterPct   = pct(t.water,        wl);
  const stepsPct   = pct(t.steps,        sg);
  const fatPct     = pct(t.fatTotal,     fl);
  const protPct    = pct(t.proteinTotal, pg);
  const carbColor  = carbPct  <= 100 ? 'success' : carbPct  <= 125 ? 'warning' : 'danger';
  const waterColor = waterPct >= 100 ? 'success' : waterPct >=  70 ? 'warning' : 'danger';
  const stepsColor = stepsPct >= 100 ? 'success' : stepsPct >=  70 ? 'warning' : 'danger';
  const fatColor   = fatPct   <= 100 ? 'success' : fatPct   <= 125 ? 'warning' : 'danger';
  const protColor  = protPct  >= 100 ? 'success' : protPct  >=  70 ? 'warning' : 'danger';

  const hasSteps       = s.week.some(d => d.steps > 0) || t.steps > 0;
  const weekPct        = s.weekActiveCount  ? Math.round((s.weekCarbSuccess  / s.weekActiveCount)  * 100) : 0;
  const monthCarbPct   = s.monthActiveCount ? Math.round((s.monthCarbSuccess  / s.monthActiveCount) * 100) : 0;
  const monthWaterPct  = s.monthActiveCount ? Math.round((s.monthWaterSuccess / s.monthActiveCount) * 100) : 0;
  const weekScoreColor = weekPct >= 70 ? 'success' : weekPct >= 50 ? 'warning' : 'danger';

  const weekGrid = s.week.map(d => {
    const isToday   = d.date === today;
    const carbIcon  = !d.active ? '⬜' : d.inLimit ? '✅' : '❌';
    const waterIcon = !d.active ? '' : d.waterGoal ? '💧' : '🚫';
    const valCarb   = d.active ? d.total : '—';
    const valWater  = d.active ? (d.water >= 1000 ? (d.water / 1000).toFixed(1) + 'L' : d.water + 'מ"ל') : '';
    return `<div class="wday${isToday ? ' today' : ''}${!d.active ? ' dim' : ''}">
  <div class="wday-name">${shortDay(d.date)}</div>
  <div class="wday-carb">${carbIcon}<span>${valCarb}</span></div>
  <div class="wday-water">${waterIcon}<span>${valWater}</span></div>
</div>`;
  }).join('');

  const recCards = s.recs.map(r =>
    `<div class="rec rec-${r.type}"><span class="rec-icon">${r.icon}</span><span>${r.text}</span></div>`
  ).join('');

  const topFoodsRows = s.topFoods.length
    ? s.topFoods.map((f, i) => `<tr><td class="rank">${i + 1}#</td><td>${f.item}</td><td class="num">${f.portions}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">לא נרשם מזון השבוע</td></tr>';

  const logRows = t.entries.length
    ? t.entries.map((e, i) => `<tr><td class="rank">${i + 1}</td><td class="time">${e.time || ''}</td><td>${e.item}</td><td class="num">${e.portions}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">אין רשומות להיום</td></tr>';

  const fatCard = `
<div class="stat-card ${fatColor}">
  <div class="card-label">שומן היום</div>
  <div class="ring-wrap">${ring(fatPct, fatColor, `${t.fatTotal}/${fl}`)}</div>
  <div class="card-sub">נקודות שומן</div>
  <div class="card-status ${fatColor}">${fatPct <= 100 ? `נותרו ${(fl - t.fatTotal).toFixed(1)}` : `חריגה של ${(t.fatTotal - fl).toFixed(1)}`}</div>
</div>`;

  const protCard = `
<div class="stat-card ${protColor}">
  <div class="card-label">חלבון היום</div>
  <div class="ring-wrap">${ring(protPct, protColor, `${t.proteinTotal}/${pg}`)}</div>
  <div class="card-sub">גרם (יעד ${pg}ג׳)</div>
  <div class="card-status ${protColor}">${protPct >= 100 ? 'יעד הושג! 💪' : `עוד ${Math.max(0, pg - t.proteinTotal).toFixed(1)}ג׳`}</div>
</div>`;

  const stepsCard = hasSteps ? `
<div class="stat-card ${stepsColor}">
  <div class="card-label">צעדים היום</div>
  <div class="ring-wrap">${ring(stepsPct, stepsColor, t.steps.toLocaleString())}</div>
  <div class="card-sub">מתוך ${sg.toLocaleString()} יעד</div>
  <div class="card-status ${stepsColor}">${stepsPct >= 100 ? 'הגעת ליעד! 🎉' : `${(sg - t.steps).toLocaleString()} לסיום`}</div>
</div>` : '';

  return `
<section class="user-block">
  <div class="user-header">
    <div class="avatar">${s.firstName.charAt(0)}</div>
    <div class="user-meta">
      <h2>${s.firstName}</h2>
      <p>🍞 גבול פחמימות: <strong>${dl}</strong> &nbsp;•&nbsp; 🧈 גבול שומן: <strong>${fl}</strong> &nbsp;•&nbsp; 💪 יעד חלבון: <strong>${pg}ג׳</strong> &nbsp;•&nbsp; 💧 יעד מים: <strong>${wl} מ"ל</strong>${hasSteps ? ` &nbsp;•&nbsp; 🚶 יעד צעדים: <strong>${sg.toLocaleString()}</strong>` : ''}</p>
    </div>
    <div class="streaks">
      <span class="streak">🔥 ${s.carbStreak} ימי פחמימות</span>
      <span class="streak">💧 ${s.waterStreak} ימי מים</span>
    </div>
  </div>

  <div class="section-label">סיכום היום</div>
  <div class="cards">
    <div class="stat-card ${carbColor}">
      <div class="card-label">פחמימות היום</div>
      <div class="ring-wrap">${ring(carbPct, carbColor, `${t.total}/${dl}`)}</div>
      <div class="card-sub">מנות</div>
      <div class="card-status ${carbColor}">${carbPct <= 100 ? `נותרו ${Math.max(0, dl - t.total).toFixed(1)}` : `חריגה של ${(t.total - dl).toFixed(1)}`}</div>
    </div>
    ${fatCard}
    ${protCard}
    <div class="stat-card ${waterColor}">
      <div class="card-label">מים היום</div>
      <div class="ring-wrap">${ring(waterPct, waterColor, `${t.water}`)}</div>
      <div class="card-sub">מתוך ${wl} מ"ל יעד</div>
      <div class="card-status ${waterColor}">${waterPct >= 100 ? 'הגעת ליעד! 🎉' : `נותרו ${wl - t.water} מ"ל`}</div>
    </div>
    ${stepsCard}
    <div class="stat-card week-card">
      <div class="card-label">ציון שבועי</div>
      <div class="score-num ${weekScoreColor}">${weekPct}%</div>
      <div class="score-sub">ימים בגבול הפחמימות</div>
      <div class="score-detail">${s.weekCarbSuccess}/${s.weekActiveCount} ימים פעילים</div>
      <div class="score-water">🧈 ${s.weekFatOk}/${s.weekActiveCount} ימי שומן &nbsp;💪 ${s.weekProtMet}/${s.weekActiveCount} ימי חלבון</div>
      <div class="score-water">💧 ${s.weekWaterSuccess}/${s.weekActiveCount} ימי מים</div>
    </div>
  </div>

  <div class="section-label">7 ימים אחרונים</div>
  <div class="week-grid">${weekGrid}</div>

  <div class="charts-row">
    <div class="chart-card">
      <div class="chart-title">פחמימות — 7 ימים</div>
      <canvas id="carb-${s.userId}" height="150"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">שומן — 7 ימים</div>
      <canvas id="fat-${s.userId}" height="150"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">חלבון — 7 ימים</div>
      <canvas id="prot-${s.userId}" height="150"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">צריכת מים — 7 ימים</div>
      <canvas id="water-${s.userId}" height="150"></canvas>
    </div>
  </div>

  <div class="section-label">סקירה חודשית (30 ימים אחרונים)</div>
  <div class="month-grid">
    <div class="mstat"><div class="mval ${monthCarbPct >= 70 ? 'success' : monthCarbPct >= 50 ? 'warning' : 'danger'}">${monthCarbPct}%</div><div class="mlabel">ימים בגבול הפחמימות</div><div class="msub">${s.monthCarbSuccess}/${s.monthActiveCount} ימים פעילים</div></div>
    <div class="mstat"><div class="mval">${s.avgCarbsMonth}</div><div class="mlabel">ממוצע פחמימות יומי</div><div class="msub">גבול: ${dl}</div></div>
    <div class="mstat"><div class="mval">${s.avgFatWeek}</div><div class="mlabel">ממוצע שומן שבועי</div><div class="msub">גבול: ${fl} נקודות</div></div>
    <div class="mstat"><div class="mval">${s.avgProtWeek}ג׳</div><div class="mlabel">ממוצע חלבון שבועי</div><div class="msub">יעד: ${pg}ג׳</div></div>
    <div class="mstat"><div class="mval ${monthWaterPct >= 70 ? 'success' : 'warning'}">${monthWaterPct}%</div><div class="mlabel">ימים עם יעד מים</div><div class="msub">${s.monthWaterSuccess}/${s.monthActiveCount} ימים פעילים</div></div>
    <div class="mstat"><div class="mval">${s.avgWaterMonth} מ"ל</div><div class="mlabel">ממוצע מים יומי</div><div class="msub">יעד: ${wl} מ"ל</div></div>
  </div>

  ${s.recs.length ? `<div class="section-label">המלצות ותובנות</div><div class="recs">${recCards}</div>` : ''}

  <div class="two-col">
    <div>
      <div class="section-label">המאכלים המובילים השבוע</div>
      <table class="dtable">
        <thead><tr><th>#</th><th>מאכל</th><th>מנות</th></tr></thead>
        <tbody>${topFoodsRows}</tbody>
      </table>
    </div>
    <div>
      <div class="section-label">יומן מזון היום</div>
      <table class="dtable">
        <thead><tr><th>#</th><th>שעה</th><th>מאכל</th><th>מנות</th></tr></thead>
        <tbody>${logRows}</tbody>
      </table>
    </div>
  </div>
</section>`;
}

// ─── Chart script ─────────────────────────────────────────────────────────────

function chartScript(allStats) {
  return allStats.map(s => {
    const labels  = JSON.stringify(s.week.map(d => shortDay(d.date)));
    const carbs   = JSON.stringify(s.week.map(d => d.total));
    const fats    = JSON.stringify(s.week.map(d => d.fatTotal));
    const prots   = JSON.stringify(s.week.map(d => d.proteinTotal));
    const waters  = JSON.stringify(s.week.map(d => d.water));
    const carbBg  = JSON.stringify(s.week.map(d => d.total     <= s.dailyLimit   ? 'rgba(34,197,94,.7)'    : 'rgba(239,68,68,.7)'));
    const carbBdr = JSON.stringify(s.week.map(d => d.total     <= s.dailyLimit   ? '#16a34a'               : '#dc2626'));
    const fatBg   = JSON.stringify(s.week.map(d => d.fatTotal  <= s.fatLimit     ? 'rgba(251,146,60,.75)'  : 'rgba(239,68,68,.7)'));
    const fatBdr  = JSON.stringify(s.week.map(d => d.fatTotal  <= s.fatLimit     ? '#ea580c'               : '#dc2626'));
    const protBg  = JSON.stringify(s.week.map(d => d.proteinTotal >= s.proteinGoal ? 'rgba(59,130,246,.75)' : 'rgba(148,163,184,.5)'));
    const protBdr = JSON.stringify(s.week.map(d => d.proteinTotal >= s.proteinGoal ? '#2563eb'              : '#94a3b8'));
    const watBg   = JSON.stringify(s.week.map(d => d.water     >= s.waterLimit   ? 'rgba(99,102,241,.75)'  : 'rgba(148,163,184,.5)'));
    const watBdr  = JSON.stringify(s.week.map(d => d.water     >= s.waterLimit   ? '#4f46e5'               : '#94a3b8'));
    const dl = s.dailyLimit, fl = s.fatLimit, pg = s.proteinGoal, wl = s.waterLimit, uid = s.userId;

    return `(function(){
  const base=(extra)=>({responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10},...(extra||{})}},x:{grid:{display:false},ticks:{font:{size:10,family:'inherit'}}}}});
  const cc=document.getElementById('carb-${uid}');
  if(cc) new Chart(cc,{type:'bar',data:{labels:${labels},datasets:[
    {data:${carbs},backgroundColor:${carbBg},borderColor:${carbBdr},borderWidth:2,borderRadius:5},
    {data:Array(7).fill(${dl}),type:'line',borderColor:'#f59e0b',borderWidth:2,borderDash:[5,5],pointRadius:0,fill:false}
  ]},options:base()});
  const fc=document.getElementById('fat-${uid}');
  if(fc) new Chart(fc,{type:'bar',data:{labels:${labels},datasets:[
    {data:${fats},backgroundColor:${fatBg},borderColor:${fatBdr},borderWidth:2,borderRadius:5},
    {data:Array(7).fill(${fl}),type:'line',borderColor:'#dc2626',borderWidth:2,borderDash:[5,5],pointRadius:0,fill:false}
  ]},options:base()});
  const pc=document.getElementById('prot-${uid}');
  if(pc) new Chart(pc,{type:'bar',data:{labels:${labels},datasets:[
    {data:${prots},backgroundColor:${protBg},borderColor:${protBdr},borderWidth:2,borderRadius:5},
    {data:Array(7).fill(${pg}),type:'line',borderColor:'#2563eb',borderWidth:2,borderDash:[5,5],pointRadius:0,fill:false}
  ]},options:base()});
  const wc=document.getElementById('water-${uid}');
  if(wc) new Chart(wc,{type:'bar',data:{labels:${labels},datasets:[
    {data:${waters},backgroundColor:${watBg},borderColor:${watBdr},borderWidth:2,borderRadius:5},
    {data:Array(7).fill(${wl}),type:'line',borderColor:'#6366f1',borderWidth:2,borderDash:[5,5],pointRadius:0,fill:false}
  ]},options:base({callback:v=>v>=1000?(v/1000).toFixed(1)+'L':v})});
})();`;
  }).join('\n');
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Hebrew',sans-serif;background:#f0f4f8;color:#1e293b;line-height:1.5}
.page{max-width:1100px;margin:0 auto;padding:24px 16px}
.hdr{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-radius:16px;padding:24px 32px;margin-bottom:24px;box-shadow:0 4px 24px rgba(99,102,241,.35)}
.hdr-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.hdr h1{font-size:1.75rem;font-weight:800}
.hdr .sub{opacity:.85;font-size:.9rem;margin-top:4px}
.hdr-right{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tag{padding:4px 12px;border-radius:20px;font-size:.78rem;font-weight:600;background:rgba(255,255,255,.2);color:#fff}
.user-block{background:#fff;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.user-header{display:flex;align-items:center;gap:16px;padding-bottom:20px;border-bottom:2px solid #f1f5f9;margin-bottom:4px;flex-wrap:wrap}
.avatar{width:52px;height:52px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:1.5rem;font-weight:800;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.user-meta{flex:1}
.user-meta h2{font-size:1.35rem;font-weight:700}
.user-meta p{font-size:.83rem;color:#64748b;margin-top:3px}
.streaks{display:flex;gap:8px;flex-wrap:wrap}
.streak{background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:20px;font-size:.78rem;font-weight:600}
.section-label{font-size:.72rem;font-weight:800;letter-spacing:.04em;color:#94a3b8;margin:20px 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.stat-card{background:#f8fafc;border-radius:12px;padding:16px 12px;text-align:center;border:2px solid #e2e8f0;transition:transform .15s}
.stat-card:hover{transform:translateY(-2px)}
.stat-card.success{border-color:#bbf7d0;background:#f0fdf4}
.stat-card.warning{border-color:#fde68a;background:#fffbeb}
.stat-card.danger{border-color:#fecaca;background:#fef2f2}
.card-label{font-size:.72rem;font-weight:800;color:#64748b;margin-bottom:6px}
.ring-wrap{display:flex;justify-content:center;margin:4px 0}
.card-sub{font-size:.75rem;color:#94a3b8;margin-top:2px}
.card-status{font-size:.78rem;font-weight:700;margin-top:6px}
.card-status.success{color:#16a34a}
.card-status.warning{color:#d97706}
.card-status.danger{color:#dc2626}
.week-card{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px}
.score-num{font-size:2.6rem;font-weight:900;line-height:1.1;direction:ltr}
.score-num.success{color:#16a34a}
.score-num.warning{color:#d97706}
.score-num.danger{color:#dc2626}
.score-sub{font-size:.72rem;color:#64748b}
.score-detail{font-size:.72rem;color:#94a3b8;margin-top:2px}
.score-water{font-size:.72rem;color:#64748b;margin-top:4px}
.week-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:4px}
.wday{background:#f8fafc;border-radius:10px;padding:10px 4px;text-align:center;border:2px solid #e2e8f0;font-size:.78rem}
.wday.today{border-color:#6366f1;background:#eef2ff}
.wday.dim{opacity:.45}
.wday-name{font-weight:800;font-size:.7rem;color:#64748b;margin-bottom:5px}
.wday-carb span,.wday-water span{display:block;font-size:.65rem;color:#94a3b8;margin-top:1px;direction:ltr}
.wday-water{margin-top:4px;color:#64748b}
.charts-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:4px 0}
.chart-card{background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0}
.chart-title{font-size:.75rem;font-weight:800;color:#64748b;margin-bottom:8px}
.month-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.mstat{background:#f8fafc;border-radius:10px;padding:14px;text-align:center;border:1px solid #e2e8f0}
.mval{font-size:1.9rem;font-weight:900;color:#1e293b;direction:ltr}
.mval.success{color:#16a34a}
.mval.warning{color:#d97706}
.mval.danger{color:#dc2626}
.mlabel{font-size:.75rem;font-weight:600;color:#475569;margin-top:3px}
.msub{font-size:.68rem;color:#94a3b8;margin-top:2px}
.recs{display:flex;flex-direction:column;gap:8px}
.rec{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;font-size:.86rem;line-height:1.5}
.rec-success{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.rec-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.rec-danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.rec-info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
.rec-icon{font-size:1.1rem;flex-shrink:0}
.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:4px}
.dtable{width:100%;border-collapse:collapse;font-size:.83rem}
.dtable th{background:#f1f5f9;text-align:right;padding:7px 10px;font-size:.7rem;font-weight:800;color:#64748b}
.dtable td{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right}
.dtable tr:last-child td{border-bottom:none}
.dtable .rank{color:#94a3b8;font-weight:700;width:32px;direction:ltr;text-align:center}
.dtable .num{color:#6366f1;font-weight:700;direction:ltr;text-align:left}
.dtable .time{color:#94a3b8;font-size:.78rem;direction:ltr;text-align:center}
.dtable .empty{text-align:center;color:#94a3b8;padding:16px;font-style:italic}
footer{text-align:center;color:#94a3b8;font-size:.78rem;padding:16px 0 8px}
@media(max-width:640px){
  .week-grid{gap:4px}
  .wday{padding:6px 2px}
  .wday-name{font-size:.6rem}
  .cards{grid-template-columns:repeat(2,1fr)}
  .hdr{padding:16px}
  .hdr h1{font-size:1.3rem}
}
`;

// ─── Public API ───────────────────────────────────────────────────────────────

function generateHTML(usersData, foodsData) {
  const today = dateKey(0);
  const now = new Date().toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const allStats  = computeStats(usersData, foodsData);
  const sections  = allStats.map(s => userSection(s, today)).join('\n');
  const userCount = allStats.length;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>דשבורד מעקב פחמימות</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>${CSS}</style>
</head>
<body>
<div class="page">
<header class="hdr">
  <div class="hdr-inner">
    <div>
      <h1>🥗 דשבורד מעקב פחמימות</h1>
      <p class="sub">סיכום מעקב בריאות יומי ושבועי</p>
    </div>
    <div class="hdr-right">
      <span class="tag">📅 ${now}</span>
      <span class="tag">👥 ${userCount} ${userCount === 1 ? 'משתמש' : 'משתמשים'}</span>
    </div>
  </div>
</header>
<main>${sections}</main>
<footer>דשבורד מעקב פחמימות &nbsp;•&nbsp; PeretsCarbApp &nbsp;•&nbsp; ${now}</footer>
</div>
<script>${chartScript(allStats)}</script>
</body>
</html>`;
}

module.exports = { generateHTML };
