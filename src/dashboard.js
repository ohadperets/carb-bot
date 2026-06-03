'use strict';

/**
 * Dashboard HTML generator.
 * Pure function — takes raw users data object, returns HTML string.
 * No file I/O, no Telegram deps.
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

function shortDay(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function buildDay(user, date) {
  const dd    = user.days?.[date] || { entries: [], total: 0 };
  const water = user.water?.[date] || 0;
  const steps = user.steps?.[date] || 0;
  const total = +(dd.total || 0).toFixed(2);
  return {
    date,
    total,
    entries:      dd.entries || [],
    water,
    steps,
    inLimit:      total <= user.dailyLimit,
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

  if      (cs >= 7) recs.push({ type: 'success', icon: '🏆', text: `${cs}-day carb success streak — incredible consistency!` });
  else if (cs >= 3) recs.push({ type: 'success', icon: '🔥', text: `${cs}-day carb streak — keep it going!` });
  if      (ws >= 5) recs.push({ type: 'success', icon: '💧', text: `${ws} consecutive days hitting water goal — great hydration habit!` });

  if (t.total > dl) {
    recs.push({ type: 'danger', icon: '🚫', text: `Today is ${(t.total - dl).toFixed(1)} portions over limit. Try lighter options for the rest of the day.` });
  } else if (!t.active) {
    recs.push({ type: 'info', icon: '📝', text: `Nothing logged today yet — don't forget to track your meals and water.` });
  }

  if      (t.water === 0)         recs.push({ type: 'warning', icon: '💧', text: `No water logged today — start with a glass right now!` });
  else if (t.water < wl * 0.5)   recs.push({ type: 'info',    icon: '🥤', text: `${wl - t.water}ml remaining today. Keep drinking!` });

  if (ac > dl * 1.1 && ac > 0)   recs.push({ type: 'warning', icon: '📈', text: `Weekly carb average (${ac}) is above your ${dl}-portion limit. Watch for high-carb patterns.` });
  if (aw < wl * 0.75 && aw > 0)  recs.push({ type: 'warning', icon: '🚰', text: `Avg water this week (${aw}ml) is below goal (${wl}ml). Try hourly reminders.` });

  const overDays = week.filter(d => d.active && !d.inLimit);
  if (overDays.length >= 3 && weekActiveCount > 0)
    recs.push({ type: 'warning', icon: '🗓️', text: `${overDays.length}/${weekActiveCount} active days exceeded carb limit this week.` });

  if (weekActiveCount >= 5 && weekCarbSuccess === weekActiveCount)
    recs.push({ type: 'success', icon: '⭐', text: `Perfect week! All ${weekActiveCount} active days within carb limit.` });

  if (ac < dl * 0.6 && ac > 0)
    recs.push({ type: 'info', icon: '💡', text: `You're well below your carb limit (avg ${ac}/${dl}). Make sure you're eating enough!` });

  return recs.slice(0, 6);
}

function computeStats(usersData) {
  const today = dateKey(0);
  const last7  = dateRange(7);
  const last30 = dateRange(30);

  return Object.entries(usersData).map(([userId, user]) => {
    const week  = last7.map(d  => buildDay(user, d));
    const month = last30.map(d => buildDay(user, d));
    const todayStat = buildDay(user, today);

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

    const recInput = {
      todayStat, week, dailyLimit: user.dailyLimit,
      waterLimit: user.waterLimit || 2000,
      carbStreak, waterStreak,
      avgCarbsWeek, avgWaterWeek,
      weekCarbSuccess, weekActiveCount,
    };

    return {
      userId,
      firstName:   user.firstName || 'User',
      dailyLimit:  user.dailyLimit,
      waterLimit:  user.waterLimit || 2000,
      stepsGoal:   user.stepsGoal  || 10000,
      today:       todayStat,
      week,
      month,
      carbStreak,  waterStreak,
      avgCarbsWeek, avgWaterWeek,
      avgCarbsMonth, avgWaterMonth,
      weekCarbSuccess,  weekWaterSuccess,  weekActiveCount,
      monthCarbSuccess, monthWaterSuccess, monthActiveCount,
      topFoods,
      recs: buildRecs(recInput),
    };
  });
}

// ─── SVG progress ring ────────────────────────────────────────────────────────

const COLOR = { success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#6366f1' };

function ring(pctVal, color, label) {
  const r = 38, c = 2 * Math.PI * r;
  const offset = c - (Math.min(pctVal, 100) / 100) * c;
  const col = COLOR[color] || COLOR.info;
  return `<svg class="ring" viewBox="0 0 100 100" width="96" height="96">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="9"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="9"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 50 50)"/>
    <text x="50" y="55" text-anchor="middle" font-size="12" font-weight="700"
      font-family="inherit" fill="${col}">${label}</text>
  </svg>`;
}

// ─── User section HTML ────────────────────────────────────────────────────────

function pct(v, total) { return total ? Math.min(100, Math.round((v / total) * 100)) : 0; }

function userSection(s, today) {
  const { dailyLimit: dl, waterLimit: wl, stepsGoal: sg } = s;
  const t = s.today;

  const carbPct  = pct(t.total, dl);
  const waterPct = pct(t.water, wl);
  const stepsPct = pct(t.steps, sg);
  const carbColor  = carbPct  <= 100 ? 'success' : carbPct  <= 125 ? 'warning' : 'danger';
  const waterColor = waterPct >= 100 ? 'success' : waterPct >=  70 ? 'warning' : 'danger';
  const stepsColor = stepsPct >= 100 ? 'success' : stepsPct >=  70 ? 'warning' : 'danger';

  const hasSteps = s.week.some(d => d.steps > 0) || t.steps > 0;
  const weekPct = s.weekActiveCount ? Math.round((s.weekCarbSuccess / s.weekActiveCount) * 100) : 0;
  const monthCarbPct  = s.monthActiveCount ? Math.round((s.monthCarbSuccess  / s.monthActiveCount) * 100) : 0;
  const monthWaterPct = s.monthActiveCount ? Math.round((s.monthWaterSuccess / s.monthActiveCount) * 100) : 0;
  const weekScoreColor = weekPct >= 70 ? 'success' : weekPct >= 50 ? 'warning' : 'danger';

  const weekGrid = s.week.map(d => {
    const isToday   = d.date === today;
    const carbIcon  = !d.active ? '⬜' : d.inLimit ? '✅' : '❌';
    const waterIcon = !d.active ? '' : d.waterGoal ? '💧' : '🚫';
    const valCarb   = d.active ? d.total : '—';
    const valWater  = d.active ? (d.water >= 1000 ? (d.water / 1000).toFixed(1) + 'L' : d.water + 'ml') : '';
    return `<div class="wday${isToday ? ' today' : ''}${!d.active ? ' dim' : ''}">
  <div class="wday-name">${shortDay(d.date)}</div>
  <div class="wday-carb" title="${d.total}/${dl} portions">${carbIcon}<span>${valCarb}</span></div>
  <div class="wday-water" title="${d.water}/${wl}ml">${waterIcon}<span>${valWater}</span></div>
</div>`;
  }).join('');

  const recCards = s.recs.map(r =>
    `<div class="rec rec-${r.type}"><span class="rec-icon">${r.icon}</span><span>${r.text}</span></div>`
  ).join('');

  const topFoodsRows = s.topFoods.length
    ? s.topFoods.map((f, i) => `<tr><td class="rank">#${i + 1}</td><td>${f.item}</td><td class="num">${f.portions}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No food logged this week</td></tr>';

  const logRows = t.entries.length
    ? t.entries.map((e, i) => `<tr><td class="rank">${i + 1}</td><td class="time">${e.time || ''}</td><td>${e.item}</td><td class="num">${e.portions}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No entries today</td></tr>';

  const stepsCard = hasSteps ? `
<div class="stat-card ${stepsColor}">
  <div class="card-label">Steps Today</div>
  <div class="ring-wrap">${ring(stepsPct, stepsColor, t.steps.toLocaleString())}</div>
  <div class="card-sub">of ${sg.toLocaleString()} goal</div>
  <div class="card-status ${stepsColor}">${stepsPct >= 100 ? 'Goal reached! 🎉' : `${(sg - t.steps).toLocaleString()} to go`}</div>
</div>` : '';

  return `
<section class="user-block">
  <div class="user-header">
    <div class="avatar">${s.firstName.charAt(0).toUpperCase()}</div>
    <div class="user-meta">
      <h2>${s.firstName}</h2>
      <p>Carb limit: <strong>${dl}</strong> portions &nbsp;•&nbsp; Water goal: <strong>${wl}ml</strong>${hasSteps ? ` &nbsp;•&nbsp; Steps goal: <strong>${sg.toLocaleString()}</strong>` : ''}</p>
    </div>
    <div class="streaks">
      <span class="streak">🔥 ${s.carbStreak}d carb streak</span>
      <span class="streak">💧 ${s.waterStreak}d water streak</span>
    </div>
  </div>

  <div class="section-label">Today's Summary</div>
  <div class="cards">
    <div class="stat-card ${carbColor}">
      <div class="card-label">Carbs Today</div>
      <div class="ring-wrap">${ring(carbPct, carbColor, `${t.total}/${dl}`)}</div>
      <div class="card-sub">portions</div>
      <div class="card-status ${carbColor}">${carbPct <= 100 ? `${Math.max(0, dl - t.total).toFixed(1)} remaining` : `${(t.total - dl).toFixed(1)} over limit`}</div>
    </div>
    <div class="stat-card ${waterColor}">
      <div class="card-label">Water Today</div>
      <div class="ring-wrap">${ring(waterPct, waterColor, `${t.water}ml`)}</div>
      <div class="card-sub">of ${wl}ml goal</div>
      <div class="card-status ${waterColor}">${waterPct >= 100 ? 'Goal reached! 🎉' : `${wl - t.water}ml remaining`}</div>
    </div>
    ${stepsCard}
    <div class="stat-card week-card">
      <div class="card-label">Week Score</div>
      <div class="score-num ${weekScoreColor}">${weekPct}%</div>
      <div class="score-sub">carb days met</div>
      <div class="score-detail">${s.weekCarbSuccess}/${s.weekActiveCount} active days</div>
      <div class="score-water">💧 ${s.weekWaterSuccess}/${s.weekActiveCount} water days met</div>
    </div>
  </div>

  <div class="section-label">Last 7 Days</div>
  <div class="week-grid">${weekGrid}</div>

  <div class="charts-row">
    <div class="chart-card">
      <div class="chart-title">Carbohydrates — 7 days</div>
      <canvas id="carb-${s.userId}" height="150"></canvas>
    </div>
    <div class="chart-card">
      <div class="chart-title">Water intake — 7 days</div>
      <canvas id="water-${s.userId}" height="150"></canvas>
    </div>
  </div>

  <div class="section-label">Monthly Overview (last 30 days)</div>
  <div class="month-grid">
    <div class="mstat"><div class="mval ${monthCarbPct >= 70 ? 'success' : monthCarbPct >= 50 ? 'warning' : 'danger'}">${monthCarbPct}%</div><div class="mlabel">Carb days in limit</div><div class="msub">${s.monthCarbSuccess}/${s.monthActiveCount} active days</div></div>
    <div class="mstat"><div class="mval">${s.avgCarbsMonth}</div><div class="mlabel">Avg daily carbs</div><div class="msub">limit: ${dl}</div></div>
    <div class="mstat"><div class="mval ${monthWaterPct >= 70 ? 'success' : 'warning'}">${monthWaterPct}%</div><div class="mlabel">Water goal days</div><div class="msub">${s.monthWaterSuccess}/${s.monthActiveCount} active days</div></div>
    <div class="mstat"><div class="mval">${s.avgWaterMonth}ml</div><div class="mlabel">Avg daily water</div><div class="msub">goal: ${wl}ml</div></div>
  </div>

  ${s.recs.length ? `<div class="section-label">Recommendations &amp; Insights</div><div class="recs">${recCards}</div>` : ''}

  <div class="two-col">
    <div>
      <div class="section-label">Top Foods This Week</div>
      <table class="dtable">
        <thead><tr><th>#</th><th>Food</th><th>Portions</th></tr></thead>
        <tbody>${topFoodsRows}</tbody>
      </table>
    </div>
    <div>
      <div class="section-label">Today's Food Log</div>
      <table class="dtable">
        <thead><tr><th>#</th><th>Time</th><th>Food</th><th>Portions</th></tr></thead>
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
    const waters  = JSON.stringify(s.week.map(d => d.water));
    const carbBg  = JSON.stringify(s.week.map(d => d.total <= s.dailyLimit ? 'rgba(34,197,94,.7)'  : 'rgba(239,68,68,.7)'));
    const carbBdr = JSON.stringify(s.week.map(d => d.total <= s.dailyLimit ? '#16a34a' : '#dc2626'));
    const watBg   = JSON.stringify(s.week.map(d => d.water >= s.waterLimit ? 'rgba(59,130,246,.75)' : 'rgba(148,163,184,.5)'));
    const watBdr  = JSON.stringify(s.week.map(d => d.water >= s.waterLimit ? '#2563eb' : '#94a3b8'));
    const dl = s.dailyLimit, wl = s.waterLimit, uid = s.userId;

    return `(function(){
  const base=(extra)=>({responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10},...(extra||{})}},x:{grid:{display:false},ticks:{font:{size:10}}}}});
  const cc=document.getElementById('carb-${uid}');
  if(cc) new Chart(cc,{type:'bar',data:{labels:${labels},datasets:[
    {data:${carbs},backgroundColor:${carbBg},borderColor:${carbBdr},borderWidth:2,borderRadius:5},
    {data:Array(7).fill(${dl}),type:'line',borderColor:'#f59e0b',borderWidth:2,borderDash:[5,5],pointRadius:0,fill:false}
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
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;color:#1e293b;line-height:1.5}
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
.section-label{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin:20px 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px}
.stat-card{background:#f8fafc;border-radius:12px;padding:16px 12px;text-align:center;border:2px solid #e2e8f0;transition:transform .15s}
.stat-card:hover{transform:translateY(-2px)}
.stat-card.success{border-color:#bbf7d0;background:#f0fdf4}
.stat-card.warning{border-color:#fde68a;background:#fffbeb}
.stat-card.danger{border-color:#fecaca;background:#fef2f2}
.card-label{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px}
.ring-wrap{display:flex;justify-content:center;margin:4px 0}
.card-sub{font-size:.75rem;color:#94a3b8;margin-top:2px}
.card-status{font-size:.78rem;font-weight:700;margin-top:6px}
.card-status.success{color:#16a34a}
.card-status.warning{color:#d97706}
.card-status.danger{color:#dc2626}
.week-card{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px}
.score-num{font-size:2.6rem;font-weight:900;line-height:1.1}
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
.wday-name{font-weight:800;font-size:.65rem;color:#64748b;margin-bottom:5px;text-transform:uppercase}
.wday-carb span,.wday-water span{display:block;font-size:.65rem;color:#94a3b8;margin-top:1px}
.wday-water{margin-top:4px;color:#64748b}
.charts-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin:4px 0}
.chart-card{background:#f8fafc;border-radius:12px;padding:16px;border:1px solid #e2e8f0}
.chart-title{font-size:.72rem;font-weight:800;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.month-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.mstat{background:#f8fafc;border-radius:10px;padding:14px;text-align:center;border:1px solid #e2e8f0}
.mval{font-size:1.9rem;font-weight:900;color:#1e293b}
.mval.success{color:#16a34a}
.mval.warning{color:#d97706}
.mval.danger{color:#dc2626}
.mlabel{font-size:.75rem;font-weight:600;color:#475569;margin-top:3px}
.msub{font-size:.68rem;color:#94a3b8;margin-top:2px}
.recs{display:flex;flex-direction:column;gap:8px}
.rec{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;font-size:.86rem;line-height:1.4}
.rec-success{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.rec-warning{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.rec-danger{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.rec-info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}
.rec-icon{font-size:1.1rem;flex-shrink:0}
.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:4px}
.dtable{width:100%;border-collapse:collapse;font-size:.83rem}
.dtable th{background:#f1f5f9;text-align:left;padding:7px 10px;font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
.dtable td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
.dtable tr:last-child td{border-bottom:none}
.dtable .rank{color:#94a3b8;font-weight:700;width:32px}
.dtable .num{color:#6366f1;font-weight:700;text-align:right}
.dtable .time{color:#94a3b8;font-size:.78rem}
.dtable .empty{text-align:center;color:#94a3b8;padding:16px;font-style:italic}
footer{text-align:center;color:#94a3b8;font-size:.78rem;padding:16px 0 8px}
@media(max-width:640px){
  .week-grid{gap:4px}
  .wday{padding:6px 2px}
  .wday-name{font-size:.55rem}
  .cards{grid-template-columns:repeat(2,1fr)}
  .hdr{padding:16px}
  .hdr h1{font-size:1.3rem}
}
`;

// ─── Public API ───────────────────────────────────────────────────────────────

function generateHTML(usersData) {
  const today = dateKey(0);
  const now = new Date().toLocaleString('en-US', {
    timeZone:  'Asia/Jerusalem',
    weekday:   'long', year: 'numeric', month: 'long', day: 'numeric',
    hour:      '2-digit', minute: '2-digit',
  });

  const allStats = computeStats(usersData);
  const sections = allStats.map(s => userSection(s, today)).join('\n');
  const userCount = allStats.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Carb Tracker Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>${CSS}</style>
</head>
<body>
<div class="page">
<header class="hdr">
  <div class="hdr-inner">
    <div>
      <h1>🥗 Carb Tracker Dashboard</h1>
      <p class="sub">Daily &amp; weekly health tracking summary</p>
    </div>
    <div class="hdr-right">
      <span class="tag">📅 ${now}</span>
      <span class="tag">👥 ${userCount} user${userCount > 1 ? 's' : ''}</span>
    </div>
  </div>
</header>
<main>${sections}</main>
<footer>Carb Tracker Dashboard &nbsp;•&nbsp; PeretsCarbApp &nbsp;•&nbsp; ${now}</footer>
</div>
<script>${chartScript(allStats)}</script>
</body>
</html>`;
}

module.exports = { generateHTML };
