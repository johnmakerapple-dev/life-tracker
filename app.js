/* ============================================================
   Трекер активностей — чистый JS, без сборки и зависимостей.
   Все данные хранятся локально в браузере (localStorage).
   Структура data:
     categories: [{id, name, color, productive}]   // занятия с таймером
     habits:     [{id, name, color}]                // привычки/срывы — мгновенные тапы
     scales:     [{id, name, color}]                // шкалы самочувствия (оценка 1–5)
     sessions:   [{id, catId, start, end}]          // отрезки времени (мс)
     events:     [{id, habitId, ts, note?}]         // мгновенные события (+ пояснение)
     wellbeing:  [{id, ts, scores:{scaleId:1..5}, note?}]  // чек-ины самочувствия
     sleep:      { "YYYY-MM-DD": {bed,wake,quality?} | hours }  // сон к утру этой даты
   ============================================================ */

const STORE_KEY = "tracker_v1";

const DEFAULTS = {
  categories: [
    { id: "work",    name: "Работа",  color: "#3dd6b0", productive: true },
    { id: "study",   name: "Учёба",   color: "#5b9cff", productive: true },
    { id: "gym",     name: "Зал",     color: "#ff9f43", productive: true },
    { id: "read",    name: "Чтение",  color: "#c77dff", productive: true },
    { id: "rest",    name: "Отдых",   color: "#8aa0b0", productive: false },
  ],
  habits: [
    { id: "urge",  name: "Импульс/срыв", color: "#ff6b6b" },
    { id: "thoughts", name: "Плохие мысли", color: "#ff8fab" },
  ],
  scales: [
    { id: "mood",   name: "Настроение", color: "#3dd6b0" },
    { id: "energy", name: "Энергия",    color: "#5b9cff" },
    { id: "stress", name: "Стресс",     color: "#ff9f43" },
  ],
  sessions: [],
  events: [],
  wellbeing: [],
  sleep: {},
};

// ---------- storage ----------
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const d = JSON.parse(raw);
    // backfill missing keys for forward-compat
    return Object.assign(structuredClone(DEFAULTS), d);
  } catch (e) {
    console.error("load failed", e);
    return structuredClone(DEFAULTS);
  }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }

let data = load();

// ---------- helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => "id" + Math.random().toString(36).slice(2, 9);
const app = $("#app");

function dateKey(ms) {
  const d = new Date(ms);
  // local date YYYY-MM-DD
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function todayKey() { return dateKey(Date.now()); }

function fmtDur( sec ) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtHM(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h && m) return `${h}ч ${m}м`;
  if (h) return `${h}ч`;
  return `${m}м`;
}

function runningSession() { return data.sessions.find(s => s.end == null) || null; }
function cat(id) { return data.categories.find(c => c.id === id); }
function habit(id) { return data.habits.find(h => h.id === id); }
function scale(id) { return data.scales.find(s => s.id === id); }

let toastTimer = null;
// actions: optional array of { label, fn }
function toast(msg, actions = []) {
  const t = $("#toast");
  t.innerHTML = "";
  t.append(document.createTextNode(msg));
  for (const a of actions) {
    const b = document.createElement("button");
    b.textContent = a.label;
    b.onclick = () => { t.hidden = true; clearTimeout(toastTimer); a.fn(); };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

// ---------- actions ----------
function toggleActivity(catId) {
  const run = runningSession();
  const now = Date.now();
  if (run && run.catId === catId) {
    run.end = now; save(); render();
    return;
  }
  if (run) run.end = now;                 // stop any other running activity
  data.sessions.push({ id: uid(), catId, start: now, end: null });
  save(); render();
}

function logEvent(habitId) {
  const ev = { id: uid(), habitId, ts: Date.now() };
  data.events.push(ev); save();
  const h = habit(habitId);
  toast(`Отмечено: ${h ? h.name : "событие"}`, [
    { label: "Заметка", fn: () => {
        const note = prompt("Что именно за импульс/срыв? (необязательно)", ev.note || "");
        if (note != null) { ev.note = note.trim(); if (!ev.note) delete ev.note; save(); }
    } },
    { label: "Отменить", fn: () => {
        data.events = data.events.filter(e => e.id !== ev.id); save(); render();
    } },
  ]);
  render();
}

// log a wellbeing check-in: scores {scaleId:1..5}, optional note
function logWellbeing(scores, note) {
  if (!scores || !Object.keys(scores).length) { toast("Поставь хотя бы одну оценку"); return; }
  const entry = { id: uid(), ts: Date.now(), scores };
  if (note && note.trim()) entry.note = note.trim();
  data.wellbeing.push(entry); save();
  toast("Самочувствие записано", [
    { label: "Отменить", fn: () => {
        data.wellbeing = data.wellbeing.filter(e => e.id !== entry.id); save(); render();
    } },
  ]);
  render();
}

// sleep is stored per morning-date as { bed: "HH:MM", wake: "HH:MM" }.
// Legacy entries may be a plain number (hours) — still supported on read.
function setSleepField(key, field, val) {
  const cur = (typeof data.sleep[key] === "object" && data.sleep[key]) ? data.sleep[key] : {};
  if (val) cur[field] = val; else delete cur[field];
  if (!cur.bed && !cur.wake && !cur.quality) delete data.sleep[key];
  else data.sleep[key] = cur;
  save(); render();
}

// hours of sleep from either the new {bed,wake} object or a legacy number
function sleepHours(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;                  // legacy
  if (v.bed && v.wake) {
    const [bh, bm] = v.bed.split(":").map(Number);
    const [wh, wm] = v.wake.split(":").map(Number);
    let mins = (wh * 60 + wm) - (bh * 60 + bm);
    if (mins <= 0) mins += 1440;                         // woke up after midnight
    return mins / 60;
  }
  return 0;
}
function fmtHours(h) {
  if (!h) return "—";
  const H = Math.floor(h), M = Math.round((h - H) * 60);
  return M ? `${H}ч ${M}м` : `${H}ч`;
}

// 1..5 rating control. attr e.g. `data-wb="mood"`; current 0 = none selected.
function ratingHtml(attr, current, color) {
  let s = `<div class="rating" ${attr}>`;
  for (let i = 1; i <= 5; i++) {
    const on = current === i;
    s += `<button data-val="${i}" class="${on ? "on" : ""}"` +
         (on ? ` style="background:${color};border-color:${color}"` : "") + `>${i}</button>`;
  }
  return s + `</div>`;
}

// ---------- per-day aggregation (splits sessions over midnight) ----------
// returns { "YYYY-MM-DD": { catId: seconds } }
function dailyByCategory(fromMs, toMs) {
  const out = {};
  for (const s of data.sessions) {
    const end = s.end == null ? Date.now() : s.end;
    let cur = s.start;
    while (cur < end) {
      const dayEnd = startOfDay(cur) + 86400000;
      const seg = Math.min(end, dayEnd) - cur;
      const key = dateKey(cur);
      if ((!fromMs || cur >= fromMs - 86400000) && (!toMs || cur < toMs)) {
        (out[key] ||= {});
        out[key][s.catId] = (out[key][s.catId] || 0) + seg / 1000;
      }
      cur = dayEnd;
    }
  }
  return out;
}

function productiveSecondsForDay(dayMap) {
  if (!dayMap) return 0;
  let sum = 0;
  for (const [cid, sec] of Object.entries(dayMap)) {
    const c = cat(cid);
    if (c && c.productive) sum += sec;
  }
  return sum;
}

// ==================================================================
//  VIEWS
// ==================================================================
let currentView = "home";
let tickTimer = null;

function render() {
  if (currentView === "home") renderHome();
  else if (currentView === "stats") renderStats();
  else renderSettings();
  for (const b of document.querySelectorAll("#tabbar button"))
    b.classList.toggle("active", b.dataset.view === currentView);
}

// ---------- HOME ----------
function renderHome() {
  clearInterval(tickTimer);
  const run = runningSession();
  const today = dailyByCategory(startOfDay(Date.now()), Date.now() + 1)[todayKey()] || {};

  let html = `<h1>Сегодня</h1>`;

  // current activity banner
  if (run) {
    const c = cat(run.catId);
    html += `<div class="now running">
      <div class="label">Идёт сейчас — нажми, чтобы остановить</div>
      <div class="name">${esc(c ? c.name : "?")}</div>
      <div class="timer" id="liveTimer">0:00</div>
    </div>`;
  } else {
    html += `<div class="now">
      <div class="label">Ничего не запущено</div>
      <div class="idle">Нажми на занятие ниже, чтобы начать отсчёт</div>
    </div>`;
  }

  // sleep — bedtime & wake time; duration computed
  const sk = todayKey();
  const sv = data.sleep[sk];
  const bed = (sv && typeof sv === "object" && sv.bed) || "";
  const wake = (sv && typeof sv === "object" && sv.wake) || "";
  const sq = (sv && typeof sv === "object" && sv.quality) || 0;
  html += `<h2>Сон прошлой ночью</h2>
    <div class="sleep">
      <label>Лёг<input type="time" data-sleep="bed" value="${bed}"></label>
      <label>Проснулся<input type="time" data-sleep="wake" value="${wake}"></label>
      <div class="val">${fmtHours(sleepHours(sv))}</div>
    </div>
    <div class="scale-row">
      <span class="ql">Качество сна</span>
      ${ratingHtml("data-sleepq", sq, "#3dd6b0")}
    </div>`;

  // activities
  html += `<h2>Занятия</h2><div class="grid">`;
  for (const c of data.categories) {
    const active = run && run.catId === c.id;
    const sec = today[c.id] || 0;
    html += `<button class="tile ${active ? "active" : ""}" data-cat="${c.id}">
      <span class="dot" style="background:${c.color}"></span>
      <span>${esc(c.name)}<span class="sub">${active ? "идёт…" : (sec ? "сегодня " + fmtHM(sec) : "не начато")}</span></span>
      ${sec ? `<span class="meta">${fmtHM(sec)}</span>` : ""}
    </button>`;
  }
  html += `</div>`;

  // habits / urges
  if (data.habits.length) {
    html += `<h2>Привычки и срывы</h2><div class="grid habits">`;
    const todayCount = {};
    for (const e of data.events)
      if (dateKey(e.ts) === todayKey()) todayCount[e.habitId] = (todayCount[e.habitId] || 0) + 1;
    for (const h of data.habits) {
      const n = todayCount[h.id] || 0;
      html += `<button class="tile" data-habit="${h.id}">
        <span class="dot" style="background:${h.color}"></span>
        <span>${esc(h.name)}<span class="sub">${n ? "сегодня: " + n : "сегодня: 0"}</span></span>
        <span class="meta">+1</span>
      </button>`;
    }
    html += `</div>`;
  }

  // wellbeing check-in
  if (data.scales.length) {
    html += `<h2>Самочувствие</h2><div class="card wb">`;
    for (const sc of data.scales) {
      html += `<div class="scale-row">
        <span class="ql">${esc(sc.name)}</span>
        ${ratingHtml(`data-wb="${sc.id}"`, 0, sc.color)}
      </div>`;
    }
    html += `<input type="text" id="wbNote" class="wb-note" placeholder="заметка (необязательно)">
      <button class="btn" id="wbSave" style="width:100%;margin-top:10px">Записать самочувствие</button>`;
    const wbToday = data.wellbeing.filter(e => dateKey(e.ts) === todayKey()).length;
    html += `<div class="note" style="margin-top:10px">${wbToday ? "Сегодня отметок: " + wbToday : "Сегодня ещё не отмечал"}</div></div>`;
  }

  app.innerHTML = html;

  // wire
  for (const b of app.querySelectorAll("[data-cat]"))
    b.onclick = () => toggleActivity(b.dataset.cat);
  for (const b of app.querySelectorAll("[data-habit]"))
    b.onclick = () => logEvent(b.dataset.habit);
  for (const inp of app.querySelectorAll("[data-sleep]"))
    inp.onchange = () => setSleepField(sk, inp.dataset.sleep, inp.value);

  // sleep quality rating
  for (const b of app.querySelectorAll("[data-sleepq] button"))
    b.onclick = () => {
      const v = Number(b.dataset.val);
      setSleepField(sk, "quality", sq === v ? null : v);
    };

  // wellbeing rating buttons (toggle within group; DOM-only until "Записать")
  for (const grp of app.querySelectorAll("[data-wb]")) {
    const col = (scale(grp.dataset.wb) || {}).color || "#3dd6b0";
    for (const b of grp.querySelectorAll("button"))
      b.onclick = () => {
        const wasOn = b.classList.contains("on");
        for (const x of grp.querySelectorAll("button")) {
          x.classList.remove("on"); x.style.background = ""; x.style.borderColor = "";
        }
        if (!wasOn) { b.classList.add("on"); b.style.background = col; b.style.borderColor = col; }
      };
  }
  const wbSave = $("#wbSave");
  if (wbSave) wbSave.onclick = () => {
    const scores = {};
    for (const grp of app.querySelectorAll("[data-wb]")) {
      const on = grp.querySelector("button.on");
      if (on) scores[grp.dataset.wb] = Number(on.dataset.val);
    }
    logWellbeing(scores, $("#wbNote").value);
  };

  // live timer
  if (run) {
    const el = $("#liveTimer");
    const upd = () => { el.textContent = fmtDur((Date.now() - run.start) / 1000); };
    upd();
    tickTimer = setInterval(upd, 1000);
  }
}

// ---------- STATS ----------
function renderStats() {
  clearInterval(tickTimer);
  const DAYS = 14;
  const now = Date.now();
  const from = startOfDay(now) - (DAYS - 1) * 86400000;
  const daily = dailyByCategory(from, now + 1);

  // today totals per category
  const today = daily[todayKey()] || {};
  const maxToday = Math.max(1, ...data.categories.map(c => today[c.id] || 0));

  let html = `<h1>Статистика</h1>`;

  // headline numbers
  const todayProd = productiveSecondsForDay(today);
  let weekProd = 0, daysWithData = 0;
  for (let i = 0; i < DAYS; i++) {
    const k = dateKey(from + i * 86400000);
    const p = productiveSecondsForDay(daily[k]);
    weekProd += p; if (p > 0) daysWithData++;
  }
  html += `<div class="stat-grid">
    <div class="card"><div class="note">Продуктивно сегодня</div><div class="stat-big">${fmtHM(todayProd)}</div></div>
    <div class="card"><div class="note">В среднем / день (${DAYS}д)</div><div class="stat-big">${fmtHM(daysWithData ? weekProd / daysWithData : 0)}</div></div>
  </div>`;

  // today by category bars
  html += `<h2>Сегодня по занятиям</h2><div class="card">`;
  let any = false;
  for (const c of data.categories) {
    const sec = today[c.id] || 0;
    if (!sec) continue; any = true;
    html += `<div class="bar-row"><span class="nm">${esc(c.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(sec / maxToday * 100).toFixed(1)}%;background:${c.color}"></span></span>
      <span class="vl">${fmtHM(sec)}</span></div>`;
  }
  if (!any) html += `<div class="note">Сегодня пока ничего не записано.</div>`;
  html += `</div>`;

  // last 14 days productive hours bar chart
  html += `<h2>Продуктивные часы — ${DAYS} дней</h2><div class="card"><canvas id="cBars" height="160"></canvas></div>`;

  // scatter sleep vs productivity
  html += `<h2>Сон → продуктивность</h2><div class="card"><canvas id="cScatter" height="220"></canvas>
    <div class="note" id="scatterNote"></div></div>`;

  // wellbeing averages (last DAYS days)
  html += `<h2>Самочувствие — среднее за ${DAYS}д</h2><div class="card">`;
  let anyWb = false;
  for (const sc of data.scales) {
    let sum = 0, cnt = 0;
    for (const e of data.wellbeing)
      if (e.ts >= from && e.scores && e.scores[sc.id] != null) { sum += e.scores[sc.id]; cnt++; }
    if (!cnt) continue; anyWb = true;
    const avg = sum / cnt;
    html += `<div class="bar-row"><span class="nm">${esc(sc.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(avg / 5 * 100).toFixed(0)}%;background:${sc.color}"></span></span>
      <span class="vl">${avg.toFixed(1)}/5</span></div>`;
  }
  // sleep quality average
  const fromKey = dateKey(from);
  let qSum = 0, qCnt = 0;
  for (const [k, v] of Object.entries(data.sleep))
    if (k >= fromKey && typeof v === "object" && v.quality) { qSum += v.quality; qCnt++; }
  if (qCnt) {
    anyWb = true;
    const avg = qSum / qCnt;
    html += `<div class="bar-row"><span class="nm">Качество сна</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(avg / 5 * 100).toFixed(0)}%;background:#06d6a0"></span></span>
      <span class="vl">${avg.toFixed(1)}/5</span></div>`;
  }
  if (!anyWb) html += `<div class="note">Пока нет оценок самочувствия. Отмечай на вкладке «Сегодня».</div>`;
  html += `</div>`;

  // recent notes (slips + wellbeing) with explanations
  const notes = [];
  for (const e of data.events) if (e.note) notes.push({ ts: e.ts, who: (habit(e.habitId) || {}).name || "событие", text: e.note });
  for (const e of data.wellbeing) if (e.note) notes.push({ ts: e.ts, who: "самочувствие", text: e.note });
  notes.sort((a, b) => b.ts - a.ts);
  if (notes.length) {
    html += `<h2>Последние заметки</h2><div class="card">`;
    for (const n of notes.slice(0, 10)) {
      const d = new Date(n.ts);
      const when = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ` +
                   `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      html += `<div class="logline"><span class="lt">${when}</span> <b>${esc(n.who)}</b> — ${esc(n.text)}</div>`;
    }
    html += `</div>`;
  }

  app.innerHTML = html;

  drawBars(from, DAYS, daily);
  drawScatter(daily);
}

function drawBars(from, DAYS, daily) {
  const cv = $("#cBars"); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 160;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const pad = 22, bw = (w - pad) / DAYS;
  let max = 0;
  const vals = [];
  for (let i = 0; i < DAYS; i++) {
    const k = dateKey(from + i * 86400000);
    const p = productiveSecondsForDay(daily[k]) / 3600;
    vals.push(p); if (p > max) max = p;
  }
  max = Math.max(max, 1);
  g.fillStyle = "#8aa0b0"; g.font = "10px -apple-system, sans-serif";
  for (let i = 0; i < DAYS; i++) {
    const x = pad + i * bw + 2, bh = (vals[i] / max) * (h - 30);
    g.fillStyle = "#3dd6b0";
    g.fillRect(x, h - 18 - bh, bw - 4, bh);
    if (i % 2 === 0) {
      g.fillStyle = "#8aa0b0";
      const d = new Date(from + i * 86400000);
      g.fillText(`${d.getDate()}`, x, h - 4);
    }
  }
  g.fillStyle = "#8aa0b0";
  g.fillText(`${max.toFixed(1)}ч`, 0, 12);
}

function drawScatter(daily) {
  const cv = $("#cScatter"); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = 220;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);

  // collect points: x sleep hours, y productive hours, where both exist
  const pts = [];
  for (const [key, val] of Object.entries(data.sleep)) {
    const hours = sleepHours(val);
    const prod = productiveSecondsForDay(daily[key]) / 3600;
    if (hours > 0) pts.push({ x: hours, y: prod });
  }
  const note = $("#scatterNote");

  const padL = 30, padB = 24, padT = 10, padR = 10;
  const x0 = padL, x1 = w - padR, y0 = h - padB, y1 = padT;
  // axes ranges
  const maxX = 12, maxY = Math.max(4, ...pts.map(p => p.y));
  const sx = v => x0 + (v / maxX) * (x1 - x0);
  const sy = v => y0 - (v / maxY) * (y0 - y1);

  // grid + labels
  g.strokeStyle = "#2a3947"; g.fillStyle = "#8aa0b0"; g.font = "10px -apple-system, sans-serif";
  g.beginPath();
  for (let xh = 0; xh <= maxX; xh += 4) { g.moveTo(sx(xh), y0); g.lineTo(sx(xh), y1); g.fillText(xh + "ч", sx(xh) - 6, h - 8); }
  g.stroke();
  g.fillText("сон →", x1 - 40, h - 8);
  g.save(); g.translate(10, padT + 30); g.rotate(-Math.PI / 2); g.fillText("продукт.", 0, 0); g.restore();

  for (const p of pts) {
    g.beginPath(); g.fillStyle = "#3dd6b0";
    g.arc(sx(p.x), sy(p.y), 4.5, 0, Math.PI * 2); g.fill();
  }

  // trend line (least squares) if enough points
  if (pts.length >= 4) {
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.x, 0) / n;
    const my = pts.reduce((a, p) => a + p.y, 0) / n;
    let num = 0, den = 0, syy = 0;
    for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    if (den > 0) {
      const slope = num / den, intercept = my - slope * mx;
      const r = num / Math.sqrt(den * syy || 1);
      g.strokeStyle = "#ff9f43"; g.lineWidth = 2; g.beginPath();
      g.moveTo(sx(0), sy(Math.max(0, intercept)));
      g.lineTo(sx(maxX), sy(Math.max(0, intercept + slope * maxX)));
      g.stroke();
      note.textContent = `${n} точек. Корреляция r = ${r.toFixed(2)}. ` +
        (Math.abs(r) < 0.3 ? "Связь пока слабая — нужно больше данных."
         : r > 0 ? "Больше сна → больше продуктивных часов."
         : "Любопытно: больше сна → меньше продуктивности (мало данных?).");
    }
  } else {
    note.textContent = `Точек: ${pts.length}. Нужно хотя бы 4 дня со сном и активностью, чтобы увидеть тренд. Просто продолжай отмечать.`;
  }
}

// ---------- SETTINGS ----------
function renderSettings() {
  clearInterval(tickTimer);
  let html = `<h1>Настройки</h1>`;

  html += `<h2>Занятия (с таймером)</h2><div class="card" id="catList">`;
  for (const c of data.categories) {
    html += `<div class="row" data-id="${c.id}">
      <span class="dot" style="background:${c.color}"></span>
      <input type="text" value="${esc(c.name)}" data-edit="cat-name">
      <button class="toggle ${c.productive ? "on" : ""}" data-edit="cat-prod">${c.productive ? "продуктивно" : "отдых"}</button>
      <button class="x" data-edit="cat-del">✕</button>
    </div>`;
  }
  html += `<div class="add-form"><input id="newCat" placeholder="Новое занятие…"><button class="btn" id="addCat">+</button></div></div>`;

  html += `<h2>Привычки и срывы (мгновенные)</h2><div class="card" id="habitList">`;
  for (const hb of data.habits) {
    html += `<div class="row" data-id="${hb.id}">
      <span class="dot" style="background:${hb.color}"></span>
      <input type="text" value="${esc(hb.name)}" data-edit="hb-name">
      <button class="x" data-edit="hb-del">✕</button>
    </div>`;
  }
  html += `<div class="add-form"><input id="newHabit" placeholder="Новая привычка…"><button class="btn" id="addHabit">+</button></div></div>`;

  html += `<h2>Шкалы самочувствия (оценка 1–5)</h2><div class="card" id="scaleList">`;
  for (const sc of data.scales) {
    html += `<div class="row" data-id="${sc.id}">
      <span class="dot" style="background:${sc.color}"></span>
      <input type="text" value="${esc(sc.name)}" data-edit="sc-name">
      <button class="x" data-edit="sc-del">✕</button>
    </div>`;
  }
  html += `<div class="add-form"><input id="newScale" placeholder="Новая шкала…"><button class="btn" id="addScale">+</button></div></div>`;

  html += `<h2>Данные</h2><div class="card">
    <div class="note">Всё хранится только на этом устройстве. Делай бэкап регулярно.</div>
    <div class="btn-row">
      <button class="btn ghost" id="exportBtn">Экспорт (бэкап)</button>
      <button class="btn ghost" id="importBtn">Импорт</button>
      <button class="btn ghost" id="resetBtn" style="color:#ff6b6b">Сброс</button>
    </div>
    <input type="file" id="importFile" accept="application/json" hidden>
  </div>`;

  app.innerHTML = html;
  wireSettings();
}

const PALETTE = ["#3dd6b0", "#5b9cff", "#ff9f43", "#c77dff", "#ff6b6b", "#ffd166", "#06d6a0", "#ff8fab"];

function wireSettings() {
  // categories
  for (const row of app.querySelectorAll("#catList .row")) {
    const id = row.dataset.id, c = cat(id);
    row.querySelector('[data-edit="cat-name"]').onchange = e => { c.name = e.target.value.trim() || c.name; save(); };
    row.querySelector('[data-edit="cat-prod"]').onclick = e => { c.productive = !c.productive; save(); renderSettings(); };
    row.querySelector('[data-edit="cat-del"]').onclick = () => {
      if (confirm(`Удалить «${c.name}»? Записанное время останется в истории.`)) {
        data.categories = data.categories.filter(x => x.id !== id); save(); renderSettings();
      }
    };
  }
  $("#addCat").onclick = () => {
    const v = $("#newCat").value.trim(); if (!v) return;
    data.categories.push({ id: uid(), name: v, color: PALETTE[data.categories.length % PALETTE.length], productive: true });
    save(); renderSettings();
  };
  // habits
  for (const row of app.querySelectorAll("#habitList .row")) {
    const id = row.dataset.id, hb = habit(id);
    row.querySelector('[data-edit="hb-name"]').onchange = e => { hb.name = e.target.value.trim() || hb.name; save(); };
    row.querySelector('[data-edit="hb-del"]').onclick = () => {
      if (confirm(`Удалить «${hb.name}»?`)) { data.habits = data.habits.filter(x => x.id !== id); save(); renderSettings(); }
    };
  }
  $("#addHabit").onclick = () => {
    const v = $("#newHabit").value.trim(); if (!v) return;
    data.habits.push({ id: uid(), name: v, color: PALETTE[(data.habits.length + 4) % PALETTE.length] });
    save(); renderSettings();
  };
  // scales
  for (const row of app.querySelectorAll("#scaleList .row")) {
    const id = row.dataset.id, sc = scale(id);
    row.querySelector('[data-edit="sc-name"]').onchange = e => { sc.name = e.target.value.trim() || sc.name; save(); };
    row.querySelector('[data-edit="sc-del"]').onclick = () => {
      if (confirm(`Удалить шкалу «${sc.name}»? Прошлые оценки останутся в истории.`)) {
        data.scales = data.scales.filter(x => x.id !== id); save(); renderSettings();
      }
    };
  }
  $("#addScale").onclick = () => {
    const v = $("#newScale").value.trim(); if (!v) return;
    data.scales.push({ id: uid(), name: v, color: PALETTE[(data.scales.length + 2) % PALETTE.length] });
    save(); renderSettings();
  };
  // data
  $("#exportBtn").onclick = exportData;
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = importData;
  $("#resetBtn").onclick = () => {
    if (confirm("Стереть ВСЕ данные и вернуть настройки по умолчанию?")) {
      localStorage.removeItem(STORE_KEY); data = load(); renderSettings();
    }
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `tracker-backup-${todayKey()}.json`;
  a.click(); URL.revokeObjectURL(url);
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      data = Object.assign(structuredClone(DEFAULTS), d);
      save(); renderSettings(); toast("Данные импортированы");
    } catch (err) { alert("Не удалось прочитать файл: " + err.message); }
  };
  r.readAsText(file);
}

// ---------- util ----------
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

// ---------- boot ----------
for (const b of document.querySelectorAll("#tabbar button"))
  b.onclick = () => { currentView = b.dataset.view; render(); };

render();

// service worker for offline
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW reg failed", e));
  });
}
