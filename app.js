'use strict';
/* エクストリーマーズ — 4人チームで究極の課題に挑む対戦ゲーム */

const $ = (s) => document.querySelector(s);
const ROUNDS = 4, PICK_MS = 10000, STAGES = 3, STAGE_WEIGHT = [30, 30, 40];
// ハラハラ系を多めに（7割）。標的や組織はすべて架空
const TASK_HOT = ['架空の悪の大物を暗殺する', '命を狙われた要人を守り抜く', '難攻不落の監獄から脱獄する', '仕掛けられた巨大爆弾を止める', '悪の組織の金庫から奪い去る', '人質を救出する', '仲間に紛れた裏切り者を暴いて始末する', '敵の秘密兵器を破壊する', '凶悪な追っ手から逃げ切る', '黒幕の正体を突き止めて捕らえる'];
const TASK_MILD = ['潜入する', '騒ぎを起こす', '作り上げる', '勝負に勝つ', '説得する', '隠し通す', '運ぶ'];
// お題ごとのBGM（audio.js の GROOVES）
const GROOVE_HOT = ['assassin', 'guard', 'escape', 'bomb', 'vault', 'hostage', 'traitor', 'weapon', 'pursuit', 'mastermind'];
const GROOVE_MILD = ['infiltrate', 'riot', 'build', 'contest', 'persuade', 'hide', 'haul'];
// 対戦相手との駆け引き
const KIND = { normal: 'normal', sabotage: 'sabotage', coop: 'coop' };
const SABOTAGE_HIT = 25, SABOTAGE_COST = 10, COOP_BOTH = 20, BETRAY_BONUS = 10;
const APT_W = { fit: 27, stretch: 4, none: 1 }; // ぴったりの人が1人いれば約9割でその人
const APT_RATE = { fit: 80, stretch: 50, none: 20 };
const OUT_CHANCE = 30;
const WEAK_HIT = 15; // 実行役の弱点が作戦に引っかかると成功ライン−15。相手チームの弱点は対戦中は伏せる
// 特技のジャンル。毎巡の5人にアプリ側で別々のジャンルを割り振る（体の能力は出にくく）
const SKILL_GENRES = [
  ['運・偶然', 1], ['記憶・知識', 1], ['話術・対人', 1], ['五感・感覚', 1], ['変わった体質', 1], ['手先の器用さ', 1],
  ['芸術・表現', 1], ['動物・自然', 1], ['機械・道具', 1], ['生活の知恵', 1], ['数字・計算', 1], ['演技・変装', 1],
  ['時間・タイミング', 1], ['不思議な勘', 1], ['食べ物・味覚', 1], ['乗り物', 1], ['音・声', 1], ['だまし・はったり', 1],
  ['隠れる・逃げる', 1], ['植物', 1], ['水・天気', 1], ['遊び・ゲーム', 1], ['礼儀・作法', 1], ['整理・片付け', 1], ['体の能力', 0.6],
];
function drawGenres(n) { // 重み付きで重複なしにn個
  const pool = SKILL_GENRES.map(([g, w]) => ({ g, w: Math.round(w * 10) })), out = [];
  while (out.length < n && pool.length) { const x = pickWeighted(pool, (y) => y.w); out.push(x.g); pool.splice(pool.indexOf(x), 1); }
  return out;
}

let S = null;          // ゲーム状態
let retryFn = null;    // エラー時の再実行
let timerId = null;

/* ---------- 共通 ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  window.scrollTo(0, 0);
  const sc = sceneFor(id);
  if (sc && typeof Sound !== 'undefined') Sound.play(...sc);
}
/* 画面ごとのBGM。曲調はお題（S.mood）で変わる */
function sceneFor(id) {
  if (['home', 'settings', 'logs', 'logView'].includes(id)) return ['title', 'electro', false];
  if (!S) return null;
  if (id === 'draft') return ['draft', S.mood, false];
  if (['reveal', 'stage', 'roll', 'result'].includes(id)) return ['stage', S.mood, id !== 'reveal' && S.stage === STAGES - 1];
  if (id === 'final') return [S.mode === 'cpu' && S.last?.win?.w === 1 ? 'lose' : 'win', S.mood, false];
  return null; // 読み込み中・受け渡し画面は今の曲のまま
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rnd(n) { // 1..n の公正な乱数
  const a = new Uint32Array(1);
  const lim = Math.floor(0xFFFFFFFF / n) * n;
  do crypto.getRandomValues(a); while (a[0] >= lim);
  return (a[0] % n) + 1;
}
function pickWeighted(items, wf) {
  const total = items.reduce((t, x) => t + wf(x), 0);
  let r = rnd(total);
  for (const x of items) { r -= wf(x); if (r <= 0) return x; }
  return items[items.length - 1];
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1600);
}
function stars(n) { return '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i>'; }
/* 読み込み中の文言。配列なら少しずつ切り替える */
let loadingTimer = null;
const TIPS = [
  '妨害は相手の成功ラインを25下げる。ただし自分も10下がる',
  '両チームが共闘を選ぶと、どちらも成功ライン+20',
  '共闘を持ちかけてきた相手を妨害すると、さらに+10',
  '体を使う作戦は、運動神経の★で成功ラインが上下する',
  `実行役の弱点が作戦に引っかかると、成功ラインが${WEAK_HIT}下がる`,
  '相手チームの弱点は、対戦が終わるまで分からない',
  '弱点が引っかかる人は、実行役に選ばれにくく、加勢にも来ない',
  '失敗すると30%の確率で、実行した人が退場（最終関門は除く）',
  '最終関門は40点。ここで一気に逆転できる',
  '惜しい失敗でも少しだけ点が入る。大成功ほど高得点',
  '作戦に向いている人ほど、実行役に選ばれやすい',
  '相手チームの能力は、関門画面の下で確認できる',
  '無料枠は毎日17時ごろ（日本時間）にリセットされる',
  '右上のスピーカーボタンでBGMをミュートできる',
  '終わった対戦は、タイトルの「対戦ログ」で見返せる',
];
let tipTimer = null;
/* 読み込み画面：実況（8秒ごと）＋走る棒人間＋対決表示＋チップス＋ミニゲーム */
function loading(text, vs) {
  clearInterval(loadingTimer); clearInterval(tipTimer);
  const lines = Array.isArray(text) ? text : [text];
  let i = 0;
  const el = $('#loadingText');
  el.textContent = lines[0];
  const alive = () => $('#loading').classList.contains('active');
  if (lines.length > 1) loadingTimer = setInterval(() => {
    if (!alive()) return clearInterval(loadingTimer);
    i = (i + 1) % lines.length; el.textContent = lines[i];
  }, 8000);
  $('#loadVs').innerHTML = vs || '';
  $('#runner').innerHTML = runnerSVG(vs ? 2 : 1);
  let ti = rnd(TIPS.length) - 1;
  $('#loadTip').textContent = TIPS[ti];
  tipTimer = setInterval(() => { if (!alive()) return clearInterval(tipTimer); ti = (ti + 1) % TIPS.length; $('#loadTip').textContent = TIPS[ti]; }, 8000);
  miniReset();
  show('loading');
}
function vsHTML(a, b, sub) {
  return `<div class="vsRow"><div class="vsSide a"><span>🟥 ${esc(S.names[0])}</span><b>${esc(a)}</b></div><div class="vsMark">VS</div><div class="vsSide b"><span>🟦 ${esc(S.names[1])}</span><b>${esc(b)}</b></div></div>${sub ? `<p class="vsSub">${sub}</p>` : ''}`;
}
const INTRO_LINE = {
  assassin: '標的の足取りを追跡中…', guard: '要人の周囲を固めています…', escape: '脱出ルートを探っています…',
  bomb: '爆弾のタイマーが動き出した…', vault: '金庫への侵入経路を確保中…', hostage: '人質の居場所を割り出し中…',
  traitor: '裏切り者の影を追っています…', weapon: '秘密兵器の格納庫へ接近中…', pursuit: '追っ手の足音が迫る…',
  mastermind: '黒幕への手がかりを洗い出し中…', infiltrate: '潜入ルートを確保中…', riot: '騒ぎの火種を仕込み中…',
  build: '資材をかき集めています…', contest: '勝負の舞台が整いつつある…', persuade: '相手の心のすき間を探っています…',
  hide: '痕跡を消しています…', haul: '積み荷をつかんで走り出した…',
};
function crewName(r) { return [r.ex, ...(r.helpers || [])].map((m) => m.job).join('＆'); }
function actionLines(rs, final) {
  const [a, b] = rs, k = (r) => r.kind;
  const lines = [final ? `最終局面──「${a.label}」にすべてを懸ける…` : `作戦「${a.label}」発動中…`];
  lines.push(`${S.names[1]}は「${b.label}」で動いた…`);
  if (k(a) === 'sabotage' || k(b) === 'sabotage') lines.push('妨害工作、進行中…');
  if (k(a) === 'coop' && k(b) === 'coop') lines.push('一時休戦、握手を交わす…');
  else if (k(a) === 'coop' || k(b) === 'coop') lines.push('休戦の申し出、その答えは…');
  lines.push(a.ok ? `${crewName(a)}が流れをつかんだ…` : `${crewName(a)}に予期せぬ事態…`);
  if (final) lines.push('決着の瞬間が近づいている…');
  return lines;
}
function fail(err, again) {
  $('#errorText').textContent = err.message || String(err);
  retryFn = again; show('error');
}

/* ---------- 設定 ---------- */
const store = {
  get key() { try { return localStorage.getItem('ext_gkey') || ''; } catch { return ''; } },
  set key(v) { try { localStorage.setItem('ext_gkey', v); } catch {} },
  get model() { try { return localStorage.getItem('ext_gmodel') || 'gemini-3.5-flash'; } catch { return 'gemini-3.5-flash'; } },
  set model(v) { try { localStorage.setItem('ext_gmodel', v); } catch {} this.thinkOk = undefined; },
  thinkOk: undefined,
};
function refreshKeyNote() {
  if (typeof renderToday === 'function') renderToday();
  $('#keyNote').textContent = store.key ? '' : 'はじめに「設定」でGemini APIキー（無料）を入れてください。';
  refreshQuota();
}

/* ---------- 無料枠の残り回数（この端末で数える） ---------- */
const CALLS_PER_GAME = 5;
const DEFAULT_LIMIT = { 'gemini-3.5-flash': 20, 'gemini-3.1-flash-lite': 100, 'gemini-2.5-pro': 25 };
function ptParts() { // 無料枠は太平洋時間の0時にリセット
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: `${o.year}-${o.month}-${o.day}`, mins: (+o.hour) * 60 + (+o.minute) };
}
function resetTimeText() {
  const t = new Date(Date.now() + (24 * 60 - ptParts().mins) * 60000);
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
}
const quota = {
  read() { try { return JSON.parse(localStorage.getItem('ext_quota') || '{}'); } catch { return {}; } },
  write(q) { try { localStorage.setItem('ext_quota', JSON.stringify(q)); } catch {} },
  limit(model = store.model) {
    try { const v = JSON.parse(localStorage.getItem('ext_limits') || '{}')[model]; if (v > 0) return v; } catch {}
    return DEFAULT_LIMIT[model] || 20;
  },
  setLimit(model, v) {
    try { const m = JSON.parse(localStorage.getItem('ext_limits') || '{}'); m[model] = v; localStorage.setItem('ext_limits', JSON.stringify(m)); } catch {}
  },
  used(model = store.model) { const q = this.read(), d = ptParts().day; return q[model]?.day === d ? q[model].n : 0; },
  add(model = store.model, n = 1) { const q = this.read(), d = ptParts().day; q[model] = { day: d, n: (q[model]?.day === d ? q[model].n : 0) + n }; this.write(q); },
  exhaust(model = store.model) { const q = this.read(); q[model] = { day: ptParts().day, n: this.limit(model) }; this.write(q); },
  left(model = store.model) { return Math.max(0, this.limit(model) - this.used(model)); },
};
function refreshQuota() {
  const el = $('#quotaNote'); if (!el) return;
  if (!store.key) { el.textContent = ''; return; }
  const left = quota.left(), games = Math.floor(left / CALLS_PER_GAME);
  el.textContent = games > 0
    ? `今日あと${games}ゲーム遊べます（残り${left}回／${quota.limit()}回）`
    : `今日の無料枠を使い切りました。${resetTimeText()}にリセットされます`;
  el.classList.toggle('ng', games === 0);
}

/* ---------- Gemini API（無料枠） ---------- */
async function ask(system, user, maxTokens = 4000) {
  if (!store.key) throw new Error('APIキーが未設定です。タイトルの「設定」から入れてください。');
  // 待ち時間を短くするため、AIの考える量を最小にする（使えないモデルなら外して送り直す）
  const m = store.model;
  const thinking = /^gemini-2\.5-pro/.test(m) ? { thinkingBudget: 128 } : /^gemini-2\./.test(m) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  const send = (withThinking) => {
    quota.add();
    const gc = { responseMimeType: 'application/json', maxOutputTokens: Math.max(maxTokens * 3, 16000), temperature: 1 };
    if (withThinking) gc.thinkingConfig = thinking;
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': store.key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: gc }),
    });
  };
  let res = await send(store.thinkOk !== false);
  if (res.status === 400) {
    const t0 = await res.clone().text();
    if (/thinking/i.test(t0)) { store.thinkOk = false; res = await send(false); }
  }
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) {
      if (/per ?day|PerDay|daily/i.test(t)) quota.exhaust();
      throw new Error(`無料枠の回数上限に達しました。1分ほど待つか、設定で別のモデルに切り替えてください（1日の上限は${resetTimeText()}にリセットされます）。`);
    }
    if (res.status === 400 || res.status === 403) throw new Error(`APIキーかモデルの設定を確認してください（${res.status}）：${t.slice(0, 200)}`);
    throw new Error(`API エラー（${res.status}）：${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const cand = j.candidates?.[0];
  if (!cand || cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT' || j.promptFeedback?.blockReason)
    throw new Error('AIが内容を出せませんでした（安全フィルター）。「もう一度」を押すと作り直します。');
  const txt = (cand.content?.parts || []).map((p) => (p.thought ? '' : p.text || '')).join('');
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('AIの返答を読み取れませんでした。');
  return JSON.parse(txt.slice(a, b + 1));
}

const GM = 'あなたは対戦ゲーム「エクストリーマーズ」のゲームマスターです。出力は必ずJSONオブジェクトだけにし、前後に説明やコードブロックを付けません。日本語で書きます。描写はコミカルにし、残酷・グロテスクな描写や、現実で真似できる危険行為の具体的な手順は書きません。';

function setupPrompt(type, genres) {
  const gl = genres.map((pl, p) => pl.map((r, k) => `プレイヤー${p + 1}・${k + 1}巡目：${r.join('／')}`).join('\n')).join('\n');
  return `ゲームの準備をしてください。

【人物】2人のプレイヤーに、4巡ぶん、毎巡5人ずつの候補を作ります（合計40人）。
- 全員別人。職業は40人で重複させない
- 職業・趣味・特技・弱点は互いに無関係にする。「趣味の延長の特技」「職業の延長の特技」「職業の延長の趣味」は禁止。ただし40人中4人ほどだけ、どれか1組が関連していてよい
- 特技は下の【特技のジャンル】の指定どおりに、5人の並び順に合わせて作る。同じジャンルでも中身は毎回変え、ありきたりにしない
- 職業は分野をばらつかせる（職人、農林水産、芸能、公務、医療、商売、乗り物、研究、夜の仕事、変わった職業など）
- 趣味もありきたりなものに偏らせない
- 弱点 weak：苦手なもの・怖いもの・困ったくせ・弱点になる性格など、作戦の足を引っぱりそうなもの。笑えるものにし、病名・障がい・見た目や出自にかかわるものは使わない
- 文字数を必ず守る：職業は10字以内、趣味は10字以内、特技は14字以内、弱点は12字以内。説明や補足、カッコ書きは付けない
- 年収は0円から数億円までばらつかせ、「720万円」「4億円」のように書く
- 運動神経 ath は1〜5の整数。偏らせない
- prop：その人の職業を表す小物を次の英字キーから1つ選ぶ（合うものがなければ "none"）：${PROP_KEYS}
- 実在の人物、有名キャラクター、子どもは使わない

【特技のジャンル】（各巡の5人の順番どおり）
${gl}

【究極の課題】タイプ「${type}」のミッションを1文で作ります。
- 2チームが同じ舞台でライバルとして同時に挑み、先にやり遂げたほうが勝つ形にする
- 命がけの緊迫感があるハラハラするミッションにする。ユーモアは少しだけ
- 標的・組織・場所の名前はすべて架空にする。実在の人物・団体・事件は使わない
- 人物の能力は考えずに作る。具体的な実行手順や残酷な描写は書かない

出力形式：
{"task":"課題の1文","players":[ [ [人物×5], [人物×5], [人物×5], [人物×5] ], [ 同じく4巡ぶん ] ]}
人物：{"income":"720万円","job":"職業","hobby":"趣味","skill":"特技","weak":"弱点","ath":3,"prop":"キー"}`;
}

function teamText() {
  return [0, 1].map((p) => {
    const tag = p === 0 ? 'A' : 'B';
    const lines = S.teams[p].map((m) =>
      `${m.id}：${m.job}｜年収${m.income}｜趣味：${m.hobby}｜特技：${m.skill}${m.weak ? `｜弱点：${m.weak}` : ''}｜運動神経${m.ath}${m.out ? '｜※退場済み' : ''}`).join('\n');
    return `チーム${tag}（${S.names[p]}）\n${lines}`;
  }).join('\n\n');
}
function historyText() {
  return S.history.length ? S.history.map((h, i) => `第${i + 1}関門：${h}`).join('\n') : 'まだなし';
}
const STAGE_SPEC = (n) => `第${n}関門（全${STAGES}関門。第${STAGES}関門が最終関門）の場面を作ります。
- 両チームは同じ場所にいて、互いの姿が見えるライバル同士。場面には必ず相手チームの存在や動きを絡める
- 関門の種類は毎回変える：追跡戦、乱戦、罠、謎解き、交渉、災害や崩落、裏切り、時間切れ寸前、標的との対決など。「警備や見張りをくぐり抜ける」場面は全3関門で多くても1回
- scene：場面の説明2〜3文。これまでの流れを引き継ぎ、緊迫感を出す
- options：対処の「方針」を4つ。label は12字以内、detail は35字以内。誰がやるかは書かない
  - kind "normal" を2つ：課題そのものに挑む方針。方針どうしは中身をはっきり変える（力ずく、だます、頭脳、回り道など）
  - kind "sabotage" を1つ：相手チームの邪魔をする方針
  - kind "coop" を1つ：相手チームに一時休戦・共闘を持ちかける方針
- 各 option に、退場していない全メンバーID（A1〜A4、B1〜B4）について、その方針を実行するときの適性 apt を付ける。fit＝特技がぴったり、stretch＝特技・趣味・職業のどれかをこじつけて使える、none＝無関係。1つの方針でfitは多くても2人まで
- 各 option に weak：その方針を実行するとき、弱点が足を引っぱるメンバーIDの配列（いなければ []）。こじつけすぎない
- physical：その方針が主に体を使うなら true`;
const OPT_SCHEMA = '{"scene":"…","options":[{"label":"…","detail":"…","kind":"normal","apt":{"A1":"fit","A2":"none",…},"weak":["B3"],"physical":false}, …4つ]}';

/* ---------- ゲーム開始・ドラフト ---------- */
function startGame(mode) {
  if (!store.key) { toast('先にAPIキーを設定してください'); openSettings(); return; }
  if (quota.left() < CALLS_PER_GAME) {
    toast(`今日の無料枠が足りません（${resetTimeText()}にリセット）`);
    refreshQuota(); show('home'); return;
  }
  S = {
    mode, names: mode === 'cpu' ? ['あなた', 'CPU'] : ['プレイヤー1', 'プレイヤー2'],
    pools: null, task: '', teams: [[], []], round: 0, turn: 0,
    stage: 0, scores: [0, 0], stagePts: [[], []], log: [], saved: false, history: [], scene: null, choice: [null, null], last: null,
  };
  doSetup();
}
async function doSetup() {
  loading(['エクストリーマーを招集中…', '極秘ミッションを受信中…', '候補者の経歴を洗い出し中…']);
  try {
    const pool = rnd(10) <= 7 ? TASK_HOT : TASK_MILD;
    const ti = rnd(pool.length) - 1, type = pool[ti];
    const genres = [0, 1].map(() => Array.from({ length: ROUNDS }, () => drawGenres(5)));
    const d = await ask(GM, setupPrompt(type, genres), 8000);
    if (!d.players || d.players.length < 2) throw new Error('人物データが足りません。');
    S.pools = d.players; S.task = d.task;
    S.type = type; S.mood = (pool === TASK_HOT ? GROOVE_HOT : GROOVE_MILD)[ti];
    nextDraft();
  } catch (e) { fail(e, doSetup); }
}
function isCpu(p) { return S.mode === 'cpu' && p === 1; }

function nextDraft() {
  if (S.round >= ROUNDS) return showReveal();
  const p = S.turn;
  if (isCpu(p)) {
    const c = S.pools[p][S.round];
    addMember(p, c[rnd(c.length) - 1]);
    return advanceDraft();
  }
  handoff(`${S.round + 1}巡目`, `${S.names[p]}の番`,
    S.mode === '2p' ? '相手に見えないように受け取ってください。押すと10秒のカウントが始まります。' : '押すと10秒のカウントが始まります。',
    showDraft);
}
function handoff(kicker, title, note, next) {
  $('#handoffKicker').textContent = kicker;
  $('#handoffTitle').textContent = title;
  $('#handoffNote').textContent = note;
  $('#handoffBtn').onclick = next;
  show('handoff');
}
function cardHTML(m, hideWeak = false) {
  const ath = Math.max(1, Math.min(5, +m.ath || 3));
  return `<div class="profHead"><span class="job">${esc(m.job)}</span><span class="income">${esc(m.income)}</span></div>
  <div class="prow"><span class="lab">趣味</span><span class="val">${esc(m.hobby)}</span></div>
  <div class="prow"><span class="lab">特技</span><span class="val">${esc(m.skill)}</span></div>${m.weak ? `
  <div class="prow"><span class="lab">弱点</span><span class="val weak">${hideWeak ? '？？？' : esc(m.weak)}</span></div>` : ''}
  <div class="prow"><span class="lab">運動</span><span class="val stars">${stars(ath)}</span></div>`;
}
function showDraft() {
  const p = S.turn, cands = S.pools[p][S.round];
  $('#draftKicker').textContent = `${S.round + 1}巡目 / ${ROUNDS}`;
  $('#draftWho').textContent = `${S.names[p]}が選ぶ`;
  const box = $('#cards'); box.innerHTML = '';
  let done = false;
  const choose = (m, timeout) => {
    if (done) return; done = true;
    cancelAnimationFrame(timerId);
    addMember(p, m);
    if (timeout) toast('時間切れ！ランダムで決定');
    setTimeout(advanceDraft, timeout ? 900 : 150);
  };
  cands.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'card'; b.innerHTML = cardHTML(m);
    b.onclick = () => choose(m, false);
    box.appendChild(b);
  });
  $('#myTeam').innerHTML = S.teams[p].map((m) => `<span class="chip">${esc(m.job)}</span>`).join('');
  show('draft');
  const bar = $('#timerBar'), t0 = performance.now();
  bar.classList.remove('warn');
  Sound.setUrgent(false);
  let lastSec = null;
  const tick = (now) => {
    const left = Math.max(0, 1 - (now - t0) / PICK_MS);
    bar.style.transform = `scaleX(${left})`;
    const sec = Math.ceil(left * PICK_MS / 1000);
    if (sec <= 3 && sec > 0 && sec !== lastSec) { lastSec = sec; Sound.sfx('tick', sec === 1); Sound.setUrgent(true); bar.classList.add('warn'); }
    if (left <= 0) { Sound.sfx('timeout'); return choose(cands[rnd(cands.length) - 1], true); }
    timerId = requestAnimationFrame(tick);
  };
  timerId = requestAnimationFrame(tick);
}
function addMember(p, m) {
  const id = (p === 0 ? 'A' : 'B') + (S.teams[p].length + 1);
  S.teams[p].push({ ...m, ath: Math.max(1, Math.min(5, +m.ath || 3)), id, out: false });
}
function advanceDraft() {
  S.turn++;
  if (S.turn > 1) { S.turn = 0; S.round++; }
  nextDraft();
}

/* ---------- 公開 ---------- */
function teamsHTML(G = S, hide = [false, false]) {
  return [0, 1].map((p) => `<div class="team ${p ? 'b' : 'a'}"><h3>${p ? '🟦' : '🟥'} ${esc(G.names[p])}</h3>${
    G.teams[p].map((m) => `<div class="member prof ${m.out ? 'out' : ''}">${cardHTML(m, hide[p])}</div>`).join('')
  }</div>`).join('');
}
function showReveal() {
  $('#teamsBox').innerHTML = teamsHTML(S, S.mode === 'cpu' ? [false, true] : [true, true]); // 相手の弱点は伏せる
  $('#taskText').textContent = S.task;
  show('reveal');
}

/* ---------- 関門 ---------- */
async function firstStage() {
  loading([INTRO_LINE[S.mood] || 'ミッション開始…', '第1関門へ突入中…'], vsHTML('4人のエクストリーマーズ', '4人のエクストリーマーズ', esc(S.task)));
  try {
    const d = await ask(GM, `究極の課題：${S.task}\n\n${teamText()}\n\n${STAGE_SPEC(1)}\n\n出力形式：${OPT_SCHEMA}`, 3000);
    S.scene = d; S.stage = 0; showStage();
  } catch (e) { fail(e, firstStage); }
}
function showStage() {
  S.choice = [null, null];
  chooseFor(0);
}
function chooseFor(p) {
  if (p > 1) return resolveStage();
  if (isCpu(p)) {
    S.choice[p] = cpuChoice(p);
    return chooseFor(p + 1);
  }
  const render = () => {
    const last = S.stage === STAGES - 1;
    $('#stageKicker').textContent = last ? `最終関門（第${STAGES}関門）` : `第${S.stage + 1}関門`;
    $('#sceneText').textContent = S.scene.scene;
    $('#stageWho').textContent = `${S.names[p]}の作戦は？（メンバーの能力は下に）`;
    const teamBox = (q, open) => `<details class="team ${q ? 'b' : 'a'}"${open ? ' open' : ''}><summary>${q ? '🟦' : '🟥'} ${esc(S.names[q])}${q === p ? '（自分）' : '（相手）'}のエクストリーマーズ</summary>${
      S.teams[q].map((m) => `<div class="member prof ${m.out ? 'out' : ''}">${cardHTML(m, q !== p)}${m.out ? '<span class="outTag">退場</span>' : ''}</div>`).join('')}</details>`;
    $('#stageTeams').innerHTML = teamBox(p, true) + teamBox(1 - p, false);
    const box = $('#optionsBox'); box.innerHTML = '';
    S.scene.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'btn option';
      const tag = o.kind === KIND.sabotage ? '<em class="tag sab">妨害</em>' : o.kind === KIND.coop ? '<em class="tag coop">共闘</em>' : '';
      b.innerHTML = `<b>${tag}${esc(o.label)}</b><span>${esc(o.detail)}</span>`;
      b.onclick = () => { S.choice[p] = i; chooseFor(p + 1); };
      box.appendChild(b);
    });
    show('stage');
  };
  if (S.mode === '2p') handoff(S.stage === STAGES - 1 ? '最終関門' : `第${S.stage + 1}関門`, `${S.names[p]}の番`, '相手に見えないように受け取ってください。', render);
  else render();
}
function kindOf(p) { const k = S.scene.options[S.choice[p]]?.kind; return KIND[k] ? k : KIND.normal; }
function active(p) { return S.teams[p].filter((m) => !m.out); }
function weakHit(o, m) { return !!m.weak && Array.isArray(o.weak) && o.weak.includes(m.id); }
function cpuChoice(p) { // 自チームの適性が高い方針を少し選びやすく
  const opts = S.scene.options.map((o, i) => ({ i, w: 1 + active(p).reduce((t, m) => t + ({ fit: 3, stretch: 1, none: 0 }[o.apt?.[m.id]] ?? 0) - (weakHit(o, m) ? 1 : 0), 0) }));
  return pickWeighted(opts, (x) => x.w).i;
}
/* 実行する人と成功ラインを決める（サイコロはまだ振らない） */
function prepTeam(p) {
  const o = S.scene.options[S.choice[p]];
  const members = active(p);
  const aptOf = (m) => (APT_W[o.apt?.[m.id]] ? o.apt[m.id] : 'none');
  // 弱点が引っかかる人は実行役に選ばれにくい（重み0.3倍）
  const ex = pickWeighted(members, (m) => APT_W[aptOf(m)] * (weakHit(o, m) ? 3 : 10));
  const apt = aptOf(ex);
  const base = APT_RATE[apt] + (o.physical ? (ex.ath - 3) * 10 : 0);
  const mine = kindOf(p), theirs = kindOf(1 - p), mods = [];
  // 向いている仲間が加勢することがある（ぴったり60%、こじつけ25%。最大2人）
  const helpers = [];
  const weak = weakHit(o, ex);
  if (weak) mods.push([`弱点「${ex.weak}」が足を引っぱる`, -WEAK_HIT]);
  members.filter((m) => m !== ex && !weakHit(o, m)).forEach((m) => {
    const a = aptOf(m);
    if (helpers.length < 2 && ((a === 'fit' && rnd(100) <= 60) || (a === 'stretch' && rnd(100) <= 25))) helpers.push({ m, a });
  });
  helpers.forEach(({ m, a }) => mods.push([`${m.job}が加勢`, a === 'fit' ? +10 : +5]));
  if (mine === KIND.sabotage) mods.push(['妨害に人手を割いた', -SABOTAGE_COST]);
  if (theirs === KIND.sabotage) mods.push(['相手チームの妨害', -SABOTAGE_HIT]);
  if (mine === KIND.coop && theirs === KIND.coop) mods.push(['共闘成立', +COOP_BOTH]);
  if (mine === KIND.sabotage && theirs === KIND.coop) mods.push(['共闘の申し出を逆手に取った', +BETRAY_BONUS]);
  if (mine === KIND.coop && theirs === KIND.normal) mods.push(['共闘を断られた', 0]);
  const rate = Math.max(5, Math.min(95, base + mods.reduce((t, m) => t + m[1], 0)));
  return { p, label: o.label, detail: o.detail, kind: mine, ex, helpers: helpers.map((h) => h.m), apt, base, mods, weak, rate, canOut: S.stage < STAGES - 1 && members.length > 1 };
}
/* 出た目から成否と得点を決める。成功は配点の60〜100%、失敗は0〜30%（惜しいほど多い） */
function finishTeam(r, roll) {
  const w = STAGE_WEIGHT[S.stage];
  r.roll = roll; r.ok = roll <= r.rate;
  r.pts = r.ok
    ? Math.round(w * (0.6 + 0.4 * (r.rate - roll + 1) / r.rate))
    : Math.round(w * 0.3 * (1 - (roll - r.rate - 1) / Math.max(1, 100 - r.rate)));
  r.out = false;
  if (!r.ok && r.canOut && rnd(100) <= OUT_CHANCE) { const crew = [r.ex, ...r.helpers]; r.outM = crew[rnd(crew.length) - 1]; r.out = true; r.outM.out = true; }
  const margin = Math.abs(roll - r.rate);
  r.grade = r.ok ? (margin >= 40 ? '大成功' : margin <= 8 ? 'ギリギリ成功' : '成功') : (margin <= 8 ? '惜しくも失敗' : margin >= 40 ? '大失敗' : '失敗');
  S.scores[r.p] += r.pts; S.stagePts[r.p][S.stage] = r.pts;
  return r;
}
function outcomeText(r) {
  const m = r.ex;
  const inter = r.mods.length ? `相手との駆け引き：${r.mods.map((x) => x[0]).join('、')}。` : '';
  return `チーム${r.p ? 'B' : 'A'}（${S.names[r.p]}）：方針「${r.label}」（${r.detail}、種類：${{ normal: '課題に挑む', sabotage: '相手を妨害', coop: '相手に共闘を持ちかける' }[r.kind]}）。${inter}実行したのは${m.id}の${m.job}（趣味：${m.hobby}／特技：${m.skill}${m.weak ? `／弱点：${m.weak}` : ''}／運動神経${m.ath}）${r.helpers.length ? `。加勢したのは${r.helpers.map((h) => `${h.id}の${h.job}（特技：${h.skill}）`).join('と')}` : ''}。判定は【${r.grade}】${r.out ? `。失敗の結果、${r.outM.job}が退場` : ''}。`;
}
function decideWinner() {
  if (S.scores[0] !== S.scores[1]) return { w: S.scores[0] > S.scores[1] ? 0 : 1, how: '得点' };
  const f0 = S.stagePts[0][STAGES - 1] || 0, f1 = S.stagePts[1][STAGES - 1] || 0;
  if (f0 !== f1) return { w: f0 > f1 ? 0 : 1, how: '最終関門' };
  return { w: rnd(2) - 1, how: 'コイントス' };
}
function resolveStage() {
  if (S.last && S.last.stage === S.stage && S.last.done) return narrate();
  S.last = { stage: S.stage, rs: [prepTeam(0), prepTeam(1)], done: false };
  rollFor(0);
}
/* サイコロ画面：人間は自分でタップ、CPUは自動で振る */
function rollFor(p) {
  if (p > 1) {
    S.last.done = true;
    if (S.stage === STAGES - 1) S.last.win = decideWinner();
    return narrate();
  }
  const r = S.last.rs[p];
  const go = () => {
    const m = r.ex;
    $('#rollKicker').textContent = S.stage === STAGES - 1 ? '最終関門' : `第${S.stage + 1}関門`;
    $('#rollTitle').textContent = `${p ? '🟦' : '🟥'} ${S.names[p]}の判定`;
    $('#rollPlan').textContent = `作戦：${r.label}`;
    $('#rollWho').innerHTML = `<p class="note" style="margin:0 0 6px">実行するのは…</p>${cardHTML(m, isCpu(p) && !r.weak)}${r.helpers.map((h) => `<p class="note helpLab">＋加勢</p>${cardHTML(h, isCpu(p))}`).join('')}`;
    $('#rollLine').textContent = `${r.rate}以下で成功`;
    $('#rollMods').innerHTML = r.mods.map(([t, v]) => `<span>${esc(t)}${v ? `（${v > 0 ? '+' : '−'}${Math.abs(v)}）` : ''}</span>`).join('');
    const face = $('#dieFace'), verdict = $('#rollVerdict'), btn = $('#rollBtn');
    face.textContent = '?'; face.classList.remove('spin'); verdict.textContent = ''; verdict.className = 'rollVerdict';
    let rolled = false;
    const doRoll = () => {
      if (rolled) return; rolled = true;
      btn.disabled = true; btn.textContent = '…';
      face.classList.add('spin');
      Sound.sfx('spin');
      const iv = setInterval(() => { face.textContent = rnd(100); }, 60);
      setTimeout(() => {
        clearInterval(iv); face.classList.remove('spin');
        const roll = rnd(100);
        finishTeam(r, roll);
        face.textContent = roll;
        verdict.textContent = `${r.grade}！ +${r.pts}点${r.out ? `（⚠️${r.outM.job}が退場）` : ''}`;
        verdict.classList.add(r.ok ? 'ok' : 'ng');
        Sound.sfx(r.grade === '大成功' ? 'great' : r.ok ? 'ok' : 'ng');
        if (r.out) setTimeout(() => Sound.sfx('out'), 450);
        let moved = false;
        const next = () => { if (moved) return; moved = true; rollFor(p + 1); };
        if (isCpu(p)) { btn.textContent = '…'; setTimeout(next, 1600); }
        else { btn.disabled = false; btn.textContent = '次へ'; btn.onclick = next; }
      }, 1100);
    };
    if (isCpu(p)) { btn.textContent = 'CPUが振っています'; btn.disabled = true; show('roll'); setTimeout(doRoll, 700); }
    else { btn.textContent = 'サイコロを振る'; btn.disabled = false; btn.onclick = doRoll; show('roll'); }
  };
  if (S.mode === '2p') handoff(S.stage === STAGES - 1 ? '最終関門' : `第${S.stage + 1}関門`, `${S.names[p]}がサイコロを振る番`, '受け取ったら、自分でサイコロを振ってください。', go);
  else go();
}
async function narrate() {
  const { rs, win } = S.last;
  const final = S.stage === STAGES - 1;
  loading(actionLines(rs, final), vsHTML(crewName(rs[0]), crewName(rs[1]), `${esc(S.names[0])} ${S.scores[0]}点　―　${S.scores[1]}点 ${esc(S.names[1])}`));
  const base = `究極の課題：${S.task}\n\n${teamText()}\n\nこれまで：\n${historyText()}\n\n今回の場面：${S.scene.scene}\n\n判定結果（サイコロで決定済み。成功と失敗を絶対に入れ替えない。忖度しない。妨害・共闘・裏切りなど相手との駆け引きも物語に描く）：\n${outcomeText(rs[0])}\n${outcomeText(rs[1])}`;
  const spec = final
    ? `\n\n両チームの結果を書き、最後に決着を書きます。勝者はチーム${win.w ? 'B' : 'A'}（${S.names[win.w]}）で確定しています（決め手：${win.how}）。勝者を変えないこと。
出力形式：{"resultA":"チームAの結果2〜4文","resultB":"チームBの結果2〜4文","epilogue":"決着の場面2〜3文"}`
    : `\n\n両チームの結果を書き、続けて次の関門を作ります。退場した人物は次から登場させない。
- resultA / resultB：それぞれ2〜4文。実行した人物を名前（職業）で登場させる
- summary：今回の出来事の要約1文
- next：${STAGE_SPEC(S.stage + 2)}
出力形式：{"resultA":"…","resultB":"…","summary":"…","next":${OPT_SCHEMA}}`;
  try {
    const d = await ask(GM, base + spec, 3500);
    S.history.push(d.summary || `${rs[0].label}／${rs[1].label}`);
    showResult(d);
  } catch (e) { fail(e, narrate); }
}
function diceLine(r) {
  return `<div class="dice">実行：${esc(crewName(r))}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${r.grade}</span> +${r.pts}点${r.out ? `｜⚠️${esc(r.outM.job)}が退場` : ''}</div>`;
}
function scoreHTML() {
  return `<span>🟥 ${esc(S.names[0])} ${S.scores[0]}<small>/100</small></span><span>🟦 ${esc(S.names[1])} ${S.scores[1]}<small>/100</small></span>`;
}
function showResult(d) {
  const { rs, win } = S.last;
  const final = S.stage === STAGES - 1;
  $('#resultKicker').textContent = final ? '最終関門の結果' : `第${S.stage + 1}関門の結果`;
  $('#resultBox').innerHTML = rs.map((r) => `<div class="res ${r.p ? 'b' : 'a'}"><h3>${r.p ? '🟦' : '🟥'} ${esc(S.names[r.p])}：${esc(r.label)}</h3>${diceLine(r)}<p>${esc(r.p ? d.resultB : d.resultA)}</p></div>`).join('');
  $('#scoreBox').innerHTML = scoreHTML();
  S.log[S.stage] = {
    scene: S.scene.scene,
    rs: rs.map((r) => ({ p: r.p, label: r.label, job: crewName(r), outJob: r.out ? r.outM.job : '', roll: r.roll, rate: r.rate, grade: r.grade, ok: r.ok, pts: r.pts, out: r.out, text: r.p ? d.resultB : d.resultA })),
  };
  const btn = $('#resultNext');
  if (final) {
    btn.textContent = '決着を見る';
    btn.onclick = () => showFinal(win, d.epilogue);
  } else {
    btn.textContent = S.stage + 2 === STAGES ? '最終関門へ' : `第${S.stage + 2}関門へ`;
    btn.onclick = () => { S.scene = d.next; S.stage++; showStage(); };
  }
  show('result');
}
function showFinal(win, epilogue) {
  const how = win.how === 'コイントス' ? '（同点・最終関門も互角のためコイントス）' : win.how === '最終関門' ? '（同点・最終関門の得点で決着）' : '';
  $('#winnerText').textContent = `🏆 ${S.names[win.w]}の勝ち！`;
  $('#epilogueText').textContent = `${epilogue || ''}${how ? '\n' + how : ''}`;
  $('#finalScore').innerHTML = scoreHTML();
  if (!S.saved) {
    S.saved = true;
    saveLog({
      at: Date.now(), mode: S.mode, names: S.names, task: S.task, scores: S.scores, winner: win.w, how: win.how,
      teams: S.teams.map((t) => t.map((m) => ({ job: m.job, income: m.income, hobby: m.hobby, skill: m.skill, weak: m.weak || '', ath: m.ath, prop: m.prop || '', out: m.out }))),
      stages: S.log, epilogue: epilogue || '',
    });
  }
  show('final');
}

/* ---------- 対戦ログ ---------- */
const LOG_KEY = 'ext_logs', LOG_MAX = 50;
function loadLogs() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } }
function saveLog(g) {
  const logs = loadLogs(); logs.unshift(g);
  try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, LOG_MAX))); } catch {}
}
function fmtDate(t) {
  const d = new Date(t), z = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
function showLogs() {
  const logs = loadLogs(), box = $('#logList');
  box.innerHTML = logs.length ? '' : '<p class="note">まだ対戦の記録がありません。</p>';
  logs.forEach((g, i) => {
    const b = document.createElement('button');
    b.className = 'btn option';
    b.innerHTML = `<b>🏆 ${esc(g.names[g.winner])}の勝ち　${g.scores[0]} - ${g.scores[1]}</b><span>${fmtDate(g.at)}｜${g.mode === 'cpu' ? 'CPU戦' : '2人対戦'}<br>${esc(g.task)}</span>`;
    b.onclick = () => showLogDetail(i);
    box.appendChild(b);
  });
  show('logs');
}
function showLogDetail(i) {
  const g = loadLogs()[i]; if (!g) return showLogs();
  const stageName = (k) => (k === STAGES - 1 ? '最終関門' : `第${k + 1}関門`);
  $('#logDetail').innerHTML = `
    <p class="kicker">${fmtDate(g.at)}｜${g.mode === 'cpu' ? 'CPU戦' : '2人対戦'}</p>
    <h2 class="winner">🏆 ${esc(g.names[g.winner])}の勝ち</h2>
    <div class="score"><span>🟥 ${esc(g.names[0])} ${g.scores[0]}<small>/100</small></span><span>🟦 ${esc(g.names[1])} ${g.scores[1]}<small>/100</small></span></div>
    <div class="taskBox"><p class="kicker">究極の課題</p><p class="task">${esc(g.task)}</p></div>
    ${teamsHTML(g)}
    ${(g.stages || []).map((st, k) => st ? `<p class="kicker">${stageName(k)}</p><p class="scene">${esc(st.scene)}</p>
      ${st.rs.map((r) => `<div class="res ${r.p ? 'b' : 'a'}"><h3>${r.p ? '🟦' : '🟥'} ${esc(g.names[r.p])}：${esc(r.label)}</h3>
      <div class="dice">実行：${esc(r.job)}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${esc(r.grade)}</span> +${r.pts}点${r.out ? `｜⚠️${esc(r.outJob || '')}が退場` : ''}</div><p>${esc(r.text)}</p></div>`).join('')}` : '').join('')}
    ${g.epilogue ? `<p class="kicker">決着</p><p class="scene">${esc(g.epilogue)}</p>` : ''}`;
  show('logView');
}



/* ---------- 走る棒人間（読み込み画面） ---------- */
function figure(P, acc, eyeOn = true) {
  const lines = [[P.n, P.hip], [P.n, P.le, P.lh], [P.n, P.re, P.rh], [P.hip, P.lk, P.lf], [P.hip, P.rk, P.rf]]
    .map((pts) => `M${pts.map((q) => q.join(',')).join(' L')}`).join(' ');
  const [hx, hy] = P.h;
  let extra = '';
  if (acc === 'band') extra = `<path d="M${hx - 15},${hy - 6} L${hx + 15},${hy - 6}" stroke="#E63322" stroke-width="6"/><path d="M${hx + 14},${hy - 6} q14,-6 22,2 M${hx + 14},${hy - 4} q12,4 18,12" stroke="#E63322" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  if (acc === 'cap') extra = `<path d="M${hx - 16},${hy - 2} A16,16 0 0 1 ${hx + 16},${hy - 2} Z" fill="#3EA8FF"/><path d="M${hx - 16},${hy - 4} L${hx - 30},${hy - 1}" stroke="#3EA8FF" stroke-width="5" stroke-linecap="round"/>`;
  const eye = eyeOn ? `<path d="M${hx - 13},${hy + 1} l9,2 l-8,2 z" fill="#fff"/>` : '';
  return `<g stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="${lines}" stroke="#fff" stroke-width="15"/><circle cx="${hx}" cy="${hy}" r="18" fill="#fff"/><path d="${lines}" stroke="#111" stroke-width="9"/><circle cx="${hx}" cy="${hy}" r="15" fill="#111"/></g>${extra}${eye}`;
}
const RUN = [ // 左向きに走る4コマ
  { h: [40, 30], n: [46, 48], hip: [58, 90], le: [30, 60], lh: [20, 46], re: [66, 66], rh: [74, 84], lk: [40, 108], lf: [24, 128], rk: [74, 112], rf: [92, 140] },
  { h: [40, 32], n: [46, 50], hip: [58, 92], le: [40, 70], lh: [34, 88], re: [62, 64], rh: [72, 50], lk: [50, 118], lf: [50, 146], rk: [66, 118], rf: [80, 132] },
  { h: [40, 30], n: [46, 48], hip: [58, 90], le: [64, 64], lh: [76, 80], re: [32, 60], rh: [22, 46], lk: [72, 112], lf: [90, 140], rk: [42, 108], rf: [26, 128] },
  { h: [40, 32], n: [46, 50], hip: [58, 92], le: [62, 64], lh: [72, 50], re: [40, 70], rh: [34, 88], lk: [66, 118], lf: [80, 132], rk: [50, 118], rf: [50, 146] },
];
function runnerSVG(n) {
  const one = (acc, dx, delay) => `<g transform="translate(${dx},0)">${RUN.map((P, k) => `<g class="rf" style="animation-delay:${-(0.48 - k * 0.12 + delay).toFixed(2)}s">${figure(P, acc)}</g>`).join('')}</g>`;
  return `<svg viewBox="0 0 ${n === 2 ? 260 : 120} 150" class="runnerSvg" aria-hidden="true">${n === 2 ? one('band', 10, 0) + one('cap', 140, 0.24) : one('band', 10, 0)}</svg>`;
}

/* ---------- 待ち時間ミニゲーム：標的タップ ---------- */
let miniTimer = null, miniScore = 0;
function miniBest() { try { return +localStorage.getItem('ext_mini_best') || 0; } catch { return 0; } }
function miniReset() {
  clearInterval(miniTimer); miniTimer = null; miniScore = 0;
  $('#miniField').innerHTML = ''; $('#miniField').hidden = true;
  $('#miniStart').hidden = false;
  $('#miniScore').textContent = `ベスト ${miniBest()}点`;
}
function miniStart() {
  $('#miniStart').hidden = true;
  const field = $('#miniField'); field.hidden = false; field.innerHTML = '';
  miniScore = 0;
  const upd = () => { $('#miniScore').textContent = `${miniScore}点（ベスト ${miniBest()}点）`; };
  upd();
  miniTimer = setInterval(() => {
    if (!$('#loading').classList.contains('active')) return miniReset();
    const b = document.createElement('button');
    b.className = 'target'; b.type = 'button'; b.setAttribute('aria-label', '標的');
    const w = field.clientWidth - 52, h = field.clientHeight - 52;
    b.style.left = `${rnd(Math.max(1, w))}px`; b.style.top = `${rnd(Math.max(1, h))}px`;
    const life = Math.max(550, 1000 - miniScore * 15);
    b.onclick = (e) => {
      e.stopPropagation(); b.remove(); miniScore++;
      if (miniScore > miniBest()) { try { localStorage.setItem('ext_mini_best', miniScore); } catch {} }
      Sound.sfx('ok'); upd();
    };
    field.appendChild(b);
    setTimeout(() => b.remove(), life);
  }, 700);
}

/* ---------- 今日のエクストリーマー ---------- */
// 職業を表す小物。手の位置(0,0)を基準に描き、白フチはフィルターで付ける
const PROPS = {
  mic: ['マイク', '<rect x="-3" y="-16" width="6" height="18" rx="2" fill="#555"/><circle cx="0" cy="-21" r="7" fill="#bbb"/>'],
  pen: ['ペン', '<path d="M0,6 L0,-24" stroke="#3EA8FF" stroke-width="6"/><path d="M-3,6 L0,13 L3,6 Z" fill="#111"/>'],
  book: ['本', '<rect x="-12" y="-22" width="24" height="18" rx="2" fill="#E63322"/><path d="M0,-22 V-4" stroke="#fff" stroke-width="2"/>'],
  wrench: ['スパナ', '<path d="M0,8 L0,-16" stroke="#9aa" stroke-width="6"/><path d="M-8,-30 a9,9 0 1 0 16,0 l-4,5 h-8 z" fill="#9aa"/>'],
  hammer: ['ハンマー', '<path d="M0,8 V-20" stroke="#9a6a3a" stroke-width="5"/><rect x="-12" y="-29" width="24" height="10" rx="2" fill="#777"/>'],
  pan: ['フライパン', '<path d="M0,6 L0,-9" stroke="#333" stroke-width="5"/><ellipse cx="0" cy="-20" rx="13" ry="10" fill="#444"/><ellipse cx="0" cy="-20" rx="6" ry="5" fill="#FFD23F"/>'],
  medkit: ['救急箱', '<path d="M-5,4 V0 H5 V4" stroke="#ddd" stroke-width="3" fill="none"/><rect x="-13" y="4" width="26" height="20" rx="3" fill="#fff"/><path d="M0,8 V20 M-6,14 H6" stroke="#E63322" stroke-width="4"/>'],
  briefcase: ['かばん', '<path d="M-5,4 V0 H5 V4" stroke="#7a4a2a" stroke-width="3" fill="none"/><rect x="-14" y="4" width="28" height="20" rx="3" fill="#7a4a2a"/><rect x="-2" y="11" width="4" height="4" fill="#FFD23F"/>'],
  phone: ['スマホ', '<rect x="-7" y="-24" width="14" height="24" rx="3" fill="#222"/><rect x="-5" y="-21" width="10" height="16" fill="#3EA8FF"/>'],
  camera: ['カメラ', '<rect x="-9" y="-22" width="7" height="5" fill="#333"/><rect x="-14" y="-19" width="28" height="17" rx="3" fill="#333"/><circle cx="0" cy="-10.5" r="5.5" fill="#3EA8FF" stroke="#fff" stroke-width="2"/>'],
  guitar: ['ギター', '<path d="M0,0 L0,-32" stroke="#9a6a3a" stroke-width="4"/><ellipse cx="0" cy="8" rx="11" ry="10" fill="#E63322"/><circle cx="0" cy="7" r="3" fill="#111"/>'],
  brush: ['筆', '<path d="M0,8 L0,-18" stroke="#9a6a3a" stroke-width="4"/><path d="M-4,-18 L0,-30 L4,-18 Z" fill="#E63322"/>'],
  key: ['鍵', '<circle cx="0" cy="-22" r="7" fill="none" stroke="#FFD23F" stroke-width="4"/><path d="M0,-15 V8 M0,2 h6 M0,7 h5" stroke="#FFD23F" stroke-width="4"/>'],
  magnifier: ['虫めがね', '<path d="M0,-13 V8" stroke="#9a6a3a" stroke-width="5"/><circle cx="0" cy="-22" r="9" fill="#bfe3ff" stroke="#555" stroke-width="4"/>'],
  flask: ['フラスコ', '<path d="M-4,-28 h8 v9 l9,15 a3,3 0 0 1 -3,4 h-20 a3,3 0 0 1 -3,-4 l9,-15 z" fill="#fff"/><path d="M-9,-9 h18 l3,5 a2,2 0 0 1 -2,3 h-20 a2,2 0 0 1 -2,-3 z" fill="#5BE37A"/>'],
  broom: ['ほうき', '<path d="M0,-30 V8" stroke="#9a6a3a" stroke-width="4"/><path d="M-8,8 h16 l5,15 h-26 z" fill="#FFD23F"/>'],
  shovel: ['スコップ', '<path d="M0,-28 V6" stroke="#9a6a3a" stroke-width="4"/><path d="M-6,-30 h12" stroke="#777" stroke-width="4"/><path d="M-8,6 h16 l-2,11 l-6,6 l-6,-6 z" fill="#999"/>'],
  rod: ['釣りざお', '<path d="M0,6 L22,-40" stroke="#9a6a3a" stroke-width="3"/><path d="M22,-40 Q30,-20 27,0" stroke="#fff" stroke-width="1.5" fill="none"/><circle cx="27" cy="2" r="3" fill="#E63322"/>'],
  flower: ['花', '<path d="M0,6 V-16" stroke="#3a9a4a" stroke-width="3"/><g fill="#FF6FA8"><circle cx="0" cy="-28" r="5"/><circle cx="-6" cy="-21" r="5"/><circle cx="6" cy="-21" r="5"/><circle cx="-4" cy="-14" r="4"/><circle cx="4" cy="-14" r="4"/></g><circle cx="0" cy="-20" r="4" fill="#FFD23F"/>'],
  wheel: ['ハンドル', '<circle cx="0" cy="-12" r="13" fill="none" stroke="#666" stroke-width="5"/><path d="M-13,-12 H13 M0,-12 V1" stroke="#666" stroke-width="4"/>'],
  pizza: ['ピザ', '<path d="M-14,-4 L14,-4 L0,-30 Z" fill="#FFD23F" stroke="#d9902a" stroke-width="3" stroke-linejoin="round"/><g fill="#E63322"><circle cx="-4" cy="-10" r="2.5"/><circle cx="4" cy="-9" r="2.5"/><circle cx="0" cy="-18" r="2.5"/></g>'],
  cup: ['湯のみ', '<path d="M-9,-16 h18 l-2,16 h-14 z" fill="#fff"/><path d="M9,-12 a4,4 0 0 1 0,8" stroke="#fff" stroke-width="3" fill="none"/><path d="M-3,-20 q-3,-4 0,-8 M3,-20 q-3,-4 0,-8" stroke="#ccc" stroke-width="2" fill="none"/>'],
  bottle: ['ワイン', '<rect x="-3" y="-34" width="6" height="12" fill="#7a2a3a"/><rect x="-6" y="-26" width="12" height="28" rx="4" fill="#7a2a3a"/><rect x="-6" y="-14" width="12" height="8" fill="#fff"/>'],
  clipboard: ['書類', '<rect x="-11" y="-28" width="22" height="28" rx="2" fill="#9a6a3a"/><rect x="-8" y="-24" width="16" height="21" fill="#fff"/><rect x="-5" y="-31" width="10" height="5" rx="1" fill="#777"/><path d="M-5,-18 h10 M-5,-13 h10 M-5,-8 h7" stroke="#999" stroke-width="2"/>'],
  money: ['札束', '<rect x="-14" y="-18" width="28" height="15" rx="2" fill="#5BE37A" stroke="#2a8a4a" stroke-width="2"/><circle cx="0" cy="-10.5" r="4" fill="#2a8a4a"/>'],
  crown: ['王冠', '<path d="M-13,-6 L-13,-24 L-6,-14 L0,-28 L6,-14 L13,-24 L13,-6 Z" fill="#FFD23F" stroke-linejoin="round"/>'],
  ball: ['ボール', '<circle cx="0" cy="-14" r="12" fill="#fff"/><path d="M-12,-14 q12,6 24,0 M0,-26 q-6,12 0,24" stroke="#E63322" stroke-width="2" fill="none"/>'],
  baton: ['指揮棒', '<path d="M0,4 L14,-30" stroke="#fff" stroke-width="3"/><circle cx="0" cy="4" r="3.5" fill="#9a6a3a"/>'],
  lantern: ['ランタン', '<path d="M0,0 V6" stroke="#777" stroke-width="2"/><rect x="-8" y="6" width="16" height="20" rx="3" fill="#FFD23F"/><path d="M-10,6 h20 M-10,26 h20" stroke="#777" stroke-width="3"/>'],
  letter: ['手紙', '<rect x="-13" y="-20" width="26" height="17" fill="#fff"/><path d="M-13,-20 L0,-10 L13,-20" stroke="#E63322" stroke-width="2" fill="none"/>'],
  scissors: ['はさみ', '<path d="M0,-4 L-7,-30 M0,-4 L7,-30" stroke="#bbb" stroke-width="3"/><circle cx="-5" cy="3" r="4" fill="none" stroke="#E63322" stroke-width="3"/><circle cx="5" cy="3" r="4" fill="none" stroke="#E63322" stroke-width="3"/>'],
  laptop: ['パソコン', '<rect x="-14" y="-24" width="28" height="18" rx="2" fill="#333"/><rect x="-11" y="-21" width="22" height="12" fill="#3EA8FF"/><path d="M-17,-5 h34 l-3,4 h-28 z" fill="#aaa"/>'],
  flag: ['旗', '<path d="M0,8 V-34" stroke="#ccc" stroke-width="3"/><path d="M0,-34 h20 l-5,7 l5,7 h-20 z" fill="#E63322"/>'],
};
const PROP_KEYS = Object.entries(PROPS).map(([k, [n]]) => `${k}=${n}`).join('、');
// AIが小物を返していない人物（以前のログなど）は職業名から推測する
const PROP_GUESS = [
  [/技工|整備|修理|配管|電気工|メカ|機械/, 'wrench'], [/大工|鍛冶|裁判|建築|左官|解体/, 'hammer'],
  [/医|看護|救急|救命|薬剤/, 'medkit'], [/研究|化学|科学|博士/, 'flask'], [/探偵|鑑定|刑事|考古|調査/, 'magnifier'],
  [/指揮/, 'baton'], [/ギター|バンド|ミュージシャン|ロック/, 'guitar'],
  [/歌手|司会|アナウンサー|芸人|ラッパー|DJ|実況|声優|アイドル|落語|漫才/, 'mic'],
  [/作家|記者|編集|ライター|脚本|翻訳|詩人|俳人|予報士/, 'pen'], [/画家|絵|似顔|デザイナー|書道|塗装/, 'brush'],
  [/教師|教授|司書|図書|講師|学生|僧|牧師/, 'book'], [/料理|シェフ|コック|板前|調理|寿司|ラーメン|食堂/, 'pan'],
  [/ピザ|宅配|出前|デリバリー/, 'pizza'], [/郵便|手紙/, 'letter'], [/カフェ|喫茶|バリスタ|茶|和菓子/, 'cup'],
  [/ソムリエ|バー|酒|ワイン|醸造/, 'bottle'], [/美容|理容|床屋|仕立|裁縫|テーラー/, 'scissors'],
  [/プログラマ|エンジニア|ハッカー|ゲーマー|システム/, 'laptop'], [/配信|インフルエンサー|ユーチューバー|コールセンター/, 'phone'],
  [/カメラ|写真|撮影|映像/, 'camera'], [/漁|釣り|海女|船/, 'rod'], [/花屋|華道|生け花|養蜂|葬儀/, 'flower'],
  [/農|庭師|園芸|植木|発掘|墓/, 'shovel'], [/清掃|掃除|家政|クリーニング/, 'broom'],
  [/運転|ドライバー|タクシー|バス|トラック|レーサー|パイロット/, 'wheel'], [/灯台|夜警|炭鉱|山岳/, 'lantern'],
  [/鍵|錠|警備|守衛|管理人|ホテル/, 'key'], [/王|姫|貴族|殿/, 'crown'],
  [/選手|スポーツ|サッカー|野球|体育|保育/, 'ball'], [/雀士|ギャンブ|株|トレーダー|金融|銀行|質屋/, 'money'],
  [/社長|会社|起業|弁護|営業|商社|税理|会計|投資|不動産|跡取り|秘書/, 'briefcase'],
  [/役所|公務員|職員|事務|検査|看守|審判/, 'clipboard'], [/宇宙|団長|探検/, 'flag'],
];
function propOf(m) {
  if (PROPS[m.prop]) return m.prop;
  const hit = PROP_GUESS.find(([re]) => re.test(m.job || ''));
  return hit ? hit[1] : null;
}
const BUILTIN_PEOPLE = [
  { income: '720万円', job: '歯科技工士', hobby: '盆栽', skill: '10km先の匂いを嗅ぎ分ける', weak: '静電気が怖い', ath: 2, prop: 'wrench' },
  { income: '0円', job: '家出中の大学生', hobby: '天体観測', skill: '素手で鉄格子を曲げる', weak: '早起きできない', ath: 4, prop: 'book' },
  { income: '4億円', job: '不動産王', hobby: 'セミの抜け殻集め', skill: 'どんな鍵も針金で開ける', weak: '方向音痴', ath: 1, prop: 'briefcase' },
  { income: '310万円', job: '遊覧船の船長', hobby: 'フェンシング', skill: '動物の言葉が分かる', weak: '暗い所が苦手', ath: 4, prop: 'wheel' },
  { income: '950万円', job: '魚市場の競り人', hobby: '着ぐるみ集め', skill: '水中で10分息が続く', weak: 'ウソがつけない', ath: 3, prop: 'hammer' },
  { income: '180万円', job: '駄菓子屋の店主', hobby: '競技ドローン', skill: '人の声を完璧にまねる', weak: '虫が大の苦手', ath: 2, prop: 'money' },
  { income: '2800万円', job: '演歌歌手', hobby: 'プログラミング', skill: '3日間寝なくても平気', weak: '高い所が苦手', ath: 2, prop: 'mic' },
  { income: '430万円', job: '山岳救助隊員', hobby: '腹話術', skill: '壁を素手で垂直に登る', weak: 'くじ運が最悪', ath: 4, prop: 'medkit' },
  { income: '70万円', job: '路上の似顔絵描き', hobby: '重量挙げ', skill: '嘘を一瞬で見抜く', weak: '時間を守れない', ath: 5, prop: 'brush' },
  { income: '1300万円', job: 'ソムリエ', hobby: 'ロデオ', skill: 'どんな機械も直せる', weak: '秘密をしゃべってしまう', ath: 4, prop: 'bottle' },
  { income: '260万円', job: '図書館の警備員', hobby: 'ボードゲーム', skill: '火の中でも熱くない', weak: '犬が怖い', ath: 3, prop: 'key' },
  { income: '5000万円', job: '通販番組の司会者', hobby: '洞窟探検', skill: '誰とでも10分で親友', weak: '狭い所で固まる', ath: 3, prop: 'mic' },
  { income: '390万円', job: '養蜂家', hobby: 'ストリートダンス', skill: '1km先の的に石を当てる', weak: '甘い物の誘惑に負ける', ath: 3, prop: 'flower' },
  { income: '8億円', job: '石油会社の跡取り', hobby: '昆虫食', skill: '気配を完全に消す', weak: 'お金で解決したがる', ath: 1, prop: 'briefcase' },
  { income: '550万円', job: '葬儀屋', hobby: 'お笑いライブ通い', skill: '車を片手で持ち上げる', weak: '笑いをこらえられない', ath: 2, prop: 'flower' },
  { income: '200万円', job: 'ピザの配達員', hobby: '古文書の解読', skill: '高所から落ちても無傷', weak: '泳げない', ath: 5, prop: 'pizza' },
  { income: '1億円', job: 'プロ雀士', hobby: 'ロッククライミング', skill: 'ウソ泣きで同情させる', weak: '乗り物酔いする', ath: 4, prop: 'money' },
  { income: '340万円', job: '灯台守', hobby: 'ベリーダンス', skill: '雷の落ちる場所を予知', weak: '人混みが苦手', ath: 2, prop: 'lantern' },
  { income: '880万円', job: '鍵屋', hobby: 'オペラ鑑賞', skill: '2日間まばたきしない', weak: '押しに弱い', ath: 3, prop: 'key' },
  { income: '1200万円', job: '宇宙飛行士', hobby: '編み物', skill: 'くじで必ず1等を引く', weak: '寒さに極端に弱い', ath: 4, prop: 'flag' },
  { income: '330万円', job: '着ぐるみの中の人', hobby: '激辛料理めぐり', skill: '一度見た地図を全部覚える', weak: '怒ると声が裏返る', ath: 3, prop: 'flag' },
  { income: '1100万円', job: 'くじ売り場の店員', hobby: 'サーフィン', skill: '相手の次の一手が読める', weak: '雷の音で腰が抜ける', ath: 2, prop: 'money' },
  { income: '600万円', job: 'マグロの一本釣り漁師', hobby: '刺しゅう', skill: '指笛で鳥を呼び寄せる', weak: '早口で聞き取れない', ath: 4, prop: 'rod' },
  { income: '290万円', job: '人力車の車夫', hobby: '囲碁', skill: '偶然いつも現場に居合わせる', weak: '小銭を数え間違える', ath: 2, prop: 'wheel' },
  { income: '240万円', job: 'ハーブ農家', hobby: '格闘技観戦', skill: '絶対音感', weak: '嘘をつくと鼻が動く', ath: 3, prop: 'shovel' },
  { income: '480万円', job: 'カジノのディーラー', hobby: '廃墟めぐり', skill: '握手で体重を当てる', weak: '驚くとしゃっくりが出る', ath: 2, prop: 'money' },
  { income: '350万円', job: 'かつら職人', hobby: '将棋', skill: 'どんな料理も一口で再現', weak: '決断に3時間かかる', ath: 3, prop: 'scissors' },
  { income: '700万円', job: '考古学者', hobby: '社交ダンス', skill: '赤ちゃんを一瞬で泣き止ませる', weak: '寝言が大きい', ath: 3, prop: 'magnifier' },
  { income: '900万円', job: 'ゲームのバグ探し係', hobby: '和太鼓', skill: '落とし物を必ず見つける', weak: '電話が鳴ると隠れる', ath: 2, prop: 'laptop' },
  { income: '380万円', job: '迷路づくりの庭師', hobby: 'アイドルの追っかけ', skill: '7か国語を話せる', weak: '高級品を見ると震える', ath: 4, prop: 'shovel' },
  { income: '520万円', job: 'ペット専門の探偵', hobby: 'ケーキ作り', skill: '寝ている間も耳が聞こえる', weak: 'じゃんけんが弱い', ath: 3, prop: 'magnifier' },
  { income: '1500万円', job: 'オーケストラ指揮者', hobby: '釣り', skill: '指一本で逆立ちできる', weak: '人の顔を覚えられない', ath: 5, prop: 'baton' },
  { income: '800万円', job: '花火師', hobby: '落語鑑賞', skill: 'どんな犬にもなつかれる', weak: '何もない所で転ぶ', ath: 1, prop: 'flask' },
  { income: '410万円', job: '伝書バト使い', hobby: 'ヨガ', skill: '声だけで人を眠らせる', weak: '夜9時に眠くなる', ath: 3, prop: 'letter' },
  { income: '460万円', job: '看守', hobby: '押し花', skill: '300人の名前を一度で覚える', weak: '涙もろい', ath: 4, prop: 'clipboard' },
  { income: '3000万円', job: 'プロゲーマー', hobby: '薪割り', skill: '投げた物が狙い通り入る', weak: 'すぐ道草を食う', ath: 2, prop: 'laptop' },
  { income: '1800万円', job: '飛行船の操縦士', hobby: '盆踊り', skill: '一瞬で変装できる', weak: 'お化けが怖い', ath: 3, prop: 'wheel' },
  { income: '420万円', job: '食品サンプル職人', hobby: 'スカイダイビング', skill: '暗算で株価を当てる', weak: 'くすぐりに弱い', ath: 4, prop: 'pan' },
  { income: '280万円', job: '利き水師', hobby: '鉄道の時刻表', skill: '他人の夢に入り込める', weak: '寝坊の常習犯', ath: 2, prop: 'cup' },
  { income: '1000万円', job: '競馬の実況アナ', hobby: 'ジャグリング', skill: '数秒先の未来が見える', weak: '緊張でお腹が鳴る', ath: 3, prop: 'mic' },
  { income: '450万円', job: '心霊写真の鑑定士', hobby: '筋トレ', skill: 'どこでも3秒で眠れる', weak: '甘い言葉にだまされる', ath: 5, prop: 'camera' },
  { income: '2000万円', job: '幽霊ホテルの支配人', hobby: '野鳥観察', skill: '金属探知機より鋭い勘', weak: 'すぐ顔に出る', ath: 2, prop: 'key' },
  { income: '500万円', job: 'からくり人形師', hobby: '詩吟', skill: '触るだけで物の値段が分かる', weak: 'ジェットコースターが苦手', ath: 4, prop: 'hammer' },
  { income: '470万円', job: '移動動物園の運転手', hobby: '茶道', skill: '影のように後をつける', weak: '辛い物で気絶する', ath: 3, prop: 'wheel' },
  { income: '440万円', job: '南極観測隊の医師', hobby: 'バンジージャンプ', skill: 'サイコロの目を操る', weak: 'くしゃみが大きい', ath: 3, prop: 'medkit' },
  { income: '650万円', job: '巨大書道パフォーマー', hobby: 'ラップバトル', skill: '爆音の中でも会話できる', weak: 'カエルが大の苦手', ath: 2, prop: 'brush' },
  { income: '530万円', job: '忍者屋敷の受付', hobby: 'ジオラマ作り', skill: '一度聞いた曲を全部弾ける', weak: '判子がないと動けない', ath: 2, prop: 'clipboard' },
  { income: '230万円', job: '高層ビルの窓ふき', hobby: 'チェス', skill: 'どんな結び目もほどける', weak: '音楽が鳴ると踊り出す', ath: 4, prop: 'broom' },
  { income: '750万円', job: 'ワニの歯みがき係', hobby: 'カラオケ', skill: '相手を一瞬で笑わせる', weak: '機械オンチ', ath: 3, prop: 'medkit' },
  { income: '3500万円', job: 'サーカスの団長', hobby: '家庭菜園', skill: '物理の難問を即答', weak: 'ハトが苦手', ath: 3, prop: 'flag' },
  { income: '620万円', job: 'てるてる坊主職人', hobby: 'ボクシング', skill: '目隠しで料理を作れる', weak: '傘をすぐなくす', ath: 4, prop: 'scissors' },
  { income: '580万円', job: '占いの館の主', hobby: '金魚すくい', skill: 'ことわざを全部言える', weak: '締め切りを忘れる', ath: 2, prop: 'book' },
  { income: '900万円', job: '落語家', hobby: '熱気球', skill: '電卓より速く計算できる', weak: '長い話を聞けない', ath: 1, prop: 'mic' },
  { income: '0円', job: '王族の末っ子', hobby: 'ゴミ拾い', skill: '唇の動きで会話を読む', weak: '自分で着替えられない', ath: 2, prop: 'crown' },
  { income: '4000万円', job: 'レーサー', hobby: '俳句', skill: '猛獣を手なずける', weak: '待つのが大嫌い', ath: 5, prop: 'wheel' },
  { income: '600万円', job: '駅弁の売り子', hobby: 'パラグライダー', skill: '時計なしで時刻が分かる', weak: '雨の日に力が出ない', ath: 3, prop: 'pan' },
  { income: '420万円', job: 'エアギター講師', hobby: '手芸', skill: '相手の利き手を見抜く', weak: '声が大きすぎる', ath: 5, prop: 'guitar' },
  { income: '6000万円', job: '石油王の執事', hobby: '昆虫採集', skill: 'どんな言語もまねできる', weak: '人前で緊張する', ath: 2, prop: 'briefcase' },
  { income: '210万円', job: 'ゲームセンター店員', hobby: '写経', skill: '投げ縄の名人', weak: '光るものに飛びつく', ath: 4, prop: 'phone' },
  { income: '390万円', job: '屋台のたい焼き屋', hobby: 'スキューバ', skill: '誰の筆跡もまねできる', weak: '湯気でメガネが曇る', ath: 3, prop: 'pan' },
  { income: '300万円', job: 'ゴミ屋敷の片付け屋', hobby: '鉄道模型', skill: '見た顔は一生忘れない', weak: 'ボタンを押したくなる', ath: 2, prop: 'broom' },
];
function hashStr(t) { let h = 2166136261; for (const c of t) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; }
// 白フチ付きの棒人間（アイコンと同じ描き方）。ポーズと頭の飾りは日替わり、手には職業の小物
function stickSVG(seed, prop) {
  const r = seeded(seed);
  const POSES = [
    { h: [52, 30], n: [54, 48], hip: [58, 92], le: [36, 62], lh: [22, 50], re: [74, 66], rh: [86, 52], lk: [44, 118], lf: [34, 146], rk: [72, 116], rf: [84, 146] }, // 構え
    { h: [48, 30], n: [52, 48], hip: [60, 90], le: [34, 56], lh: [18, 40], re: [72, 70], rh: [64, 86], lk: [40, 112], lf: [22, 140], rk: [78, 116], rf: [96, 144] }, // 走り
    { h: [54, 28], n: [56, 46], hip: [58, 92], le: [40, 66], lh: [50, 82], re: [74, 66], rh: [64, 82], lk: [48, 120], lf: [44, 148], rk: [68, 120], rf: [76, 148] }, // 腕組み
    { h: [50, 32], n: [54, 50], hip: [60, 94], le: [34, 50], lh: [24, 28], re: [76, 60], rh: [92, 46], lk: [46, 120], lf: [40, 148], rk: [74, 118], rf: [90, 140] }, // 指さし
    { h: [56, 40], n: [56, 58], hip: [62, 98], le: [38, 70], lh: [26, 60], re: [78, 74], rh: [90, 66], lk: [40, 112], lf: [30, 148], rk: [84, 118], rf: [92, 148] }, // 低い構え
  ];
  const P = POSES[Math.floor(r() * POSES.length)];
  const acc = ['band', 'glasses', 'cap', 'scarf', 'none'][Math.floor(r() * 5)];
  const lines = [[P.n, P.hip], [P.n, P.le, P.lh], [P.n, P.re, P.rh], [P.hip, P.lk, P.lf], [P.hip, P.rk, P.rf]]
    .map((pts) => `M${pts.map((q) => q.join(',')).join(' L')}`).join(' ');
  const [hx, hy] = P.h;
  let extra = '';
  if (acc === 'band') extra = `<path d="M${hx - 15},${hy - 6} L${hx + 15},${hy - 6}" stroke="#E63322" stroke-width="6"/><path d="M${hx + 14},${hy - 6} q14,-6 22,2 M${hx + 14},${hy - 4} q12,4 18,12" stroke="#E63322" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  if (acc === 'glasses') extra = `<circle cx="${hx - 9}" cy="${hy + 1}" r="5" fill="#111" stroke="#fff" stroke-width="2"/><circle cx="${hx + 3}" cy="${hy + 1}" r="5" fill="#111" stroke="#fff" stroke-width="2"/>`;
  if (acc === 'cap') extra = `<path d="M${hx - 16},${hy - 2} A16,16 0 0 1 ${hx + 16},${hy - 2} Z" fill="#3EA8FF"/><path d="M${hx - 16},${hy - 4} L${hx - 30},${hy - 1}" stroke="#3EA8FF" stroke-width="5" stroke-linecap="round"/>`;
  if (acc === 'scarf') extra = `<path d="M${P.n[0]},${P.n[1]} q20,-2 34,-12 M${P.n[0]},${P.n[1] + 2} q18,6 30,4" stroke="#E63322" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  const eye = acc === 'glasses' ? '' : `<path d="M${hx - 13},${hy + 1} l9,2 l-8,2 z" fill="#fff"/>`;
  const [px, py] = P.rh;
  const held = PROPS[prop] ? `<g transform="translate(${px},${py})" filter="url(#propEdge)" stroke-linecap="round">${PROPS[prop][1]}</g>` : '';
  return `<svg viewBox="-10 -10 130 180" class="stick" aria-hidden="true">
    <defs><filter id="propEdge" x="-40%" y="-40%" width="180%" height="180%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="d"/><feFlood flood-color="#fff"/><feComposite in2="d" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="${lines}" stroke="#fff" stroke-width="15"/><circle cx="${hx}" cy="${hy}" r="18" fill="#fff"/>
      <path d="${lines}" stroke="#111" stroke-width="9"/><circle cx="${hx}" cy="${hy}" r="15" fill="#111"/>
    </g>${extra}${eye}${held}</svg>`;
}
function todaysExtremer() {
  const seen = new Map();
  loadLogs().forEach((g) => (g.teams || []).flat().forEach((m) => m?.job && seen.set(m.job, m)));
  BUILTIN_PEOPLE.forEach((m) => seen.has(m.job) || seen.set(m.job, m));
  const pool = [...seen.values()];
  const d = new Date(), key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const h = hashStr(key);
  return { m: pool[h % pool.length], seed: h };
}
function renderToday() {
  const box = $('#todayBox'); if (!box) return;
  const { m, seed } = todaysExtremer();
  box.innerHTML = `<p class="kicker">今日のエクストリーマー</p>
    <div class="todayRow">${stickSVG(seed, propOf(m))}<div class="prof todayProf">${cardHTML(m)}</div></div>`;
}

/* ---------- 画面のつなぎ ---------- */
function openSettings() {
  $('#apiKey').value = store.key;
  $('#model').value = store.model;
  $('#dailyLimit').value = quota.limit(store.model);
  $('#bgmVol').value = Math.round(Sound.bgm * 100);
  $('#sfxVol').value = Math.round(Sound.sfxVol * 100);
  show('settings');
}
$('#model').onchange = () => { $('#dailyLimit').value = quota.limit($('#model').value); };
document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => startGame(b.dataset.start)));
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { refreshKeyNote(); show(b.dataset.go); }));
$('#openSettings').onclick = openSettings;
$('#openLogs').onclick = showLogs;
$('#backToLogs').onclick = showLogs;
$('#saveSettings').onclick = () => {
  store.key = $('#apiKey').value.trim();
  store.model = $('#model').value;
  const lim = Math.floor(+$('#dailyLimit').value);
  if (lim > 0) quota.setLimit(store.model, lim);
  refreshKeyNote(); toast('保存しました'); show('home');
};
$('#retryBtn').onclick = () => retryFn && retryFn();
$('#miniStart').onclick = miniStart;
$('#beginBtn').onclick = firstStage;
$('#againBtn').onclick = () => startGame(S.mode);
$('#bgmVol').oninput = (e) => Sound.setVol('bgm', e.target.value / 100);
$('#sfxVol').oninput = (e) => { Sound.setVol('sfx', e.target.value / 100); Sound.sfx('click'); };
function paintMute() {
  const b = $('#muteBtn');
  b.classList.toggle('off', !Sound.on);
  b.setAttribute('aria-label', Sound.on ? '音をオフにする' : '音をオンにする');
  b.setAttribute('aria-pressed', String(!Sound.on));
}
$('#muteBtn').onclick = () => { Sound.toggle(); paintMute(); };
paintMute();
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !['rollBtn', 'muteBtn'].includes(b.id) && !b.classList.contains('target')) Sound.sfx('click');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuota(); });
refreshKeyNote();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
