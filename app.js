'use strict';
/* エクストリーマーズ — 4人チームで究極の課題に挑む対戦ゲーム */

const $ = (s) => document.querySelector(s);
const ROUNDS = 4, PICK_MS = 3000, STAGES = 3, STAGE_WEIGHT = [1, 1, 2];
const TASK_TYPES = ['潜入する', '守り抜く', '騒ぎを起こす', '作り上げる', '逃げ切る', '壊す', '勝負に勝つ', '救出する', '説得する', '盗み出す', '隠し通す', '運ぶ'];
const APT_W = { fit: 6, stretch: 3, none: 1 };
const APT_RATE = { fit: 80, stretch: 50, none: 20 };
const OUT_CHANCE = 30;

let S = null;          // ゲーム状態
let retryFn = null;    // エラー時の再実行
let timerId = null;

/* ---------- 共通 ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === id));
  window.scrollTo(0, 0);
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
function loading(text) { $('#loadingText').textContent = text; show('loading'); }
function fail(err, again) {
  $('#errorText').textContent = err.message || String(err);
  retryFn = again; show('error');
}

/* ---------- 設定 ---------- */
const store = {
  get key() { try { return localStorage.getItem('ext_gkey') || ''; } catch { return ''; } },
  set key(v) { try { localStorage.setItem('ext_gkey', v); } catch {} },
  get model() { try { return localStorage.getItem('ext_gmodel') || 'gemini-3.5-flash'; } catch { return 'gemini-3.5-flash'; } },
  set model(v) { try { localStorage.setItem('ext_gmodel', v); } catch {} },
};
function refreshKeyNote() {
  $('#keyNote').textContent = store.key ? '' : 'はじめに「設定」でGemini APIキー（無料）を入れてください。';
}

/* ---------- Gemini API（無料枠） ---------- */
async function ask(system, user, maxTokens = 4000) {
  if (!store.key) throw new Error('APIキーが未設定です。タイトルの「設定」から入れてください。');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(store.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': store.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: Math.max(maxTokens * 3, 16000), temperature: 1 },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 429) throw new Error('無料枠の回数上限に達しました。少し時間をおくか、設定で別のモデルに切り替えてください（1日の上限は日本時間の夕方ごろにリセットされます）。');
    if (res.status === 400 || res.status === 403) throw new Error(`APIキーかモデルの設定を確認してください（${res.status}）：${t.slice(0, 200)}`);
    throw new Error(`API エラー（${res.status}）：${t.slice(0, 300)}`);
  }
  const j = await res.json();
  const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => (p.thought ? '' : p.text || '')).join('');
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('AIの返答を読み取れませんでした。');
  return JSON.parse(txt.slice(a, b + 1));
}

const GM = 'あなたは対戦ゲーム「エクストリーマーズ」のゲームマスターです。出力は必ずJSONオブジェクトだけにし、前後に説明やコードブロックを付けません。日本語で書きます。描写はコミカルにし、残酷・グロテスクな描写や、現実で真似できる危険行為の具体的な手順は書きません。';

function setupPrompt(type) {
  return `ゲームの準備をしてください。

【人物】2人のプレイヤーに、4巡ぶん、毎巡5人ずつの候補を作ります（合計40人）。
- 全員別人。職業は40人で重複させない
- 職業・趣味・特技の3つは互いに無関係にする。「趣味の延長の特技」「職業の延長の特技」「職業の延長の趣味」は禁止。ただし40人中4人ほどだけ、どれか1組が関連していてよい
- 特技は超人的な体の能力ばかりにしない。運、知識、対人、感覚、変わった才能なども混ぜ、毎回バリエーションを変える。15字前後
- 趣味もありきたりなものに偏らせない
- 年収は0円から数億円までばらつかせ、「720万円」「4億円」のように書く
- 運動神経 ath は1〜5の整数。偏らせない
- 実在の人物、有名キャラクター、子どもは使わない

【究極の課題】タイプ「${type}」の究極の課題を1文で作ります。人物の能力は考えずに作り、スケールが大きく、ばかばかしく、2チームが同時に挑めるものにします。具体的な実行手順は書きません。

出力形式：
{"task":"課題の1文","players":[ [ [人物×5], [人物×5], [人物×5], [人物×5] ], [ 同じく4巡ぶん ] ]}
人物：{"income":"720万円","job":"職業","hobby":"趣味","skill":"特技","ath":3}`;
}

function teamText() {
  return [0, 1].map((p) => {
    const tag = p === 0 ? 'A' : 'B';
    const lines = S.teams[p].map((m) =>
      `${m.id}：${m.job}｜年収${m.income}｜趣味：${m.hobby}｜特技：${m.skill}｜運動神経${m.ath}${m.out ? '｜※退場済み' : ''}`).join('\n');
    return `チーム${tag}（${S.names[p]}）\n${lines}`;
  }).join('\n\n');
}
function historyText() {
  return S.history.length ? S.history.map((h, i) => `第${i + 1}関門：${h}`).join('\n') : 'まだなし';
}
const STAGE_SPEC = (n) => `第${n}関門（全${STAGES}関門。第${STAGES}関門が最終関門）の場面を作ります。両チームが同じ場面に挑みます。
- scene：場面の説明2〜3文。これまでの流れを引き継ぐ
- options：対処の「方針」を4つ。label は12字以内、detail は35字以内。誰がやるかは書かない。「正面突破」「だます」「味方に引き込む」「力でねじ伏せる」「避けて回り道」など、方針そのものが違うものにする
- 各 option に、退場していない全メンバーID（A1〜A4、B1〜B4）について、その方針を実行するときの適性 apt を付ける。fit＝特技がぴったり、stretch＝特技・趣味・職業のどれかをこじつけて使える、none＝無関係。1つの方針でfitは多くても2人まで
- physical：その方針が主に体を使うなら true`;
const OPT_SCHEMA = '{"scene":"…","options":[{"label":"…","detail":"…","apt":{"A1":"fit","A2":"none",…},"physical":false}, …4つ]}';

/* ---------- ゲーム開始・ドラフト ---------- */
function startGame(mode) {
  if (!store.key) { toast('先にAPIキーを設定してください'); openSettings(); return; }
  S = {
    mode, names: mode === 'cpu' ? ['あなた', 'CPU'] : ['プレイヤー1', 'プレイヤー2'],
    pools: null, task: '', teams: [[], []], round: 0, turn: 0,
    stage: 0, scores: [0, 0], wins: [[], []], history: [], scene: null, choice: [null, null], last: null,
  };
  doSetup();
}
async function doSetup() {
  loading('人物と究極の課題を用意しています…');
  try {
    const type = TASK_TYPES[rnd(TASK_TYPES.length) - 1];
    const d = await ask(GM, setupPrompt(type), 7000);
    if (!d.players || d.players.length < 2) throw new Error('人物データが足りません。');
    S.pools = d.players; S.task = d.task;
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
    S.mode === '2p' ? '相手に見えないように受け取ってください。押すと3秒のカウントが始まります。' : '押すと3秒のカウントが始まります。',
    showDraft);
}
function handoff(kicker, title, note, next) {
  $('#handoffKicker').textContent = kicker;
  $('#handoffTitle').textContent = title;
  $('#handoffNote').textContent = note;
  $('#handoffBtn').onclick = next;
  show('handoff');
}
function cardHTML(m) {
  return `<span class="income">${esc(m.income)}</span><div class="job">${esc(m.job)}</div>
  <dl><dt>趣味</dt><dd>${esc(m.hobby)}</dd><dt>特技</dt><dd>${esc(m.skill)}</dd>
  <dt>運動神経</dt><dd class="stars">${stars(Math.max(1, Math.min(5, +m.ath || 3)))}</dd></dl>`;
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
  const tick = (now) => {
    const left = Math.max(0, 1 - (now - t0) / PICK_MS);
    bar.style.transform = `scaleX(${left})`;
    if (left < 0.34) bar.classList.add('warn');
    if (left <= 0) return choose(cands[rnd(cands.length) - 1], true);
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
function teamsHTML() {
  return [0, 1].map((p) => `<div class="team ${p ? 'b' : 'a'}"><h3>${p ? '🟦' : '🟥'} ${esc(S.names[p])}</h3>${
    S.teams[p].map((m) => `<div class="member ${m.out ? 'out' : ''}"><b>${esc(m.job)}</b>（${esc(m.income)}）<br>趣味：${esc(m.hobby)}｜特技：${esc(m.skill)}｜<span class="stars">${stars(m.ath)}</span></div>`).join('')
  }</div>`).join('');
}
function showReveal() {
  $('#teamsBox').innerHTML = teamsHTML();
  $('#taskText').textContent = S.task;
  show('reveal');
}

/* ---------- 関門 ---------- */
async function firstStage() {
  loading('第1関門を準備しています…');
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
    $('#stageWho').textContent = `${S.names[p]}の作戦は？`;
    const box = $('#optionsBox'); box.innerHTML = '';
    S.scene.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'btn option';
      b.innerHTML = `<b>${esc(o.label)}</b><span>${esc(o.detail)}</span>`;
      b.onclick = () => { S.choice[p] = i; chooseFor(p + 1); };
      box.appendChild(b);
    });
    show('stage');
  };
  if (S.mode === '2p') handoff(S.stage === STAGES - 1 ? '最終関門' : `第${S.stage + 1}関門`, `${S.names[p]}の番`, '相手に見えないように受け取ってください。', render);
  else render();
}
function active(p) { return S.teams[p].filter((m) => !m.out); }
function cpuChoice(p) { // 自チームの適性が高い方針を少し選びやすく
  const opts = S.scene.options.map((o, i) => ({ i, w: 1 + active(p).reduce((t, m) => t + ({ fit: 3, stretch: 1, none: 0 }[o.apt?.[m.id]] ?? 0), 0) }));
  return pickWeighted(opts, (x) => x.w).i;
}
function resolveTeam(p) {
  const o = S.scene.options[S.choice[p]];
  const members = active(p);
  const aptOf = (m) => (APT_W[o.apt?.[m.id]] ? o.apt[m.id] : 'none');
  const ex = pickWeighted(members, (m) => APT_W[aptOf(m)]);
  const apt = aptOf(ex);
  let rate = APT_RATE[apt] + (o.physical ? (ex.ath - 3) * 10 : 0);
  rate = Math.max(5, Math.min(95, rate));
  const roll = rnd(100), ok = roll <= rate;
  let out = false, outRoll = null;
  if (!ok && S.stage < STAGES - 1 && members.length > 1) {
    outRoll = rnd(100); out = outRoll <= OUT_CHANCE;
    if (out) ex.out = true;
  }
  if (ok) { S.scores[p] += STAGE_WEIGHT[S.stage]; S.wins[p].push(S.stage); }
  return { p, label: o.label, detail: o.detail, ex, apt, rate, roll, ok, out };
}
function outcomeText(r) {
  const m = r.ex;
  return `チーム${r.p ? 'B' : 'A'}（${S.names[r.p]}）：方針「${r.label}」（${r.detail}）。実行したのは${m.id}の${m.job}（趣味：${m.hobby}／特技：${m.skill}／運動神経${m.ath}）。判定は【${r.ok ? '成功' : '失敗'}】${r.out ? '。失敗の結果、この人物は退場' : ''}。`;
}
function decideWinner() {
  if (S.scores[0] !== S.scores[1]) return { w: S.scores[0] > S.scores[1] ? 0 : 1, how: '得点' };
  const f0 = S.wins[0].includes(STAGES - 1), f1 = S.wins[1].includes(STAGES - 1);
  if (f0 !== f1) return { w: f0 ? 0 : 1, how: '最終関門' };
  const coin = rnd(2) - 1;
  return { w: coin, how: 'コイントス', coin };
}
async function resolveStage() {
  if (!S.last || S.last.stage !== S.stage) {
    S.last = { stage: S.stage, rs: [resolveTeam(0), resolveTeam(1)] };
    if (S.stage === STAGES - 1) S.last.win = decideWinner();
  }
  narrate();
}
async function narrate() {
  const { rs, win } = S.last;
  const final = S.stage === STAGES - 1;
  loading(final ? '決着を書いています…' : '結果を書いています…');
  const base = `究極の課題：${S.task}\n\n${teamText()}\n\nこれまで：\n${historyText()}\n\n今回の場面：${S.scene.scene}\n\n判定結果（サイコロで決定済み。成功と失敗を絶対に入れ替えない。忖度しない）：\n${outcomeText(rs[0])}\n${outcomeText(rs[1])}`;
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
  return `<div class="dice">実行：${esc(r.ex.job)}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${r.ok ? '成功' : '失敗'}</span>${r.out ? '｜⚠️退場' : ''}</div>`;
}
function scoreHTML() {
  return `<span>🟥 ${esc(S.names[0])} ${S.scores[0]}点</span><span>🟦 ${esc(S.names[1])} ${S.scores[1]}点</span>`;
}
function showResult(d) {
  const { rs, win } = S.last;
  const final = S.stage === STAGES - 1;
  $('#resultKicker').textContent = final ? '最終関門の結果' : `第${S.stage + 1}関門の結果`;
  $('#resultBox').innerHTML = rs.map((r) => `<div class="res ${r.p ? 'b' : 'a'}"><h3>${r.p ? '🟦' : '🟥'} ${esc(S.names[r.p])}：${esc(r.label)}</h3>${diceLine(r)}<p>${esc(r.p ? d.resultB : d.resultA)}</p></div>`).join('');
  $('#scoreBox').innerHTML = scoreHTML();
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
  const how = win.how === 'コイントス' ? '（同点・最終関門も互角のためコイントス）' : win.how === '最終関門' ? '（同点・最終関門の成否で決着）' : '';
  $('#winnerText').textContent = `🏆 ${S.names[win.w]}の勝ち！`;
  $('#epilogueText').textContent = `${epilogue || ''}${how ? '\n' + how : ''}`;
  $('#finalScore').innerHTML = scoreHTML();
  show('final');
}

/* ---------- 画面のつなぎ ---------- */
function openSettings() {
  $('#apiKey').value = store.key;
  $('#model').value = store.model;
  show('settings');
}
document.querySelectorAll('[data-start]').forEach((b) => (b.onclick = () => startGame(b.dataset.start)));
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { refreshKeyNote(); show(b.dataset.go); }));
$('#openSettings').onclick = openSettings;
$('#saveSettings').onclick = () => {
  store.key = $('#apiKey').value.trim();
  store.model = $('#model').value;
  refreshKeyNote(); toast('保存しました'); show('home');
};
$('#retryBtn').onclick = () => retryFn && retryFn();
$('#beginBtn').onclick = firstStage;
$('#againBtn').onclick = () => startGame(S.mode);
refreshKeyNote();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
