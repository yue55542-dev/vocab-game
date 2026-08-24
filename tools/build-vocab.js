// 从 vocabulary.txt 生成应用内置词库 js/data.js
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/超超/Documents/Codex/vocabulary.txt';
const OUT = path.join(__dirname, '..', 'outputs', 'vocab-game', 'js', 'data.js');
const REPORT = path.join(__dirname, 'vocab-report.json');

// 明显的单词拼写修正
const WORD_FIXES = {
  'carbon dioxied': 'carbon dioxide',
  'pretail': 'reptile',
  'consonent': 'consonant',
  '\\bdurable': 'durable',
};

// 明显的释义修正
const MEANING_FIXES = {
  'latitude': '纬度',
  'deforest': '毁掉森林；砍伐森林',
};

// 文档里缺释义的单词（自己补充的准确释义）
const MISSING_MEANINGS = {
  climate: '气候',
  weather: '天气',
  meteorology: '气象学',
  warm: '温暖的；暖和的；（使）变暖',
  snowy: '下雪的；多雪的',
  thunder: '雷；雷声；打雷',
  lightning: '闪电',
  stormy: '有暴风雨的；激烈的',
  rainbow: '彩虹',
  temperature: '温度；气温',
  forecast: '预报；预测',
  mountain: '山；山脉',
  southeast: '东南；东南方',
  southwest: '西南；西南方',
  northeast: '东北；东北方',
  northwest: '西北；西北方',
  eastern: '东方的；东部的',
  pollution: '污染',
  super: '极好的；超级的',
  interesting: '有趣的',
  sunset: '日落；傍晚',
  waterfall: '瀑布',
  environment: '环境',
  situation: '情况；形势；局面',
  nature: '自然；大自然；本质',
  natural: '自然的；天生的',
  flower: '花；花朵',
  primary: '主要的；初级的；小学的',
  secondary: '次要的；中级的；中学的',
  university: '大学',
  exhibition: '展览；展览会',
  mainland: '大陆；本土',
  flash: '闪现；闪过；闪光；闪烁',
  float: '漂浮；浮动',
  education: '教育',
};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu;
const clean = (s) => String(s || '').replace(EMOJI_RE, '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
const cleanNotes = (s) => clean(s).replace(/adj\.\/词的/g, 'adj. 磁的');

function splitPosMeaning(pos) {
  // 处理 "n.展览" 这种词性与释义黏在一起的情况
  const m = /^([a-zA-Z./]+\s*\.?)\s*(.*)$/u.exec(pos);
  if (m && /[\u4e00-\u9fff]/.test(m[2])) return [m[1].trim(), clean(m[2])];
  return [pos, ''];
}

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
let group = '';
const byWord = new Map(); // word -> {word, phonetic, senses, sentence, sentenceCn, notes, group}

for (const line of lines) {
  if (!line.includes('|')) {
    if (!/^(===|---|--|\+\+\+)$/.test(line)) group = line; // 章节名
    continue;
  }
  const f = line.split('|');
  let word = clean(f[0]);
  word = WORD_FIXES[word] || word;
  let pos = clean(f[1]);
  let meaning = clean(f[2]);
  const sentence = clean(f[3]);
  const notes = cleanNotes(f.slice(4).join('；'));
  const key = word.toLowerCase();

  if (!meaning) {
    if (MISSING_MEANINGS[key]) {
      meaning = MISSING_MEANINGS[key];
      if (/[\u4e00-\u9fff]/.test(pos)) pos = splitPosMeaning(pos)[0];
    } else if (/[\u4e00-\u9fff]/.test(pos)) {
      const [p, m] = splitPosMeaning(pos);
      pos = p; meaning = m;
    }
  }
  if (MEANING_FIXES[key]) meaning = MEANING_FIXES[key];
  const full = pos ? `${pos} ${meaning}`.trim() : meaning;
  if (!full) {
    console.warn('空释义，已跳过:', line);
    continue;
  }

  if (!byWord.has(key)) {
    byWord.set(key, {
      word, phonetic: '', senses: [], sentence: '', sentenceCn: '', notes: '', group,
    });
  }
  const e = byWord.get(key);
  // 合并多义词条：按词性归并义项，去重
  const pm = /^([a-zA-Z./]+\s*\.?)\s*(.*)$/u.exec(full);
  const segPos = pm ? pm[1].trim() : '';
  const segText = (pm ? pm[2] : full).trim();
  let seg = e.senses.find((s) => s.pos === segPos);
  if (!seg) { seg = { pos: segPos, texts: [] }; e.senses.push(seg); }
  for (const t of segText.split(/[；;]/).map((s) => s.trim()).filter(Boolean)) {
    if (!seg.texts.includes(t)) seg.texts.push(t);
  }
  e.sentence = [e.sentence, sentence].filter(Boolean).join(' ');
  e.notes = [e.notes, notes].filter(Boolean).join('；');
}

const words = [...byWord.values()].map((e) => ({
  ...e,
  meaning: e.senses.map((s) => (s.pos ? `${s.pos} ${s.texts.join('；')}` : s.texts.join('；'))).join('；'),
  senses: undefined,
}));
const groups = [...new Set(words.map((w) => w.group))];
const report = {
  words: words.length,
  groups,
  withSentence: words.filter((w) => w.sentence).length,
  withNotes: words.filter((w) => w.notes).length,
  multiSense: words.filter((w) => w.meaning.includes('；')).length,
};

const rows = words.map((w) => JSON.stringify(w));
const header = `// ============================================================\n// 词库由 vocabulary.txt 自动生成（build-vocab.js），请勿手改\n// 格式：{ word, phonetic, meaning, sentence, sentenceCn, notes, group }\n// ============================================================\n`;
fs.writeFileSync(OUT, header + 'const BUILTIN_WORDS = [\n  ' + rows.join(',\n  ') + ',\n];\n', 'utf8');
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');

console.log('生成完成:', JSON.stringify(report));
console.log('示例:');
for (const w of words.slice(0, 3)) console.log(' ', JSON.stringify(w));
