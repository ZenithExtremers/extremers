'use strict';
/* エクストリーマーズ — 4人チームで究極の課題に挑む対戦ゲーム */

const $ = (s) => document.querySelector(s);
const ROUNDS = 4, PICK_MS = 10000, STAGES = 3, STAGE_WEIGHT = [30, 30, 40];
// ハラハラ系を多めに（7割）。標的や組織はすべて架空
const TASK_HOT = ['架空の悪の大物を暗殺する', '命を狙われた要人を守り抜く', '難攻不落の監獄から脱獄する', '仕掛けられた巨大爆弾を止める', '悪の組織の金庫から奪い去る', '人質を救出する', '仲間に紛れた裏切り者を暴いて始末する', '敵の秘密兵器を破壊する', '凶悪な追っ手から逃げ切る', '黒幕の正体を突き止めて捕らえる'];
const TASK_MILD = ['潜入する', '騒ぎを起こす', '作り上げる', '勝負に勝つ', '説得する', '隠し通す', '運ぶ'];
// 対戦相手との駆け引き
const KIND = { normal: 'normal', sabotage: 'sabotage', coop: 'coop' };
const SABOTAGE_HIT = 25, SABOTAGE_COST = 10, COOP_BOTH = 20, BETRAY_BONUS = 10;
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
  const cand = j.candidates?.[0];
  if (!cand || cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT' || j.promptFeedback?.blockReason)
    throw new Error('AIが内容を出せませんでした（安全フィルター）。「もう一度」を押すと作り直します。');
  const txt = (cand.content?.parts || []).map((p) => (p.thought ? '' : p.text || '')).join('');
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
- 特技は超人的な体の能力ばかりにしない。運、知識、対人、感覚、変わった才能なども混ぜ、毎回バリエーションを変える
- 趣味もありきたりなものに偏らせない
- 文字数を必ず守る：職業は10字以内、趣味は10字以内、特技は14字以内。説明や補足、カッコ書きは付けない
- 年収は0円から数億円までばらつかせ、「720万円」「4億円」のように書く
- 運動神経 ath は1〜5の整数。偏らせない
- 実在の人物、有名キャラクター、子どもは使わない

【究極の課題】タイプ「${type}」のミッションを1文で作ります。
- 2チームが同じ舞台でライバルとして同時に挑み、先にやり遂げたほうが勝つ形にする
- 命がけの緊迫感があるハラハラするミッションにする。ユーモアは少しだけ
- 標的・組織・場所の名前はすべて架空にする。実在の人物・団体・事件は使わない
- 人物の能力は考えずに作る。具体的な実行手順や残酷な描写は書かない

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
const STAGE_SPEC = (n) => `第${n}関門（全${STAGES}関門。第${STAGES}関門が最終関門）の場面を作ります。
- 両チームは同じ場所にいて、互いの姿が見えるライバル同士。場面には必ず相手チームの存在や動きを絡める
- 関門の種類は毎回変える：追跡戦、乱戦、罠、謎解き、交渉、災害や崩落、裏切り、時間切れ寸前、標的との対決など。「警備や見張りをくぐり抜ける」場面は全3関門で多くても1回
- scene：場面の説明2〜3文。これまでの流れを引き継ぎ、緊迫感を出す
- options：対処の「方針」を4つ。label は12字以内、detail は35字以内。誰がやるかは書かない
  - kind "normal" を2つ：課題そのものに挑む方針。方針どうしは中身をはっきり変える（力ずく、だます、頭脳、回り道など）
  - kind "sabotage" を1つ：相手チームの邪魔をする方針
  - kind "coop" を1つ：相手チームに一時休戦・共闘を持ちかける方針
- 各 option に、退場していない全メンバーID（A1〜A4、B1〜B4）について、その方針を実行するときの適性 apt を付ける。fit＝特技がぴったり、stretch＝特技・趣味・職業のどれかをこじつけて使える、none＝無関係。1つの方針でfitは多くても2人まで
- physical：その方針が主に体を使うなら true`;
const OPT_SCHEMA = '{"scene":"…","options":[{"label":"…","detail":"…","kind":"normal","apt":{"A1":"fit","A2":"none",…},"physical":false}, …4つ]}';

/* ---------- ゲーム開始・ドラフト ---------- */
function startGame(mode) {
  if (!store.key) { toast('先にAPIキーを設定してください'); openSettings(); return; }
  S = {
    mode, names: mode === 'cpu' ? ['あなた', 'CPU'] : ['プレイヤー1', 'プレイヤー2'],
    pools: null, task: '', teams: [[], []], round: 0, turn: 0,
    stage: 0, scores: [0, 0], stagePts: [[], []], log: [], saved: false, history: [], scene: null, choice: [null, null], last: null,
  };
  doSetup();
}
async function doSetup() {
  loading('人物と究極の課題を用意しています…');
  try {
    const pool = rnd(10) <= 7 ? TASK_HOT : TASK_MILD;
    const type = pool[rnd(pool.length) - 1];
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
function cardHTML(m) {
  const ath = Math.max(1, Math.min(5, +m.ath || 3));
  return `<div class="profHead"><span class="job">${esc(m.job)}</span><span class="income">${esc(m.income)}</span></div>
  <div class="prow"><span class="lab">趣味</span><span class="val">${esc(m.hobby)}</span></div>
  <div class="prow"><span class="lab">特技</span><span class="val">${esc(m.skill)}</span></div>
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
function teamsHTML(G = S) {
  return [0, 1].map((p) => `<div class="team ${p ? 'b' : 'a'}"><h3>${p ? '🟦' : '🟥'} ${esc(G.names[p])}</h3>${
    G.teams[p].map((m) => `<div class="member prof ${m.out ? 'out' : ''}">${cardHTML(m)}</div>`).join('')
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
function cpuChoice(p) { // 自チームの適性が高い方針を少し選びやすく
  const opts = S.scene.options.map((o, i) => ({ i, w: 1 + active(p).reduce((t, m) => t + ({ fit: 3, stretch: 1, none: 0 }[o.apt?.[m.id]] ?? 0), 0) }));
  return pickWeighted(opts, (x) => x.w).i;
}
/* 実行する人と成功ラインを決める（サイコロはまだ振らない） */
function prepTeam(p) {
  const o = S.scene.options[S.choice[p]];
  const members = active(p);
  const aptOf = (m) => (APT_W[o.apt?.[m.id]] ? o.apt[m.id] : 'none');
  const ex = pickWeighted(members, (m) => APT_W[aptOf(m)]);
  const apt = aptOf(ex);
  const base = APT_RATE[apt] + (o.physical ? (ex.ath - 3) * 10 : 0);
  const mine = kindOf(p), theirs = kindOf(1 - p), mods = [];
  if (mine === KIND.sabotage) mods.push(['妨害に人手を割いた', -SABOTAGE_COST]);
  if (theirs === KIND.sabotage) mods.push(['相手チームの妨害', -SABOTAGE_HIT]);
  if (mine === KIND.coop && theirs === KIND.coop) mods.push(['共闘成立', +COOP_BOTH]);
  if (mine === KIND.sabotage && theirs === KIND.coop) mods.push(['共闘の申し出を逆手に取った', +BETRAY_BONUS]);
  if (mine === KIND.coop && theirs === KIND.normal) mods.push(['共闘を断られた', 0]);
  const rate = Math.max(5, Math.min(95, base + mods.reduce((t, m) => t + m[1], 0)));
  return { p, label: o.label, detail: o.detail, kind: mine, ex, apt, base, mods, rate, canOut: S.stage < STAGES - 1 && members.length > 1 };
}
/* 出た目から成否と得点を決める。成功は配点の60〜100%、失敗は0〜30%（惜しいほど多い） */
function finishTeam(r, roll) {
  const w = STAGE_WEIGHT[S.stage];
  r.roll = roll; r.ok = roll <= r.rate;
  r.pts = r.ok
    ? Math.round(w * (0.6 + 0.4 * (r.rate - roll + 1) / r.rate))
    : Math.round(w * 0.3 * (1 - (roll - r.rate - 1) / Math.max(1, 100 - r.rate)));
  r.out = false;
  if (!r.ok && r.canOut && rnd(100) <= OUT_CHANCE) { r.out = true; r.ex.out = true; }
  const margin = Math.abs(roll - r.rate);
  r.grade = r.ok ? (margin >= 40 ? '大成功' : margin <= 8 ? 'ギリギリ成功' : '成功') : (margin <= 8 ? '惜しくも失敗' : margin >= 40 ? '大失敗' : '失敗');
  S.scores[r.p] += r.pts; S.stagePts[r.p][S.stage] = r.pts;
  return r;
}
function outcomeText(r) {
  const m = r.ex;
  const inter = r.mods.length ? `相手との駆け引き：${r.mods.map((x) => x[0]).join('、')}。` : '';
  return `チーム${r.p ? 'B' : 'A'}（${S.names[r.p]}）：方針「${r.label}」（${r.detail}、種類：${{ normal: '課題に挑む', sabotage: '相手を妨害', coop: '相手に共闘を持ちかける' }[r.kind]}）。${inter}実行したのは${m.id}の${m.job}（趣味：${m.hobby}／特技：${m.skill}／運動神経${m.ath}）。判定は【${r.grade}】${r.out ? '。失敗の結果、この人物は退場' : ''}。`;
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
    $('#rollWho').innerHTML = `<p class="note" style="margin:0 0 6px">実行するのは…</p>${cardHTML(m)}`;
    $('#rollLine').textContent = `${r.rate}以下で成功`;
    $('#rollMods').innerHTML = r.mods.map(([t, v]) => `<span>${esc(t)}${v ? `（${v > 0 ? '+' : '−'}${Math.abs(v)}）` : ''}</span>`).join('');
    const face = $('#dieFace'), verdict = $('#rollVerdict'), btn = $('#rollBtn');
    face.textContent = '?'; face.classList.remove('spin'); verdict.textContent = ''; verdict.className = 'rollVerdict';
    let rolled = false;
    const doRoll = () => {
      if (rolled) return; rolled = true;
      btn.disabled = true; btn.textContent = '…';
      face.classList.add('spin');
      const iv = setInterval(() => { face.textContent = rnd(100); }, 60);
      setTimeout(() => {
        clearInterval(iv); face.classList.remove('spin');
        const roll = rnd(100);
        finishTeam(r, roll);
        face.textContent = roll;
        verdict.textContent = `${r.grade}！ +${r.pts}点${r.out ? '（⚠️退場）' : ''}`;
        verdict.classList.add(r.ok ? 'ok' : 'ng');
        btn.disabled = false; btn.textContent = '次へ';
        btn.onclick = () => rollFor(p + 1);
        if (isCpu(p)) setTimeout(() => rollFor(p + 1), 1600);
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
  loading(final ? '決着を書いています…' : '結果を書いています…');
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
  return `<div class="dice">実行：${esc(r.ex.job)}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${r.grade}</span> +${r.pts}点${r.out ? '｜⚠️退場' : ''}</div>`;
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
    rs: rs.map((r) => ({ p: r.p, label: r.label, job: r.ex.job, roll: r.roll, rate: r.rate, grade: r.grade, ok: r.ok, pts: r.pts, out: r.out, text: r.p ? d.resultB : d.resultA })),
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
      teams: S.teams.map((t) => t.map((m) => ({ job: m.job, income: m.income, hobby: m.hobby, skill: m.skill, ath: m.ath, out: m.out }))),
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
      <div class="dice">実行：${esc(r.job)}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${esc(r.grade)}</span> +${r.pts}点${r.out ? '｜⚠️退場' : ''}</div><p>${esc(r.text)}</p></div>`).join('')}` : '').join('')}
    ${g.epilogue ? `<p class="kicker">決着</p><p class="scene">${esc(g.epilogue)}</p>` : ''}`;
  show('logView');
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
$('#openLogs').onclick = showLogs;
$('#backToLogs').onclick = showLogs;
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
