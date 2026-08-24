'use strict';

/* ================= 常量 ================= */
const EBBINGHAUS_MIN = [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200]; // 5分钟→30天
const FAST_MS = 3000;
const MASTER_STAGE = 6;
const STORAGE_KEY = 'vocab-pixel-quest-v1';
const MUTE_KEY = 'vocab-pixel-muted-v1';

/* ================= 小工具 ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtInterval(min) {
  if (min < 60) return min + ' 分钟';
  if (min < 1440) return min / 60 + ' 小时';
  return min / 1440 + ' 天';
}
function fmtNext(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return '现在可复习';
  const m = Math.round(diff / 60000);
  if (m < 60) return m + ' 分钟后';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' 小时后';
  return Math.round(h / 24) + ' 天后';
}

/* ================= 数据与存储 ================= */
function defaultProgress() {
  return {
    wordsData: {},
    stats: { fast: 0, slow: 0, wrong: 0, sessions: 0, startedAt: Date.now() },
    createdAt: Date.now(),
  };
}

function seedBuiltin(p) {
  for (const w of BUILTIN_WORDS) {
    const id = w.word.toLowerCase();
    if (!p.wordsData[id]) {
      p.wordsData[id] = {
        id, word: w.word, phonetic: w.phonetic, meaning: w.meaning,
        sentence: w.sentence, sentenceCn: w.sentenceCn, group: w.group,
        stage: -1, nextReviewAt: 0, wrongCount: 0, rightCount: 0, fastCount: 0,
        lastResult: '', firstSeenAt: 0, reviews: 0,
      };
    }
  }
}

let progress = loadProgress();

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.wordsData) { seedBuiltin(p); return p; }
    }
  } catch (e) { /* 忽略损坏数据 */ }
  const p = defaultProgress();
  seedBuiltin(p);
  saveProgress(p);
  return p;
}

function saveProgress(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p || progress)); } catch (e) { /* 忽略 */ }
}

function allWords() { return Object.values(progress.wordsData); }
function getWord(id) { return progress.wordsData[id]; }
function getGroups() {
  const seen = [];
  for (const w of allWords()) if (!seen.includes(w.group)) seen.push(w.group);
  return seen;
}

/* ================= 会话状态 ================= */
const TYPE_LABEL = { new: '新学一组', due: '到期复习', wrong: '错词复习' };
let session = null;       // { type, group, queue, index, results, current }
let lastSession = null;   // 供「再来一组」使用
let selectedGroup = '';
let muted = localStorage.getItem(MUTE_KEY) === '1';
let wordStartAt = 0;

function clearTimer() { wordStartAt = 0; }
function stopSpeak() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }

function showScreen(name) {
  clearTimer(); stopSpeak();
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $('#screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'wrongbook') renderWrongBook();
  if (name === 'import') renderImportInfo();
}

/* ================= 首页 ================= */
function renderHome() {
  const words = allWords();
  const mastered = words.filter((w) => w.stage >= MASTER_STAGE).length;
  const due = words.filter((w) => w.stage >= 0 && w.nextReviewAt <= Date.now()).length;
  const wrong = words.filter((w) => w.wrongCount > 0).length;
  $('#stat-mastered').textContent = mastered;
  $('#stat-due').textContent = due;
  $('#stat-wrong').textContent = wrong;

  const groups = getGroups();
  if (!groups.includes(selectedGroup)) selectedGroup = groups[0] || '';
  const counts = {};
  for (const w of words) counts[w.group] = (counts[w.group] || 0) + 1;
  $('#group-chips').innerHTML = groups.map((g) =>
    `<button class="chip ${g === selectedGroup ? 'on' : ''}" data-group="${esc(g)}">${esc(g)}<span class="chip-count">${counts[g] || 0}</span></button>`
  ).join('');
  $$('#group-chips .chip').forEach((c) => {
    c.onclick = () => { selectedGroup = c.dataset.group; renderHome(); };
  });
  $('#btn-review-due').textContent = `🔁 复习到期 (${due})`;
  $('#btn-wrongbook').textContent = `📕 错词本 (${wrong})`;
}

/* ================= 组队 ================= */
function buildQueue(type, group) {
  const words = allWords();
  const now = Date.now();
  let ids = [];
  if (type === 'new') {
    const inGroup = words.filter((w) => w.group === group);
    ids = inGroup.filter((w) => w.stage < 0).slice(0, 10).map((w) => w.id);
    for (const w of inGroup.filter((x) => x.stage >= 0 && x.nextReviewAt <= now).sort((a, b) => a.nextReviewAt - b.nextReviewAt)) {
      if (ids.length >= 10) break;
      if (!ids.includes(w.id)) ids.push(w.id);
    }
    if (ids.length < 10) {
      for (const w of inGroup.filter((x) => !ids.includes(x.id)).sort((a, b) => a.nextReviewAt - b.nextReviewAt)) {
        if (ids.length >= 10) break;
        ids.push(w.id);
      }
    }
  } else if (type === 'due') {
    ids = words.filter((w) => w.stage >= 0 && w.nextReviewAt <= now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
      .slice(0, 20).map((w) => w.id);
  } else if (type === 'wrong') {
    ids = words.filter((w) => w.wrongCount > 0)
      .sort((a, b) => b.wrongCount - a.wrongCount || a.nextReviewAt - b.nextReviewAt)
      .slice(0, 20).map((w) => w.id);
  }
  return ids;
}

function startSession(type, group) {
  const queue = buildQueue(type, group);
  if (!queue.length) {
    toast(type === 'new' ? '这组词都学过啦，去复习或换一组吧～' : '没有需要复习的单词～');
    return;
  }
  session = { type, group, queue, index: 0, results: [], current: null, phase: 'main', wrongIds: [] };
  lastSession = { type, group };
  showScreen('session');
  $('#session-label').textContent = TYPE_LABEL[type] + (type === 'new' ? ' · ' + group : '');
  $('#btn-skip').style.display = '';
  nextWord();
}

function nextWord() {
  if (!session) return;
  if (session.index >= session.queue.length) {
    // 一组结束后：先把错词单独重做一遍，再进入结算
    if (session.phase === 'main' && session.wrongIds.length) {
      session.phase = 'redo';
      session.queue = session.wrongIds.slice();
      session.index = 0;
      $('#session-label').textContent = '错题重做';
      toast('先把这 ' + session.queue.length + ' 个错词再挑战一次！');
      nextWord();
      return;
    }
    finishSession();
    return;
  }
  const id = session.queue[session.index];
  const w = getWord(id);
  session.current = { wordId: id, options: makeOptions(w), answered: false, elapsed: 0 };
  renderWord(w, session.current.options);
  startTiming();
}

function makeOptions(w) {
  const pool = allWords().filter((x) => x.id !== w.id && x.meaning && x.meaning !== w.meaning);
  const dist = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { id: 'none', meaning: '（没有干扰词）' };
  const opts = [
    { id: w.id, text: w.meaning, correct: true },
    { id: dist.id, text: dist.meaning, correct: false },
  ];
  if (Math.random() < 0.5) opts.reverse();
  return opts;
}

function renderWord(w, opts) {
  $('#word-text').textContent = w.word;
  $('#word-phonetic').textContent = w.phonetic || '';
  $('#word-phonetic').style.display = w.phonetic ? '' : 'none';
  $('#session-count').textContent = (session.index + 1) + ' / ' + session.queue.length;
  $('#pbar-fill').style.width = (session.index / session.queue.length * 100) + '%';
  const card = $('#word-card');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  $('#options').innerHTML = opts.map((o, i) =>
    `<button class="option-btn" data-idx="${i}"><span class="opt-key">${i === 0 ? 'A' : 'B'}</span><span>${esc(o.text)}</span></button>`
  ).join('');
  $$('#options .option-btn').forEach((btn) => { btn.onclick = () => answer(+btn.dataset.idx); });
  $('#feedback-overlay').classList.remove('show');
  setTimeout(() => speak(w.word), 350);
}

/* ================= 计时（仅内部记录，界面不显示） ================= */
function startTiming() { wordStartAt = Date.now(); }

/* ================= 答题 ================= */
function answer(idx) {
  if (!session || !session.current || session.current.answered) return;
  const cur = session.current;
  cur.answered = true;
  cur.elapsed = Date.now() - wordStartAt;
  clearTimer();
  const chosen = cur.options[idx];
  const w = getWord(cur.wordId);
  const ok = chosen.correct;
  const fast = cur.elapsed <= FAST_MS;

  const btns = $$('#options .option-btn');
  btns.forEach((b, i) => {
    const o = cur.options[i];
    b.disabled = true;
    b.classList.add('dim');
    if (o.correct) b.classList.add('correct');
    if (i === idx && !ok) b.classList.add('wrong');
  });

  if (ok) onCorrect(w, fast); else onWrong(w);
  if (!ok && !session.wrongIds.includes(w.id)) session.wrongIds.push(w.id);
  saveProgress();
  renderFeedback(w, ok, fast);
}

function skip() {
  if (!session || !session.current || session.current.answered) return;
  const cur = session.current;
  cur.answered = true;
  clearTimer();
  const w = getWord(cur.wordId);
  const btns = $$('#options .option-btn');
  btns.forEach((b, i) => {
    b.disabled = true;
    b.classList.add('dim');
    if (cur.options[i].correct) b.classList.add('correct');
  });
  onWrong(w);
  if (!session.wrongIds.includes(w.id)) session.wrongIds.push(w.id);
  saveProgress();
  renderFeedback(w, false, false);
}

/* ================= 进度更新（艾宾浩斯） ================= */
function onCorrect(w, fast) {
  w.rightCount++; w.reviews++; w.lastResult = fast ? 'fast' : 'slow';
  if (w.firstSeenAt === 0) w.firstSeenAt = Date.now();
  progress.stats[fast ? 'fast' : 'slow']++;
  if (fast) {
    w.fastCount++;
    w.stage = Math.min(w.stage + 1, EBBINGHAUS_MIN.length - 1);
    if (w.wrongCount > 0) w.wrongCount--;
    w.nextReviewAt = Date.now() + EBBINGHAUS_MIN[w.stage] * 60000;
  } else {
    w.stage = Math.max(0, w.stage - 1);
    w.nextReviewAt = Date.now() + Math.max(30, EBBINGHAUS_MIN[w.stage]) * 60000;
  }
}

function onWrong(w) {
  w.wrongCount++; w.reviews++; w.lastResult = 'wrong';
  if (w.firstSeenAt === 0) w.firstSeenAt = Date.now();
  progress.stats.wrong++;
  w.stage = Math.max(0, w.stage - 1);
  w.nextReviewAt = Date.now() + 5 * 60000;
}

/* ================= 反馈 ================= */
function renderFeedback(w, ok, fast) {
  const panel = $('#feedback-panel');
  panel.className = 'pixel-panel feedback-panel ' + (ok ? 'good' : 'bad');
  $('#feedback-head').textContent = ok ? '✔ 正确！' : '✘ 答错啦';
  $('#feedback-meaning').innerHTML =
    `<div class="feedback-word">${esc(w.word)}</div>` +
    (w.phonetic ? `<div class="feedback-phonetic">${esc(w.phonetic)}</div>` : '') +
    `<div class="feedback-meaning">${esc(w.meaning)}</div>`;
  if (w.sentence) {
    $('#feedback-sentence').style.display = '';
    $('#feedback-sentence').innerHTML = `📖 ${esc(w.sentence)}`;
    $('#feedback-sentence-cn').textContent = w.sentenceCn || '';
    $('#feedback-sentence-cn').style.display = w.sentenceCn ? '' : 'none';
  } else {
    $('#feedback-sentence').style.display = 'none';
    $('#feedback-sentence-cn').textContent = '';
    $('#feedback-sentence-cn').style.display = 'none';
  }
  if (w.notes) {
    $('#feedback-notes').style.display = '';
    $('#feedback-notes').textContent = '💡 补充：' + w.notes;
  } else {
    $('#feedback-notes').style.display = 'none';
    $('#feedback-notes').textContent = '';
  }
  $('#feedback-badge').textContent = ok
    ? (fast ? '⚡ 3 秒内答对 · 熟练！' : '🐢 超过 3 秒 · 不熟练')
    : '📕 已加入错词本';
  $('#feedback-overlay').classList.add('show');

  session.results.push({ id: w.id, word: w.word, meaning: w.meaning, result: ok ? (fast ? 'fast' : 'slow') : 'wrong' });
  if (ok) {
    beep(fast ? 'correct' : 'slow');
    if (fast) confettiBurst();
    setTimeout(() => { if (w.sentence) speak(w.sentence); }, fast ? 450 : 200);
  } else {
    beep('wrong');
  }
}

function finishSession() {
  clearTimer(); stopSpeak();
  const results = session.results;
  // 主组 + 错题重做两轮后，取每个单词的最终结果
  const lastByWord = new Map();
  for (const r of results) lastByWord.set(r.id, r);
  const final = [...lastByWord.values()];
  const fast = final.filter((r) => r.result === 'fast');
  const slow = final.filter((r) => r.result === 'slow');
  const wrong = final.filter((r) => r.result === 'wrong');
  progress.stats.sessions++;
  saveProgress();
  session = null;
  showScreen('summary');
  $('#sum-fast').textContent = fast.length;
  $('#sum-slow').textContent = slow.length;
  $('#sum-wrong').textContent = wrong.length;
  $('#summary-lists').innerHTML = [
    ['⚡ 熟练', fast], ['🐢 不熟练', slow], ['💥 错词（已进错词本）', wrong],
  ].map((pair) => {
    const title = pair[0], list = pair[1];
    if (!list.length) return `<div class="summary-group"><h3>${title} · 0</h3></div>`;
    return `<div class="summary-group"><h3>${title} · ${list.length}</h3>` +
      list.map((r) => `<span class="word-tag">${esc(r.word)} ${esc(r.meaning)}</span>`).join('') + '</div>';
  }).join('');
  if (fast.length === final.length && final.length) {
    beep('fanfare'); confettiBurst();
    toast('完美！全部快速通过 🎉');
  } else if (fast.length >= slow.length + wrong.length) {
    beep('fanfare');
  }
}

/* ================= 错词本 ================= */
function renderWrongBook() {
  const list = allWords().filter((w) => w.wrongCount > 0).sort((a, b) => b.wrongCount - a.wrongCount);
  $('#btn-review-wrong').disabled = list.length === 0;
  $('#wrong-list').innerHTML = list.length
    ? list.map((w) => `
      <div class="wrong-item pixel-panel" data-word="${esc(w.word)}">
        <span class="w-word">${esc(w.word)}</span>
        <span class="w-meaning">${esc(w.meaning)}</span>
        <span class="w-count">✘ ${w.wrongCount}</span>
        <span class="w-next">${fmtNext(w.nextReviewAt)}</span>
      </div>`).join('')
    : '<div class="wrong-empty">错词本是空的，继续保持～ 🎉</div>';
  $$('#wrong-list .wrong-item').forEach((row) => { row.onclick = () => speak(row.dataset.word); });
}

/* ================= 词表导入 ================= */
function renderImportInfo() {
  $('#import-count').textContent = allWords().length;
}

function parseCSV(text, sep) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') {
      inQ = true;
    } else if (c === sep) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseImport(text) {
  text = text.trim();
  let rows = [];
  if (text[0] === '[' || text[0] === '{') {
    let data = JSON.parse(text);
    if (!Array.isArray(data)) data = [data];
    rows = data.map((o) => ({
      word: String(o.word || o['单词'] || o.Word || '').trim(),
      phonetic: String(o.phonetic || o['音标'] || '').trim(),
      meaning: String(o.meaning || o['中文释义'] || o['释义'] || '').trim(),
      sentence: String(o.sentence || o['英文例句'] || o['例句'] || '').trim(),
      sentenceCn: String(o.sentenceCn || o['例句翻译'] || '').trim(),
      group: String(o.group || o['分组'] || '导入组').trim(),
    }));
  } else {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const first = lines[0];
    const sep = first.includes('\t') ? '\t' : (first.includes('，') ? '，' : ',');
    const csv = parseCSV(lines.join('\n'), sep);
    const head = (csv[0] || []).map((h) => String(h).trim());
    const isHeader = head.some((h) => /单词|word|音标|释义|例句|分组/i.test(h));
    const body = isHeader ? csv.slice(1) : csv;
    rows = body.map((r) => {
      if (isHeader) {
        const g = (s) => { const i = head.findIndex((h) => h.includes(s)); return i >= 0 ? String(r[i] || '').trim() : ''; };
        return {
          word: g('单词') || g('word'),
          phonetic: g('音标'),
          meaning: g('释义'),
          sentence: g('例句'),
          sentenceCn: g('翻译'),
          group: g('分组') || '导入组',
        };
      }
      return {
        word: String(r[0] || '').trim(),
        phonetic: String(r[1] || '').trim(),
        meaning: String(r[2] || '').trim(),
        sentence: String(r[3] || '').trim(),
        sentenceCn: String(r[4] || '').trim(),
        group: String(r[5] || '导入组').trim(),
      };
    });
  }
  return rows.filter((r) => r.word && String(r.word).trim());
}

function doImport() {
  const text = $('#import-area').value;
  try {
    const rows = parseImport(text);
    if (!rows.length) { toast('没有解析到有效单词，请检查格式'); return; }
    let added = 0, updated = 0;
    rows.forEach((r) => {
      const id = String(r.word).trim().toLowerCase();
      const old = progress.wordsData[id];
      if (old) {
        old.phonetic = r.phonetic || old.phonetic;
        old.meaning = r.meaning || old.meaning;
        old.sentence = r.sentence || old.sentence;
        old.sentenceCn = r.sentenceCn || old.sentenceCn;
        old.group = r.group || old.group;
        updated++;
      } else {
        progress.wordsData[id] = {
          id, word: String(r.word).trim(), phonetic: r.phonetic || '', meaning: r.meaning || '',
          sentence: r.sentence || '', sentenceCn: r.sentenceCn || '', group: r.group || '导入组',
          stage: -1, nextReviewAt: 0, wrongCount: 0, rightCount: 0, fastCount: 0,
          lastResult: '', firstSeenAt: 0, reviews: 0,
        };
        added++;
      }
    });
    saveProgress();
    $('#import-area').value = '';
    renderImportInfo();
    toast(`导入完成：新增 ${added} 个，更新 ${updated} 个`);
  } catch (e) {
    toast('解析失败：' + e.message);
  }
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function downloadTemplate() {
  const head = '单词,音标,中文释义,英文例句,例句翻译,分组';
  const rows = [head, 'abundant, /əˈbʌndənt/, adj. 丰富的, Rain makes the pond abundant with frogs., 雨水让池塘里满是青蛙。, 示例·A'];
  download('word_template.csv', '\uFEFF' + rows.join('\n'));
}

/* ================= 语音 ================= */
function speak(text, lang) {
  if (!('speechSynthesis' in window) || !text) return;
  stopSpeak();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang || 'en-US';
  u.rate = 0.88; u.pitch = 1;
  const vs = window.speechSynthesis.getVoices();
  const v = vs.find((x) => x.lang.toLowerCase().startsWith('en') && x.localService) || vs.find((x) => x.lang.toLowerCase().startsWith('en'));
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

/* ================= 音效 ================= */
let audioCtx = null;
function beep(kind) {
  if (muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const notes = {
      correct: [523.25, 659.25, 783.99],
      slow: [392, 329.63],
      wrong: [220, 174.61, 146.83],
      timeout: [330, 330],
      click: [880],
      fanfare: [523.25, 659.25, 783.99, 1046.5],
    }[kind] || [880];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      const st = t + i * 0.11;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.12, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.16);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(st); o.stop(st + 0.2);
    });
  } catch (e) { /* 忽略 */ }
}

/* ================= 彩带与提示 ================= */
function confettiBurst() {
  const wrap = $('#confetti');
  const colors = ['#e2584b', '#f2b84b', '#5ba35d', '#4f7fb8', '#c792ea'];
  for (let i = 0; i < 36; i++) {
    const d = document.createElement('div');
    d.className = 'confetti-piece';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = (0.8 + Math.random() * 0.9) + 's';
    d.style.animationDelay = (Math.random() * 0.3) + 's';
    d.style.setProperty('--tx', (Math.random() * 160 - 80) + 'px');
    d.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    wrap.appendChild(d);
    setTimeout(() => d.remove(), 2400);
  }
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ================= 事件绑定 ================= */
function wire() {
  $('#btn-home').onclick = () => showScreen('home');
  $('#btn-mute').onclick = () => {
    muted = !muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    $('#btn-mute').textContent = muted ? '🔇' : '🔊';
    if (!muted) beep('click');
  };
  $('#btn-study').onclick = () => startSession('new', selectedGroup);
  $('#btn-review-due').onclick = () => startSession('due');
  $('#btn-wrongbook').onclick = () => showScreen('wrongbook');
  $('#btn-import').onclick = () => showScreen('import');
  $('#btn-speak').onclick = () => { if (session && session.current) speak(getWord(session.current.wordId).word); };
  $('#btn-skip').onclick = skip;
  $('#btn-next').onclick = () => { if (session) { session.index++; nextWord(); } };
  $('#btn-quit').onclick = () => { session = null; showScreen('home'); toast('进度已保存，随时回来～'); };
  $('#btn-again').onclick = () => { if (lastSession) startSession(lastSession.type, lastSession.group); else showScreen('home'); };
  $('#btn-home2').onclick = () => showScreen('home');
  $('#btn-review-wrong').onclick = () => startSession('wrong');
  $('#btn-wb-back').onclick = () => showScreen('home');
  $('#btn-do-import').onclick = doImport;
  $('#btn-download-template').onclick = downloadTemplate;
  $('#btn-export').onclick = () => download('vocab_backup_' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(progress, null, 2));
  $('#btn-reset').onclick = () => {
    if (!confirm('确定清空全部学习进度吗？词库会保留，进度会清零。')) return;
    progress = defaultProgress();
    seedBuiltin(progress);
    saveProgress();
    renderHome(); renderImportInfo();
    toast('进度已清空');
  };
  $('#btn-import-back').onclick = () => showScreen('home');

  document.addEventListener('keydown', (e) => {
    if (!$('#screen-session').classList.contains('active')) return;
    if (!$('#feedback-overlay').classList.contains('show')) {
      const k = e.key.toLowerCase();
      if (k === 'a' || k === '1') answer(0);
      else if (k === 'b' || k === '2') answer(1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (session) { session.index++; nextWord(); }
    }
  });

  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
}

/* ================= 启动 ================= */
$('#btn-mute').textContent = muted ? '🔇' : '🔊';
wire();
selectedGroup = getGroups()[0] || '';
renderHome();

// 隐藏预览入口：在网址后加 #demo 会自动开始一组新词，方便快速预览界面
if (location.hash === '#demo') {
  setTimeout(() => startSession('new', selectedGroup), 300);
}

// PWA：部署到 http/https 后自动支持离线缓存与「添加到主屏幕」
if (location.protocol === 'http:' || location.protocol === 'https:') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}
