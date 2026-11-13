'use strict';
/* エクストリーマーズ — オンライン対戦（Firebase：匿名ログイン＋Firestore）・ランキング・フレンド・人物図鑑
   進め方：ルームを作った人（ホスト）の端末が対戦を進め、Gemini もホストのキーで呼ぶ。
   参加者（ゲスト）は画面に表示する内容だけを受け取り、選択やサイコロの操作だけを送る。 */

const FB_VER = '12.19.0';
const FB_BASE = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
const ONLINE_MS = 3 * 60 * 1000;            // 最終アクセスがこれ以内なら「オンライン」
const INVITE_MS = 15 * 60 * 1000;           // 招待の有効期限
const T_CHOOSE = 60000, T_ROLL = 25000, T_READY = 90000, PICK_GRACE = 2500, STALE_MS = 150000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = (n) => Array.from({ length: n }, () => CODE_CHARS[rnd(CODE_CHARS.length) - 1]).join('');

/* ---------- 人物図鑑（この端末に保存。ログイン中はクラウドにも保存） ---------- */
const DEX_KEY = 'ext_dex', DEX_MAX = 2500;
const Dex = {
  load() { try { return JSON.parse(localStorage.getItem(DEX_KEY) || '{}'); } catch { return {}; } },
  save(d) { try { localStorage.setItem(DEX_KEY, JSON.stringify(d)); } catch {} },
  key(m) { return hashStr(`${m.job}|${m.skill}`).toString(36); },
  clean(m) {
    return { job: String(m.job || ''), income: String(m.income || ''), hobby: String(m.hobby || ''), skill: String(m.skill || ''),
      weak: String(m.weak || ''), ath: Math.max(1, Math.min(5, +m.ath || 3)), prop: String(m.prop || '') };
  },
  // seen：見かけた人（候補・相手チーム）、picked：仲間にした人、wonPicked：勝ったチームの人
  record({ seen = [], picked = [], wonPicked = [] }) {
    const d = this.load(), now = Date.now();
    const ok = (m) => m && m.job && m.weak !== '？？？';
    const uniq = (arr) => [...new Map(arr.filter(ok).map((m) => [this.key(m), m])).values()];
    const touch = (m) => {
      const k = this.key(m);
      const e = d[k] || (d[k] = { m: this.clean(m), seen: 0, picked: 0, wins: 0, first: now });
      e.last = now; return e;
    };
    const won = new Set(wonPicked.filter(ok).map((m) => this.key(m)));
    uniq([...seen, ...picked]).forEach((m) => { touch(m).seen++; });
    uniq(picked).forEach((m) => { const e = touch(m); e.picked++; if (won.has(this.key(m))) e.wins++; });
    this.save(this.trim(d));
    cloudDexSave();
  },
  trim(d) {
    const ks = Object.keys(d);
    if (ks.length <= DEX_MAX) return d;
    ks.sort((a, b) => (d[b].last || 0) - (d[a].last || 0));
    return Object.fromEntries(ks.slice(0, DEX_MAX).map((k) => [k, d[k]]));
  },
  merge(a, b) {
    const o = { ...a };
    Object.entries(b || {}).forEach(([k, e]) => {
      if (!e || !e.m) return;
      const x = o[k];
      o[k] = x ? { m: x.m, seen: Math.max(x.seen, e.seen), picked: Math.max(x.picked, e.picked), wins: Math.max(x.wins, e.wins),
        first: Math.min(x.first || Infinity, e.first || Infinity), last: Math.max(x.last || 0, e.last || 0) } : e;
    });
    return this.trim(o);
  },
};

let dexFilter = 'all', dexSort = 'new', dexShown = 40;
function showDex() {
  dexShown = 40; renderDex(); show('dex');
}
function renderDex() {
  const d = Dex.load(), all = Object.values(d);
  const no = new Map([...all].sort((a, b) => (a.first || 0) - (b.first || 0)).map((e, i) => [e, i + 1])); // 図鑑番号＝登録順
  const picked = all.filter((e) => e.picked > 0).length;
  let list = all.filter((e) => dexFilter === 'all' || (dexFilter === 'picked' && e.picked > 0) || (dexFilter === 'win' && e.wins > 0));
  const by = { new: (e) => -(e.first || 0), picked: (e) => -(e.picked * 1000 + e.wins), win: (e) => -(e.wins * 1000 + e.picked) }[dexSort];
  list.sort((a, b) => by(a) - by(b));
  const chip = (k, v, label) => `<button class="chipBtn ${v === k ? 'on' : ''}" data-${label}="${k}">`;
  const box = $('#dexBody');
  box.innerHTML = `<div class="dexStat"><b>${all.length}</b><span>人を発見</span><b>${picked}</b><span>人を仲間にした</span></div>
    <p class="note">対戦で出会った人物が自動で登録されます（CPU戦・2人対戦・オンライン対戦すべて）。</p>
    <div class="chipRow">${chip('all', dexFilter, 'f')}すべて</button>${chip('picked', dexFilter, 'f')}仲間にした</button>${chip('win', dexFilter, 'f')}勝利に貢献</button></div>
    <div class="chipRow">${chip('new', dexSort, 's')}新しい順</button>${chip('picked', dexSort, 's')}仲間にした回数</button>${chip('win', dexSort, 's')}勝利数</button></div>
    ${list.length ? '' : '<p class="note">まだ登録されていません。対戦して人物を集めよう。</p>'}
    <div class="dexList">${list.slice(0, dexShown).map((e) => `<div class="dexCard ${e.picked ? 'got' : ''}">
        <div class="dexFig">${stickSVG(hashStr(e.m.job + e.m.skill), propOf(e.m))}<span class="dexNo">No.${no.get(e)}</span></div>
        <div class="prof">${cardHTML(e.m)}<div class="dexMeta">見かけた ${e.seen}回・仲間 ${e.picked}回・勝利 ${e.wins}回</div></div></div>`).join('')}</div>
    ${list.length > dexShown ? '<button class="btn" id="dexMore">もっと見る</button>' : ''}`;
  box.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { dexFilter = b.dataset.f; dexShown = 40; renderDex(); }));
  box.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { dexSort = b.dataset.s; dexShown = 40; renderDex(); }));
  const more = $('#dexMore'); if (more) more.onclick = () => { dexShown += 40; renderDex(); };
}

/* ---------- Firebase ---------- */
const Net = {
  p: null, ctx: null, profile: null,
  configured() { const c = window.FIREBASE_CONFIG; return !!(c && c.apiKey && c.projectId); },
  start() {
    if (!this.configured()) return Promise.reject(new Error('NOCONFIG'));
    return this.p || (this.p = this._start().catch((e) => { this.p = null; throw e; }));
  },
  async _start() {
    const [A, Au, F] = await Promise.all(['app', 'auth', 'firestore'].map((n) => import(`${FB_BASE}firebase-${n}.js`)));
    const cfg = window.FIREBASE_CONFIG;
    const app = A.getApps().length ? A.getApp() : A.initializeApp(cfg);
    const auth = Au.getAuth(app);
    const db = F.getFirestore(app);
    if (cfg.emulator) { // テスト用（ローカルのエミュレーター）
      Au.connectAuthEmulator(auth, `http://${cfg.emulator}:9099`, { disableWarnings: true });
      F.connectFirestoreEmulator(db, cfg.emulator, 8080);
    }
    await auth.authStateReady();
    if (!auth.currentUser) await Au.signInAnonymously(auth);
    this.ctx = { A, Au, F, app, auth, db, uid: auth.currentUser.uid };
    await this.loadProfile();
    this.touch();
    setInterval(() => { if (!document.hidden) this.touch(); }, 120000);
    watchInvites(); watchRequests(); cloudDexSync();
    return this.ctx;
  },
  async loadProfile() {
    const { F, uid } = this.ctx;
    const s = await F.getDoc(ref('users', uid));
    if (s.exists()) { this.profile = s.data(); return; }
    let code = randCode(6);
    for (let i = 0; i < 4; i++) {
      const q = await F.getDocs(F.query(col('users'), F.where('code', '==', code), F.limit(1)));
      if (q.empty) break;
      code = randCode(6);
    }
    const p = { name: localName(), code, wins: 0, losses: 0, games: 0, lastMatch: '', lastSeen: F.serverTimestamp(), createdAt: F.serverTimestamp() };
    await F.setDoc(ref('users', uid), p);
    this.profile = { ...p, lastSeen: null };
  },
  touch() { const { F, uid } = this.ctx; F.updateDoc(ref('users', uid), { lastSeen: F.serverTimestamp() }).catch(() => {}); },
  async setName(name) {
    const { F, uid } = this.ctx;
    await F.updateDoc(ref('users', uid), { name });
    this.profile.name = name; try { localStorage.setItem('ext_name', name); } catch {}
  },
};
function ref(...p) { return Net.ctx.F.doc(Net.ctx.db, ...p); }
function col(...p) { return Net.ctx.F.collection(Net.ctx.db, ...p); }
function localName() {
  let n = ''; try { n = localStorage.getItem('ext_name') || ''; } catch {}
  return cleanName(n) || `エクストリーマー${rnd(900) + 99}`;
}
function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12); }
function myRating() { return Net.profile?.rating ?? 1000; }
function isOnline(u) { const t = u?.lastSeen?.toMillis?.(); return !!t && Date.now() - t < ONLINE_MS; }
function errText(e) {
  const c = e?.code || '', m = e?.message || String(e);
  if (m === 'NOCONFIG') return 'オンライン機能はまだ準備されていません（firebase-config.js が未設定）。';
  if (/operation-not-allowed|admin-restricted/.test(c)) return 'Firebaseの「匿名ログイン」が有効になっていません。';
  if (/permission-denied/.test(c)) return '権限がありません（Firestoreのルールを確認してください）。';
  if (/unavailable|network|failed-precondition/.test(c) || /Failed to fetch|import/.test(m)) return '通信できませんでした。電波の良い所でもう一度試してください。';
  return m.slice(0, 160);
}

/* 図鑑のクラウド保存（1人1ドキュメント） */
let dexTimer = null;
function cloudDexSave() {
  if (!Net.ctx) return;
  clearTimeout(dexTimer);
  dexTimer = setTimeout(() => {
    const { F, uid } = Net.ctx;
    F.setDoc(ref('users', uid, 'dex', 'main'), { cards: Dex.load(), at: F.serverTimestamp() }).catch(() => {});
  }, 1500);
}
async function cloudDexSync() {
  try {
    const { F, uid } = Net.ctx;
    const s = await F.getDoc(ref('users', uid, 'dex', 'main'));
    const local = Dex.load();
    const merged = Dex.merge(local, s.exists() ? s.data().cards : {});
    Dex.save(merged);
    if (!s.exists() || Object.keys(merged).length !== Object.keys(s.data().cards || {}).length) cloudDexSave();
  } catch {}
}

/* ---------- オンライン画面（ハブ） ---------- */
async function openOnline() {
  show('online');
  const body = $('#onlineBody');
  if (!Net.configured()) {
    body.innerHTML = `<p class="note">オンライン対戦を使うには、このアプリの管理者が無料の Firebase を設定する必要があります（README の「オンライン対戦の準備」）。</p>
      <p class="note">CPU戦・2人対戦・人物図鑑はそのまま遊べます。</p><button class="btn ghost" data-home>タイトルへ</button>`;
    body.querySelector('[data-home]').onclick = () => show('home');
    return;
  }
  body.innerHTML = '<p class="note">接続中…</p>';
  try { await Net.start(); } catch (e) {
    body.innerHTML = `<p class="note ngText">${esc(errText(e))}</p><button class="btn primary" id="onRetry">もう一度</button><button class="btn ghost" data-home>タイトルへ</button>`;
    $('#onRetry').onclick = openOnline; body.querySelector('[data-home]').onclick = () => show('home');
    return;
  }
  renderHub();
}
function renderHub() {
  const P = Net.profile, body = $('#onlineBody');
  const rec = P.games ? `${P.wins}勝${P.losses}敗` : '未対戦';
  body.innerHTML = `<div class="profCard">
      <label class="field">ニックネーム（12字まで）
        <span class="inRow"><input id="onName" maxlength="12" value="${esc(P.name)}"><button class="btn small" id="onNameSave">保存</button></span>
      </label>
      <div class="statRow"><span>レート<b>${P.rating ?? '—'}</b></span><span>戦績<b>${rec}</b></span><span>フレンドコード<b class="code">${esc(P.code)}</b></span></div>
    </div>
    <div class="inviteBox" id="hubInvites"></div>
    <button class="btn primary" id="onCreate">ルームを作る</button>
    <label class="field">ルームに入る
      <span class="inRow"><input id="onCode" maxlength="5" placeholder="ルームコード（5文字）" autocapitalize="characters" autocomplete="off"><button class="btn small" id="onJoin">参加</button></span>
    </label>
    <div class="btnRow"><button class="btn" id="onRank">ランキング</button><button class="btn" id="onFriends">フレンド<span class="badge" id="reqBadge"></span></button></div>
    <p class="note">物語はルームを作った人の Gemini APIキー（無料枠）で作ります。参加する人はキーがなくても遊べます。1試合で無料枠を5回使います。</p>
    <p class="note">データはこのブラウザのアカウントにひも付きます（サイトのデータを消すと戦績も消えます）。</p>
    <button class="btn ghost" id="onHome">タイトルへ</button>`;
  $('#onNameSave').onclick = async () => {
    const n = cleanName($('#onName').value);
    if (!n) return toast('名前を入れてください');
    try { await Net.setName(n); toast('保存しました'); } catch (e) { toast(errText(e)); }
  };
  $('#onCreate').onclick = () => hostRoom();
  $('#onJoin').onclick = () => joinRoom($('#onCode').value);
  $('#onCode').onkeydown = (e) => { if (e.key === 'Enter') joinRoom($('#onCode').value); };
  $('#onRank').onclick = () => showRanking('rate');
  $('#onFriends').onclick = showFriends;
  $('#onHome').onclick = () => { refreshKeyNote(); show('home'); };
  renderInvites(); paintReqBadge();
}

/* ---------- 招待・申請の通知 ---------- */
let invites = [], requests = [];
function watchInvites() {
  const { F, uid } = Net.ctx;
  F.onSnapshot(col('users', uid, 'invites'), (q) => {
    invites = q.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => { const t = x.at?.toMillis?.() ?? Date.now(); return Date.now() - t < INVITE_MS; });
    renderInvites();
  }, () => {});
}
function watchRequests() {
  const { F, uid } = Net.ctx;
  F.onSnapshot(col('users', uid, 'requests'), (q) => {
    requests = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    paintReqBadge();
    if ($('#friends').classList.contains('active')) renderFriends();
  }, () => {});
}
function paintReqBadge() { const b = $('#reqBadge'); if (b) b.textContent = requests.length ? String(requests.length) : ''; }
function renderInvites() {
  const html = invites.map((x) => `<div class="invite"><span>📨 <b>${esc(x.name)}</b> さんからルームへの招待</span>
    <span class="inRow"><button class="btn small primary" data-join="${esc(x.room)}" data-id="${esc(x.id)}">参加</button><button class="btn small ghost" data-del="${esc(x.id)}">×</button></span></div>`).join('');
  ['#inviteBox', '#hubInvites'].forEach((s) => {
    const box = $(s); if (!box) return;
    box.innerHTML = html;
    box.querySelectorAll('[data-join]').forEach((b) => (b.onclick = () => { delInvite(b.dataset.id); joinRoom(b.dataset.join); }));
    box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => delInvite(b.dataset.del)));
  });
}
function delInvite(id) { const { F, uid } = Net.ctx; F.deleteDoc(ref('users', uid, 'invites', id)).catch(() => {}); }

/* ---------- ランキング ---------- */
let rankTab = 'rate';
async function showRanking(tab = rankTab) {
  rankTab = tab;
  const tabs = [['rate', 'レート'], ['wins', '勝利数'], ['friends', 'フレンド内']];
  $('#rankTabs').innerHTML = tabs.map(([k, l]) => `<button class="chipBtn ${k === tab ? 'on' : ''}" role="tab" aria-selected="${k === tab}" data-t="${k}">${l}</button>`).join('');
  $('#rankTabs').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => showRanking(b.dataset.t)));
  $('#rankList').innerHTML = '<p class="note">読み込み中…</p>';
  $('#rankMine').textContent = '';
  show('ranking');
  try {
    await Net.start();
    const { F, uid } = Net.ctx;
    let rows;
    if (tab === 'friends') {
      const fr = (await F.getDocs(col('users', uid, 'friends'))).docs.filter((d) => d.data().ok).map((d) => d.id);
      const docs = await Promise.all([uid, ...fr].map((id) => F.getDoc(ref('users', id))));
      rows = docs.filter((d) => d.exists()).map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else {
      const field = tab === 'rate' ? 'rating' : 'wins';
      const q = await F.getDocs(F.query(col('users'), F.orderBy(field, 'desc'), F.limit(50)));
      rows = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.games > 0 && (tab === 'rate' || u.wins > 0));
    }
    const P = (await F.getDoc(ref('users', uid))).data(); Net.profile = P;
    if (tab === 'rate' && P.rating != null) {
      const c = await F.getCountFromServer(F.query(col('users'), F.where('rating', '>', P.rating)));
      $('#rankMine').textContent = `あなた：${c.data().count + 1}位（レート${P.rating}・${P.wins}勝${P.losses}敗）`;
    } else if (tab === 'rate') $('#rankMine').textContent = 'オンライン対戦を1回すると、ランキングに載ります。';
    $('#rankList').innerHTML = rows.length ? rows.map((u, i) => `<div class="rankRow ${u.id === uid ? 'me' : ''}">
        <b class="rk">${i + 1}</b><span class="nm">${isOnline(u) ? '<i class="dot"></i>' : ''}${esc(u.name)}</span>
        <span class="rt">${tab === 'wins' ? `${u.wins}勝` : (u.rating ?? '—')}</span><small>${u.games ? `${u.wins}勝${u.losses}敗` : '未対戦'}</small></div>`).join('')
      : '<p class="note">まだ誰も載っていません。</p>';
  } catch (e) { $('#rankList').innerHTML = `<p class="note ngText">${esc(errText(e))}</p>`; }
}

/* ---------- フレンド ---------- */
async function showFriends() {
  show('friends');
  $('#friendsBody').innerHTML = '<p class="note">読み込み中…</p>';
  try { await Net.start(); renderFriends(); } catch (e) { $('#friendsBody').innerHTML = `<p class="note ngText">${esc(errText(e))}</p>`; }
}
async function renderFriends() {
  const { F, uid } = Net.ctx, P = Net.profile, box = $('#friendsBody');
  const fr = (await F.getDocs(col('users', uid, 'friends'))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const info = await Promise.all(fr.map((f) => F.getDoc(ref('users', f.id)).then((s) => s.data() || {}).catch(() => ({}))));
  fr.forEach((f, i) => { f.u = info[i]; });
  fr.sort((a, b) => (b.ok - a.ok) || (isOnline(b.u) - isOnline(a.u)));
  box.innerHTML = `<div class="profCard"><span class="note">あなたのフレンドコード</span><b class="code big">${esc(P.code)}</b>
      <button class="btn small" id="copyCode">コピー</button></div>
    <label class="field">フレンドコードで申請
      <span class="inRow"><input id="frCode" maxlength="6" placeholder="6文字" autocapitalize="characters" autocomplete="off"><button class="btn small" id="frAdd">申請</button></span>
    </label>
    ${requests.length ? `<p class="kicker">届いた申請</p>${requests.map((r) => `<div class="friend"><span class="nm">${esc(r.name)}<small>${esc(r.code || '')}</small></span>
      <span class="inRow"><button class="btn small primary" data-ok="${esc(r.id)}">承認</button><button class="btn small ghost" data-no="${esc(r.id)}">断る</button></span></div>`).join('')}` : ''}
    <p class="kicker">フレンド（${fr.filter((f) => f.ok).length}人）</p>
    ${fr.length ? fr.map((f) => `<div class="friend"><span class="nm">${isOnline(f.u) ? '<i class="dot"></i>' : '<i class="dot off"></i>'}${esc(f.u.name || f.name)}
        <small>${f.ok ? `レート${f.u.rating ?? '—'}・${f.u.wins || 0}勝${f.u.losses || 0}敗` : '承認待ち'}</small></span>
      <span class="inRow">${f.ok ? `<button class="btn small primary" data-inv="${esc(f.id)}">招待</button>` : ''}<button class="btn small ghost" data-rm="${esc(f.id)}">削除</button></span></div>`).join('')
      : '<p class="note">まだいません。フレンドコードを教え合って申請しよう。</p>'}
    <p class="note">🟢＝いまアプリを開いている人。招待すると、ルームが作られて相手に通知が届きます。</p>`;
  $('#copyCode').onclick = () => copyText(P.code, 'フレンドコードをコピーしました');
  $('#frAdd').onclick = () => addFriend($('#frCode').value);
  box.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => acceptFriend(b.dataset.ok)));
  box.querySelectorAll('[data-no]').forEach((b) => (b.onclick = () => F.deleteDoc(ref('users', uid, 'requests', b.dataset.no)).catch((e) => toast(errText(e)))));
  box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => removeFriend(b.dataset.rm)));
  box.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => inviteFriend(b.dataset.inv)));
}
async function addFriend(code) {
  code = String(code || '').trim().toUpperCase();
  if (code.length !== 6) return toast('6文字のコードを入れてください');
  const { F, uid, db } = Net.ctx, P = Net.profile;
  if (code === P.code) return toast('自分のコードです');
  try {
    const q = await F.getDocs(F.query(col('users'), F.where('code', '==', code), F.limit(1)));
    if (q.empty) return toast('そのコードの人は見つかりません');
    const t = q.docs[0];
    if (requests.some((r) => r.id === t.id)) return acceptFriend(t.id); // 相手からも申請が来ていれば承認
    const b = F.writeBatch(db);
    b.set(ref('users', uid, 'friends', t.id), { name: t.data().name, ok: false, at: F.serverTimestamp() });
    b.set(ref('users', t.id, 'requests', uid), { name: P.name, code: P.code, at: F.serverTimestamp() });
    await b.commit();
    toast(`${t.data().name}さんに申請しました`); renderFriends();
  } catch (e) { toast(errText(e)); }
}
async function acceptFriend(from) {
  const { F, uid, db } = Net.ctx, P = Net.profile;
  try {
    const r = requests.find((x) => x.id === from);
    const b = F.writeBatch(db);
    b.set(ref('users', uid, 'friends', from), { name: r?.name || '', ok: true, at: F.serverTimestamp() });
    b.set(ref('users', from, 'friends', uid), { name: P.name, ok: true, at: F.serverTimestamp() });
    b.delete(ref('users', uid, 'requests', from));
    await b.commit();
    toast('フレンドになりました'); renderFriends();
  } catch (e) { toast(errText(e)); }
}
async function removeFriend(fid) {
  if (!confirm('このフレンドを削除しますか？')) return;
  const { F, uid, db } = Net.ctx;
  try {
    const b = F.writeBatch(db);
    b.delete(ref('users', uid, 'friends', fid));
    b.delete(ref('users', fid, 'friends', uid));
    await b.commit(); renderFriends();
  } catch (e) { toast(errText(e)); }
}
async function inviteFriend(fid) {
  const { F, uid } = Net.ctx;
  try {
    if (!(ON.code && ON.role === 'host')) await hostRoom(true);
    if (!ON.code) return;
    await F.setDoc(ref('users', fid, 'invites', uid), { name: Net.profile.name, room: ON.code, at: F.serverTimestamp() });
    toast('招待を送りました'); renderLobby();
  } catch (e) { toast(errText(e)); }
}
function copyText(t, msg) {
  (navigator.clipboard?.writeText(t) || Promise.reject()).then(() => toast(msg), () => prompt('コピーしてください', t));
}

/* ---------- ルーム ---------- */
const ON = { code: null, role: null, room: null, unsub: null, lastSeq: '', lastGa: 0, key: '', view: null, done: new Set(), recv: 0, deadline: 0, barIv: null, spin: null };

async function hostRoom(quiet) {
  try {
    await Net.start();
    if (ON.code) await leaveRoom(true);
    const { F, uid } = Net.ctx;
    for (let i = 0; i < 6; i++) {
      const code = randCode(5);
      try {
        await F.setDoc(ref('rooms', code), {
          code, hostUid: uid, hostName: Net.profile.name, hostRating: myRating(),
          guestUid: null, guestName: '', guestRating: 1000, status: 'wait', pub: '', ga: null, hostLeft: false, at: F.serverTimestamp(),
        });
        enterRoom(code, 'host');
        if (!quiet) toast('ルームを作りました');
        return code;
      } catch (e) { if (e.code !== 'permission-denied') throw e; }
    }
    throw new Error('ルームを作れませんでした。Firestoreのルールを確認してください。');
  } catch (e) { toast(errText(e)); }
}
async function joinRoom(code) {
  code = String(code || '').trim().toUpperCase();
  if (code.length !== 5) return toast('5文字のルームコードを入れてください');
  try {
    await Net.start();
    if (ON.code === code) return show('lobby');
    if (ON.code) await leaveRoom(true);
    const { F, uid, db } = Net.ctx;
    const role = await F.runTransaction(db, async (tx) => {
      const s = await tx.get(ref('rooms', code));
      if (!s.exists()) throw new Error('そのルームは見つかりません');
      const r = s.data();
      if (r.hostLeft || r.status === 'closed') throw new Error('そのルームは閉じられています');
      if (r.guestUid === uid) return 'guest';
      if (r.hostUid === uid) throw new Error('自分が作ったルームです');
      if (r.guestUid) throw new Error('そのルームは満員です');
      if (r.status !== 'wait') throw new Error('そのルームは対戦中です');
      tx.update(ref('rooms', code), { guestUid: uid, guestName: Net.profile.name, guestRating: myRating() });
      return 'guest';
    });
    enterRoom(code, role);
  } catch (e) { toast(e.code ? errText(e) : e.message); }
}
function enterRoom(code, role) {
  const { F } = Net.ctx;
  ON.code = code; ON.role = role; ON.room = null; ON.lastSeq = ''; ON.key = ''; ON.lastGa = -1; ON.recv = Date.now();
  if (ON.unsub) ON.unsub();
  ON.unsub = F.onSnapshot(ref('rooms', code), onRoom, (e) => toast(errText(e)));
  try { history.replaceState(null, '', `${location.pathname}?room=${code}`); } catch {}
  show('lobby'); renderLobby();
}
function onRoom(snap) {
  const uid = Net.ctx.uid;
  if (!snap.exists()) return leaveLocal('ルームがなくなりました');
  const r = snap.data(), prev = ON.room;
  ON.room = r; ON.recv = Date.now();
  if (ON.role === 'host') {
    if (ON.lastGa < 0) ON.lastGa = r.ga?.n || 0; // 入る前の操作は無視
    if (r.ga && r.ga.n > ON.lastGa) { ON.lastGa = r.ga.n; if (S && S.mode === 'online') Host.onAct(1, r.ga.k, r.ga.v); }
    if (prev && prev.guestUid && !r.guestUid) {
      if (S && S.mode === 'online' && S.phase !== 'final') Host.abort('相手が退出しました');
      else toast('相手が退出しました');
    }
    if (prev && !prev.guestUid && r.guestUid) { toast(`${r.guestName}さんが入室しました`); Sound.sfx('ok'); }
    if ($('#lobby').classList.contains('active')) renderLobby();
  } else {
    if (r.guestUid !== uid) return leaveLocal('ルームから外れました');
    if (r.hostLeft || r.status === 'closed') return leaveLocal('ホストがルームを閉じました');
    let v = null; try { v = r.pub ? JSON.parse(r.pub) : null; } catch {}
    if (v && v.seq !== ON.lastSeq) {
      ON.lastSeq = v.seq;
      if (v.phase === 'lobby') { if ($('#lobby').classList.contains('active')) renderLobby(); }
      else renderView(v);
    } else if ($('#lobby').classList.contains('active')) renderLobby();
  }
}
function renderLobby() {
  const r = ON.room, box = $('#lobbyBody');
  setBar(false);
  if (!r) { box.innerHTML = '<p class="note">ルームに接続中…</p>'; return; }
  const host = ON.role === 'host';
  const url = `${location.origin}${location.pathname}?room=${ON.code}`;
  const keyOk = !!store.key, left = quota.left();
  const canStart = host && r.guestUid && r.status !== 'play';
  box.innerHTML = `<p class="kicker">ルーム</p>
    <div class="roomCode">${esc(ON.code)}</div>
    <div class="btnRow"><button class="btn small" id="lbCopy">コードをコピー</button><button class="btn small" id="lbShare">リンクを送る</button></div>
    <div class="team a"><h3>🟥 ${esc(r.hostName)}（ホスト）</h3><p class="note">レート${r.hostRating}</p></div>
    <div class="team b"><h3>🟦 ${r.guestUid ? esc(r.guestName) : '参加を待っています…'}</h3>${r.guestUid ? `<p class="note">レート${r.guestRating}</p>` : '<p class="note">コードかリンクを相手に送ってください。</p>'}</div>
    ${host ? `${!keyOk ? '<p class="note ngText">ゲームを始めるには「設定」でGemini APIキーを入れてください。</p>'
      : left < CALLS_PER_GAME ? `<p class="note ngText">今日の無料枠が足りません（${resetTimeText()}にリセット）。</p>` : `<p class="note">あなたの無料枠：今日あと${Math.floor(left / CALLS_PER_GAME)}試合</p>`}
      <button class="btn primary" id="lbStart" ${canStart && keyOk && left >= CALLS_PER_GAME ? '' : 'disabled'}>対戦スタート</button>
      <div id="lbFriends"></div>` : `<p class="note">${r.status === 'play' ? '対戦中です。まもなく画面が切り替わります…' : 'ホストがスタートするのを待っています…'}</p>`}
    <button class="btn ghost" id="lbLeave">${host ? 'ルームを閉じる' : 'ルームから出る'}</button>`;
  $('#lbCopy').onclick = () => copyText(ON.code, 'コードをコピーしました');
  $('#lbShare').onclick = () => {
    const text = `エクストリーマーズで対戦しよう！ルームコード：${ON.code}`;
    if (navigator.share) navigator.share({ title: 'EXTREMERS', text, url }).catch(() => {});
    else copyText(`${text}\n${url}`, 'リンクをコピーしました');
  };
  $('#lbLeave').onclick = () => leaveRoom();
  if (host) {
    $('#lbStart').onclick = () => Host.start();
    if (!r.guestUid) lobbyFriends();
  }
}
async function lobbyFriends() {
  const box = $('#lbFriends'); if (!box) return;
  try {
    const { F, uid } = Net.ctx;
    const fr = (await F.getDocs(col('users', uid, 'friends'))).docs.filter((d) => d.data().ok);
    if (!fr.length) return;
    const us = await Promise.all(fr.map((d) => F.getDoc(ref('users', d.id)).then((s) => ({ id: d.id, ...(s.data() || {}) }))));
    us.sort((a, b) => isOnline(b) - isOnline(a));
    if (!$('#lbFriends')) return;
    box.innerHTML = `<p class="kicker">フレンドを招待</p>${us.map((u) => `<div class="friend"><span class="nm">${isOnline(u) ? '<i class="dot"></i>' : '<i class="dot off"></i>'}${esc(u.name)}</span>
      <button class="btn small" data-inv="${esc(u.id)}">招待</button></div>`).join('')}`;
    box.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => inviteFriend(b.dataset.inv)));
  } catch {}
}
async function leaveRoom(quiet) {
  if (!ON.code) return;
  const { F, uid } = Net.ctx, code = ON.code, role = ON.role;
  if (ON.unsub) ON.unsub();
  ON.unsub = null; ON.code = null; ON.room = null;
  if (role === 'host') Host.reset();
  else if (S && S.mode === 'online') S = null;
  setBar(false);
  try { history.replaceState(null, '', location.pathname); } catch {}
  try {
    if (role === 'host') await F.updateDoc(ref('rooms', code), { hostLeft: true, status: 'closed' });
    else await F.updateDoc(ref('rooms', code), { guestUid: null, guestName: '', guestRating: 1000, ga: null });
  } catch {}
  void uid;
  if (!quiet) openOnline();
}
function leaveLocal(msg) {
  if (ON.unsub) ON.unsub();
  ON.unsub = null; ON.code = null; ON.room = null;
  if (ON.role === 'host') Host.reset(); else if (S && S.mode === 'online') S = null;
  setBar(false);
  try { history.replaceState(null, '', location.pathname); } catch {}
  toast(msg);
  const inGame = ['draft', 'reveal', 'stage', 'roll', 'result', 'loading', 'lobby', 'error'].some((id) => $(`#${id}`).classList.contains('active'));
  if (inGame) openOnline();
}
// 対戦中の画面から「タイトルへ」を押したら、ルームからも出る
document.addEventListener('click', (e) => {
  if (ON.code && e.target.closest('[data-go="home"]')) leaveRoom(true);
}, true);
$('#onLeave').onclick = () => {
  if (!ON.code) return;
  const playing = ON.view && ON.view.phase !== 'final' && ON.room?.status === 'play';
  if (playing && !confirm('対戦の途中です。退出すると対戦は中止になります。退出しますか？')) return;
  leaveRoom();
};
window.addEventListener('pagehide', () => {
  if (ON.code && ON.role === 'host' && Net.ctx) Net.ctx.F.updateDoc(ref('rooms', ON.code), { hostLeft: true, status: 'closed' }).catch(() => {});
});

/* 操作を送る（ホストは手元で処理、ゲストはFirestoreに書く） */
function act(k, v = null) {
  if (ON.role === 'host') return Host.onAct(0, k, v);
  const { F } = Net.ctx;
  F.updateDoc(ref('rooms', ON.code), { ga: { n: Date.now() * 10 + rnd(9), k, v } }).catch((e) => toast(errText(e)));
}

/* ---------- ホスト：対戦の進行 ---------- */
const card = (m) => ({ id: m.id, job: m.job, income: m.income, hobby: m.hobby, skill: m.skill, weak: m.weak || '', ath: m.ath, prop: m.prop || '', out: !!m.out });
const hidden = (m) => ({ ...card(m), weak: m.weak ? '？？？' : '' });
const Host = {
  timer: null, after: null,
  set(ms, fn) { clearTimeout(this.timer); this.timer = ms ? setTimeout(fn, ms) : null; },
  reset() { clearTimeout(this.timer); clearTimeout(this.after); this.timer = null; if (S && S.mode === 'online') S = null; },
  async start() {
    const r = ON.room;
    if (!r?.guestUid) return toast('相手がまだいません');
    if (!store.key) { toast('先にAPIキーを設定してください'); return openSettings(); }
    if (quota.left() < CALLS_PER_GAME) return toast(`今日の無料枠が足りません（${resetTimeText()}にリセット）`);
    S = {
      mode: 'online', me: 0, names: [r.hostName, r.guestName], uids: [r.hostUid, r.guestUid],
      matchId: `${ON.code}-${Date.now().toString(36)}`, n: 0,
      pools: null, task: '', teams: [[], []], round: 0, turn: 0,
      stage: 0, scores: [0, 0], stagePts: [[], []], log: [], saved: false, history: [], scene: null, choice: [null, null], last: null,
      phase: 'loading', pick: [null, null], ready: [false, false], rolled: [false, false], deadline: 0,
    };
    try { await Net.ctx.F.updateDoc(ref('rooms', ON.code), { status: 'play', ga: null }); } catch (e) { S = null; return toast(errText(e)); }
    this.setup();
  },
  publish() {
    if (!S || S.mode !== 'online' || !ON.code) return;
    S.n++;
    const seq = `${S.matchId}:${S.n}`;
    const v1 = { ...viewFor(1), seq }, v0 = { ...viewFor(0), seq };
    const { F } = Net.ctx;
    F.updateDoc(ref('rooms', ON.code), { pub: JSON.stringify(v1), at: F.serverTimestamp() }).catch((e) => toast(`通信エラー：${errText(e)}`));
    renderView(v0);
  },
  loading(lines, vs) { S.phase = 'loading'; S.loadLines = lines; S.loadVs = vs || null; this.set(0); this.publish(); },
  error(e, again) {
    S.phase = 'hosterr'; S.errMsg = e.message || String(e); this.set(0); this.publish();
    fail(e, again); // ホストにはエラー画面（もう一度）
  },
  async setup() {
    this.loading(['エクストリーマーを招集中…', '極秘ミッションを受信中…', '候補者の経歴を洗い出し中…']);
    try {
      const pool = rnd(10) <= 7 ? TASK_HOT : TASK_MILD;
      const ti = rnd(pool.length) - 1, type = pool[ti];
      const genres = [0, 1].map(() => Array.from({ length: ROUNDS }, () => drawGenres(5)));
      const d = await ask(GM, setupPrompt(type, genres), 8000);
      if (!S) return;
      if (!d.players || d.players.length < 2 || d.players.some((pl) => !Array.isArray(pl) || pl.length < ROUNDS || pl.some((c) => !Array.isArray(c) || !c.length))) throw new Error('人物データが足りません。');
      S.pools = d.players; S.task = d.task; S.type = type; S.mood = (pool === TASK_HOT ? GROOVE_HOT : GROOVE_MILD)[ti];
      this.draft();
    } catch (e) { if (S) this.error(e, () => this.setup()); }
  },
  draft() {
    if (S.round >= ROUNDS) return this.reveal();
    S.phase = 'draft'; S.pick = [null, null]; S.deadline = Date.now() + PICK_MS;
    this.set(PICK_MS + PICK_GRACE, () => this.endDraft());
    this.publish();
  },
  endDraft() {
    this.set(0);
    [0, 1].forEach((p) => {
      const c = S.pools[p][S.round];
      const i = S.pick[p] ?? rnd(c.length) - 1;
      addMember(p, c[i]);
    });
    S.round++;
    S.phase = 'drafted'; // 次の巡までの間（重複処理を防ぐ）
    clearTimeout(this.after);
    this.after = setTimeout(() => this.draft(), 700);
  },
  reveal() {
    S.phase = 'reveal'; S.ready = [false, false];
    this.set(T_READY, () => { S.ready = [true, true]; this.firstStage(); });
    this.publish();
  },
  async firstStage() {
    this.loading([INTRO_LINE[S.mood] || 'ミッション開始…', '第1関門へ突入中…'], ['4人のエクストリーマーズ', '4人のエクストリーマーズ', S.task]);
    try {
      const d = await ask(GM, `究極の課題：${S.task}\n\n${teamText()}\n\n${STAGE_SPEC(1)}\n\n出力形式：${OPT_SCHEMA}`, 3000);
      if (!S) return;
      if (!Array.isArray(d.options) || !d.options.length) throw new Error('作戦のデータが足りません。');
      S.scene = d; S.stage = 0; this.stage();
    } catch (e) { if (S) this.error(e, () => this.firstStage()); }
  },
  stage() {
    S.phase = 'stage'; S.choice = [null, null]; S.deadline = Date.now() + T_CHOOSE;
    this.set(T_CHOOSE + PICK_GRACE, () => { [0, 1].forEach((p) => { if (S.choice[p] == null) S.choice[p] = cpuChoice(p); }); this.resolve(); });
    this.publish();
  },
  resolve() {
    this.set(0);
    S.last = { stage: S.stage, rs: [prepTeam(0), prepTeam(1)], done: false };
    S.phase = 'roll'; S.rolled = [false, false]; S.deadline = Date.now() + T_ROLL;
    this.set(T_ROLL + PICK_GRACE, () => [0, 1].forEach((p) => this.roll(p)));
    this.publish();
  },
  roll(p) {
    if (S.phase !== 'roll' || S.rolled[p]) return;
    S.rolled[p] = true;
    finishTeam(S.last.rs[p], rnd(100));
    if (S.rolled[0] && S.rolled[1]) {
      this.set(0); S.last.done = true;
      if (S.stage === STAGES - 1) S.last.win = decideWinner();
      clearTimeout(this.after);
      this.after = setTimeout(() => this.narrate(), 3200);
    }
    this.publish();
  },
  async narrate() {
    const { rs, win } = S.last;
    const final = S.stage === STAGES - 1;
    this.loading(actionLines(rs, final), [crewName(rs[0]), crewName(rs[1]), `${S.names[0]} ${S.scores[0]}点　―　${S.scores[1]}点 ${S.names[1]}`]);
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
      if (!S) return;
      if (!final && (!d.next || !Array.isArray(d.next.options) || !d.next.options.length)) throw new Error('次の関門のデータが足りません。');
      S.history.push(d.summary || `${rs[0].label}／${rs[1].label}`);
      S.res = d;
      S.log[S.stage] = {
        scene: S.scene.scene,
        rs: rs.map((r) => ({ p: r.p, label: r.label, job: crewName(r), outJob: r.out ? r.outM.job : '', roll: r.roll, rate: r.rate, grade: r.grade, ok: r.ok, pts: r.pts, out: r.out, text: r.p ? d.resultB : d.resultA })),
      };
      S.phase = 'result'; S.ready = [false, false];
      this.set(T_READY, () => { S.ready = [true, true]; this.next(); });
      this.publish();
    } catch (e) { if (S) this.error(e, () => this.narrate()); }
  },
  async next() {
    this.set(0);
    if (S.stage < STAGES - 1) { S.scene = S.res.next; S.stage++; return this.stage(); }
    const win = S.last.win, { F } = Net.ctx;
    S.phase = 'final';
    try {
      await F.setDoc(ref('matches', S.matchId), {
        room: ON.code, hostUid: S.uids[0], guestUid: S.uids[1], winnerUid: S.uids[win.w], scores: S.scores, task: S.task,
        counted: {}, at: F.serverTimestamp(),
      });
    } catch (e) { toast(`記録エラー：${errText(e)}`); }
    if (!S) return;
    F.updateDoc(ref('rooms', ON.code), { status: 'wait' }).catch(() => {});
    this.publish();
  },
  onAct(p, k, v) {
    if (!S || S.mode !== 'online') return;
    if (k === 'pick' && S.phase === 'draft' && S.pick[p] == null) {
      const n = S.pools[p][S.round].length;
      S.pick[p] = Number.isInteger(v) && v >= 0 && v < n ? v : rnd(n) - 1;
      if (S.pick[0] != null && S.pick[1] != null) this.endDraft(); else this.publish();
    } else if (k === 'ready' && (S.phase === 'reveal' || S.phase === 'result') && !S.ready[p]) {
      S.ready[p] = true;
      if (S.ready[0] && S.ready[1]) { if (S.phase === 'reveal') this.firstStage(); else this.next(); } else this.publish();
    } else if (k === 'choose' && S.phase === 'stage' && S.choice[p] == null) {
      const n = S.scene.options.length;
      S.choice[p] = Number.isInteger(v) && v >= 0 && v < n ? v : cpuChoice(p);
      if (S.choice[0] != null && S.choice[1] != null) this.resolve(); else this.publish();
    } else if (k === 'roll') this.roll(p);
  },
  abort(msg) {
    this.reset();
    toast(msg);
    if (ON.code) Net.ctx.F.updateDoc(ref('rooms', ON.code), { status: 'wait', pub: '', ga: null }).catch(() => {});
    show('lobby'); renderLobby();
  },
};

/* プレイヤーpに見せてよい内容だけを作る（相手の候補・弱点・作戦の中身は入れない） */
function teamsFor(p) { return [0, 1].map((q) => S.teams[q].map(q === p ? card : hidden)); }
function rollView(r, mine) {
  const show1 = (m) => (mine || (r.weak && m === r.ex) ? card(m) : hidden(m));
  return {
    p: r.p, label: r.label, kind: r.kind, ex: show1(r.ex), helpers: r.helpers.map(show1), rate: r.rate, mods: r.mods,
    rolled: r.roll != null, roll: r.roll ?? null, ok: !!r.ok, grade: r.grade || '', pts: r.pts ?? 0, outJob: r.out ? r.outM.job : '',
  };
}
function viewFor(p) {
  const base = { phase: S.phase, me: p, names: S.names, mood: S.mood || 'electro', stage: S.stage, scores: S.scores, task: S.task, code: ON.code };
  const left = () => Math.max(0, S.deadline - Date.now());
  switch (S.phase) {
    case 'loading': return { ...base, lines: S.loadLines, vs: S.loadVs };
    case 'hosterr': return { ...base, msg: S.errMsg };
    case 'draft': case 'drafted': return { ...base, phase: 'draft', round: S.round, cands: S.pools[p][S.round].map(card), team: S.teams[p].map((m) => m.job),
      picked: S.pick[p] != null, pickedI: S.pick[p], oppPicked: S.pick[1 - p] != null, msLeft: left() };
    case 'reveal': return { ...base, teams: teamsFor(p), ready: S.ready[p], oppReady: S.ready[1 - p] };
    case 'stage': return { ...base, scene: S.scene.scene, options: S.scene.options.map((o) => ({ label: o.label, detail: o.detail, kind: o.kind })),
      teams: teamsFor(p), chosen: S.choice[p], oppChosen: S.choice[1 - p] != null, msLeft: left() };
    case 'roll': return { ...base, mine: rollView(S.last.rs[p], true), opp: rollView(S.last.rs[1 - p], false), msLeft: left() };
    case 'result': return { ...base, final: S.stage === STAGES - 1, ready: S.ready[p], oppReady: S.ready[1 - p],
      rs: S.last.rs.map((r) => ({ p: r.p, label: r.label, crew: crewName(r), roll: r.roll, rate: r.rate, grade: r.grade, ok: r.ok, pts: r.pts, out: r.out, outJob: r.out ? r.outM.job : '', text: r.p ? S.res.resultB : S.res.resultA })) };
    case 'final': return { ...base, win: S.last.win, epilogue: S.res.epilogue || '', teams: S.teams.map((t) => t.map(card)), log: S.log,
      matchId: S.matchId, uids: S.uids, seen: S.pools[p].flat().map(card) };
  }
  return base;
}

/* ---------- 両者共通：画面を描く ---------- */
function renderView(v) {
  const prevKey = ON.key;
  ON.view = v;
  if (ON.role === 'guest') S = { mode: 'online', names: v.names, mood: v.mood, stage: v.stage, scores: v.scores, youLost: v.phase === 'final' && v.win.w !== v.me };
  else if (S) S.youLost = v.phase === 'final' && v.win.w !== v.me;
  const key = [v.code, v.phase, v.round ?? '', v.stage ?? '', v.phase === 'loading' ? (v.lines || [])[0] : ''].join(':');
  const same = key === prevKey && ON.view;
  ON.key = key;
  ON.deadline = v.msLeft != null ? Date.now() + v.msLeft : 0;
  setBar(true, v);
  const f = { loading: vLoading, hosterr: vHostErr, draft: vDraft, reveal: vReveal, stage: vStage, roll: vRoll, result: vResult, final: vFinal }[v.phase];
  if (f) f(v, same);
}
const opp = (v) => v.names[1 - v.me];
const mark = (p) => (p ? '🟦' : '🟥');
function setBar(on, v) {
  const bar = $('#onBar');
  bar.hidden = !on; document.body.classList.toggle('onlineOn', on);
  clearInterval(ON.barIv);
  if (!on) return;
  const paint = () => {
    const sec = ON.deadline ? Math.ceil(Math.max(0, ON.deadline - Date.now()) / 1000) : null;
    let st = waitText(v);
    if (ON.role === 'guest' && v.phase !== 'final' && Date.now() - ON.recv > STALE_MS) st = '⚠️ ホストの応答がありません';
    $('#onBarText').textContent = `${mark(v.me)} vs ${opp(v)}${st ? `｜${st}` : ''}${sec != null && sec > 0 && !st.includes('待って') ? `｜残り${sec}秒` : ''}`;
  };
  paint(); ON.barIv = setInterval(paint, 1000);
}
function waitText(v) {
  switch (v.phase) {
    case 'draft': return v.picked ? (v.oppPicked ? '' : '相手を待っています') : (v.oppPicked ? '相手は選択済み' : '');
    case 'reveal': case 'result': return v.ready ? '相手を待っています' : (v.oppReady ? '相手は準備OK' : '');
    case 'stage': return v.chosen != null ? (v.oppChosen ? '' : '相手を待っています') : (v.oppChosen ? '相手は作戦決定済み' : '');
    case 'roll': return v.mine.rolled ? (v.opp.rolled ? '' : '相手を待っています') : '';
    case 'loading': return ON.role === 'guest' ? 'ホストの端末でAIが作成中' : '';
    default: return '';
  }
}
function vLoading(v, same) {
  if (same && $('#loading').classList.contains('active')) return;
  const vs = v.vs ? vsHTML(v.vs[0], v.vs[1], esc(v.vs[2])) : '';
  loading(v.lines || ['準備中…'], vs);
}
function vHostErr(v) {
  if (ON.role === 'host') return; // ホストはエラー画面
  loading(['ホストの端末でやり直しています…', 'AIの返事を待っています…'], `<p class="vsSub">${esc(v.msg || '')}</p>`);
}
function vDraft(v, same) {
  if (same) return;
  $('#draftKicker').textContent = `${v.round + 1}巡目 / ${ROUNDS}`;
  $('#draftWho').textContent = '相手も同時に選択中';
  const box = $('#cards'); box.innerHTML = ''; box.classList.toggle('locked', v.picked);
  let done = v.picked;
  cancelAnimationFrame(timerId);
  v.cands.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = `card${v.pickedI === i ? ' chosen' : ''}`; b.innerHTML = cardHTML(m);
    b.onclick = () => {
      if (done) return; done = true;
      cancelAnimationFrame(timerId); Sound.setUrgent(false);
      b.classList.add('chosen'); box.classList.add('locked');
      act('pick', i);
    };
    box.appendChild(b);
  });
  $('#myTeam').innerHTML = v.team.map((j) => `<span class="chip">${esc(j)}</span>`).join('');
  show('draft');
  const bar = $('#timerBar'), t0 = performance.now(), dur = Math.max(0, v.msLeft || 0);
  bar.classList.remove('warn'); Sound.setUrgent(false);
  let lastSec = null;
  const tick = (now) => {
    const left = Math.max(0, 1 - (now - t0) / Math.max(1, dur));
    bar.style.transform = `scaleX(${left})`;
    if (done) return;
    const sec = Math.ceil(left * dur / 1000);
    if (sec <= 3 && sec > 0 && sec !== lastSec) { lastSec = sec; Sound.sfx('tick', sec === 1); Sound.setUrgent(true); bar.classList.add('warn'); }
    if (left <= 0) { done = true; Sound.sfx('timeout'); toast('時間切れ！ランダムで決定'); box.classList.add('locked'); return; }
    timerId = requestAnimationFrame(tick);
  };
  timerId = requestAnimationFrame(tick);
}
function vReveal(v, same) {
  const btn = $('#beginBtn');
  if (!same) {
    $('#teamsBox').innerHTML = teamsHTML({ names: v.names, teams: v.teams });
    $('#taskText').textContent = v.task;
    show('reveal');
  }
  btn.disabled = v.ready;
  btn.textContent = v.ready ? '相手を待っています…' : (v.oppReady ? '挑戦スタート（相手は準備OK）' : '挑戦スタート');
  btn.onclick = () => { btn.disabled = true; btn.textContent = '相手を待っています…'; act('ready'); };
}
function vStage(v, same) {
  if (same) return;
  const last = v.stage === STAGES - 1, p = v.me;
  $('#stageKicker').textContent = last ? `最終関門（第${STAGES}関門）` : `第${v.stage + 1}関門`;
  $('#sceneText').textContent = v.scene;
  $('#stageWho').textContent = 'あなたの作戦は？（相手も同時に選んでいます。メンバーの能力は下に）';
  const teamBox = (q, open) => `<details class="team ${q ? 'b' : 'a'}"${open ? ' open' : ''}><summary>${mark(q)} ${esc(v.names[q])}${q === p ? '（自分）' : '（相手）'}のエクストリーマーズ</summary>${
    v.teams[q].map((m) => `<div class="member prof ${m.out ? 'out' : ''}">${cardHTML(m)}${m.out ? '<span class="outTag">退場</span>' : ''}</div>`).join('')}</details>`;
  $('#stageTeams').innerHTML = teamBox(p, true) + teamBox(1 - p, false);
  const box = $('#optionsBox'); box.innerHTML = ''; box.classList.toggle('locked', v.chosen != null);
  let done = v.chosen != null;
  v.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = `btn option${v.chosen === i ? ' chosen' : ''}`;
    const tag = o.kind === KIND.sabotage ? '<em class="tag sab">妨害</em>' : o.kind === KIND.coop ? '<em class="tag coop">共闘</em>' : '';
    b.innerHTML = `<b>${tag}${esc(o.label)}</b><span>${esc(o.detail)}</span>`;
    b.onclick = () => { if (done) return; done = true; b.classList.add('chosen'); box.classList.add('locked'); act('choose', i); };
    box.appendChild(b);
  });
  show('stage');
}
function vRoll(v, same) {
  const r = v.mine, face = $('#dieFace'), verdict = $('#rollVerdict'), btn = $('#rollBtn');
  const oppLine = () => {
    const o = v.opp;
    $('#rollOpp').innerHTML = `${mark(o.p)} ${esc(opp(v))}：作戦「${esc(o.label)}」${o.rolled ? `→ 🎲${o.roll}（${o.rate}以下で成功）<span class="${o.ok ? 'ok' : 'ng'}">${esc(o.grade)}</span> +${o.pts}点` : '…サイコロを振るのを待っています'}`;
  };
  const reveal = () => {
    face.classList.remove('spin'); clearInterval(ON.spin?.iv);
    face.textContent = r.roll;
    verdict.textContent = `${r.grade}！ +${r.pts}点${r.outJob ? `（⚠️${r.outJob}が退場）` : ''}`;
    verdict.className = `rollVerdict ${r.ok ? 'ok' : 'ng'}`;
    Sound.sfx(r.grade === '大成功' ? 'great' : r.ok ? 'ok' : 'ng');
    if (r.outJob) setTimeout(() => Sound.sfx('out'), 450);
    btn.disabled = true; btn.textContent = v.opp.rolled ? 'まもなく結果へ…' : '相手を待っています…';
    ON.spin = { stage: v.stage, shown: true };
  };
  if (!same) {
    $('#rollKicker').textContent = v.stage === STAGES - 1 ? '最終関門' : `第${v.stage + 1}関門`;
    $('#rollTitle').textContent = `${mark(v.me)} あなたの判定`;
    $('#rollPlan').textContent = `作戦：${r.label}`;
    $('#rollWho').innerHTML = `<p class="note" style="margin:0 0 6px">実行するのは…</p>${cardHTML(r.ex)}${r.helpers.map((h) => `<p class="note helpLab">＋加勢</p>${cardHTML(h)}`).join('')}`;
    $('#rollLine').textContent = `${r.rate}以下で成功`;
    $('#rollMods').innerHTML = r.mods.map(([t, x]) => `<span>${esc(t)}${x ? `（${x > 0 ? '+' : '−'}${Math.abs(x)}）` : ''}</span>`).join('');
    face.textContent = '?'; face.classList.remove('spin'); verdict.textContent = ''; verdict.className = 'rollVerdict';
    ON.spin = { stage: v.stage, shown: false };
    btn.disabled = false; btn.textContent = 'サイコロを振る';
    btn.onclick = () => {
      if (ON.spin.t0) return;
      btn.disabled = true; btn.textContent = '…';
      startSpin(); act('roll');
    };
    show('roll');
  }
  oppLine();
  if (r.rolled && !ON.spin.shown) {
    if (!ON.spin.t0) startSpin();
    const wait = Math.max(0, 1100 - (Date.now() - ON.spin.t0));
    clearTimeout(ON.spin.to); ON.spin.to = setTimeout(reveal, wait);
  } else if (r.rolled && ON.spin.shown) btn.textContent = v.opp.rolled ? 'まもなく結果へ…' : '相手を待っています…';
  function startSpin() {
    ON.spin.t0 = Date.now();
    face.classList.add('spin'); Sound.sfx('spin');
    ON.spin.iv = setInterval(() => { face.textContent = rnd(100); }, 60);
  }
}
function vResult(v, same) {
  const btn = $('#resultNext');
  if (!same) {
    $('#resultKicker').textContent = v.final ? '最終関門の結果' : `第${v.stage + 1}関門の結果`;
    $('#resultBox').innerHTML = v.rs.map((r) => `<div class="res ${r.p ? 'b' : 'a'}"><h3>${mark(r.p)} ${esc(v.names[r.p])}：${esc(r.label)}</h3>
      <div class="dice">実行：${esc(r.crew)}｜🎲${r.roll}（${r.rate}以下で成功）→ <span class="${r.ok ? 'ok' : 'ng'}">${esc(r.grade)}</span> +${r.pts}点${r.out ? `｜⚠️${esc(r.outJob)}が退場` : ''}</div><p>${esc(r.text)}</p></div>`).join('');
    $('#scoreBox').innerHTML = scoreHTML();
    show('result');
  }
  const label = v.final ? '決着を見る' : v.stage + 2 === STAGES ? '最終関門へ' : `第${v.stage + 2}関門へ`;
  btn.disabled = v.ready;
  btn.textContent = v.ready ? '相手を待っています…' : v.oppReady ? `${label}（相手は準備OK）` : label;
  btn.onclick = () => { btn.disabled = true; btn.textContent = '相手を待っています…'; act('ready'); };
}
function vFinal(v, same) {
  if (same) return;
  const w = v.win.w;
  const how = v.win.how === 'コイントス' ? '（同点・最終関門も互角のためコイントス）' : v.win.how === '最終関門' ? '（同点・最終関門の得点で決着）' : '';
  $('#winnerText').textContent = w === v.me ? `🏆 あなたの勝ち！` : `🏆 ${v.names[w]}の勝ち！`;
  $('#epilogueText').textContent = `${v.epilogue || ''}${how ? '\n' + how : ''}`;
  $('#finalScore').innerHTML = scoreHTML();
  $('#rateNote').textContent = '';
  const again = $('#againBtn');
  again.textContent = 'ルームに戻る（再戦）';
  again.onclick = () => {
    setBar(false);
    if (ON.role === 'host') {
      Host.reset();
      Net.ctx.F.updateDoc(ref('rooms', ON.code), { status: 'wait', pub: '', ga: null }).catch(() => {});
    }
    show('lobby'); renderLobby();
  };
  show('final');
  finishOnline(v);
}
async function finishOnline(v) {
  if (ON.done.has(v.matchId)) return;
  ON.done.add(v.matchId);
  const me = v.me, won = v.win.w === me;
  saveLog({
    at: Date.now(), mode: 'online', names: v.names, task: v.task, scores: v.scores, winner: v.win.w, how: v.win.how,
    teams: v.teams.map((t) => t.map((m) => ({ job: m.job, income: m.income, hobby: m.hobby, skill: m.skill, weak: m.weak || '', ath: m.ath, prop: m.prop || '', out: m.out }))),
    stages: v.log, epilogue: v.epilogue || '',
  });
  Dex.record({ seen: [...(v.seen || []), ...v.teams[1 - me]], picked: v.teams[me], wonPicked: won ? v.teams[me] : [] });
  // レート（イロレーティング、K=32）
  try {
    const { F, db, uid } = Net.ctx;
    const oppUid = v.uids[1 - me];
    let m = null;
    for (let i = 0; i < 5 && !m; i++) { // ホストが試合の記録を書くのを待つ
      const s = await F.getDoc(ref('matches', v.matchId));
      if (s.exists()) m = s.data(); else await new Promise((r) => setTimeout(r, 1200));
    }
    if (!m) throw new Error('試合の記録が見つかりません');
    if (m.counted && m.counted[uid]) return;
    const [ms, os] = await Promise.all([F.getDoc(ref('users', uid)), F.getDoc(ref('users', oppUid))]);
    const P = ms.data(), O = os.data() || {};
    const R = P.rating ?? 1000, Ro = O.rating ?? 1000;
    const E = 1 / (1 + 10 ** ((Ro - R) / 400));
    const delta = Math.max(-40, Math.min(40, Math.round(32 * ((won ? 1 : 0) - E))));
    const b = F.writeBatch(db);
    const upd = { rating: R + delta, games: P.games + 1, wins: P.wins + (won ? 1 : 0), losses: P.losses + (won ? 0 : 1), lastMatch: v.matchId };
    b.update(ref('users', uid), upd);
    b.update(ref('matches', v.matchId), { [`counted.${uid}`]: true });
    await b.commit();
    Object.assign(Net.profile, upd);
    $('#rateNote').textContent = `レート ${R} → ${R + delta}（${delta >= 0 ? '+' : '−'}${Math.abs(delta)}）`;
  } catch (e) { $('#rateNote').textContent = `レートを記録できませんでした：${e.code ? errText(e) : e.message}`; }
}

/* ---------- つなぎ ---------- */
$('#openOnline').onclick = openOnline;
$('#openDex').onclick = showDex;
$('#rankBack').onclick = () => openOnline();
$('#friendsBack').onclick = () => (ON.code ? (show('lobby'), renderLobby()) : openOnline());
// 招待リンク（?room=CODE）から開いたら、そのまま参加する
(() => {
  const code = new URLSearchParams(location.search).get('room');
  if (code && Net.configured()) Net.start().then(() => joinRoom(code)).catch((e) => toast(errText(e)));
  else if (Net.configured()) Net.start().catch(() => {}); // 招待・申請の通知を受け取るために先に接続
})();
