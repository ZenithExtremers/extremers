'use strict';
/* EXTREMERS サウンド：BGMと効果音をWeb Audioでその場で合成する（音声ファイルなし） */
const Sound = (() => {
  const KEY = 'ext_sound';
  const st = (() => { try { return { on: true, bgm: 0.6, sfx: 0.8, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { on: true, bgm: 0.6, sfx: 0.8 }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  let ctx = null, master, bgmBus, sfxBus, noiseBuf;
  let song = null;          // { scene, style, gain, step, next, bpm }
  let want = { scene: 'title', style: 'electro', final: false };
  let urgent = false, loopId = null;

  /* ---------- 基本 ---------- */
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = st.on ? 1 : 0;
    bgmBus = ctx.createGain(); bgmBus.gain.value = st.bgm * 1.3;
    sfxBus = ctx.createGain(); sfxBus.gain.value = st.sfx * 1.0;
    bgmBus.connect(comp); sfxBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch {} }
    if (!song) play(want.scene, want.style, want.final);
  }

  function tone(dest, t, freq, dur, o = {}) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const v = o.vol ?? 0.1, a = o.attack ?? 0.005, r = o.release ?? 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, t + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.cut) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cut; f.Q.value = o.q ?? 0.7; osc.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function noise(dest, t, dur, o = {}) {
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf;
    f.type = o.type || 'highpass'; f.frequency.value = o.freq || 6000;
    g.gain.setValueAtTime(o.vol ?? 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t); src.stop(t + dur + 0.02);
  }
  function kick(dest, t, vol = 0.5) { tone(dest, t, 140, 0.22, { type: 'sine', slide: 40, vol, attack: 0.002, release: 0.15 }); }
  function snare(dest, t, vol = 0.12) { noise(dest, t, 0.14, { type: 'bandpass', freq: 1800, vol }); tone(dest, t, 190, 0.08, { type: 'triangle', vol: vol * 0.6 }); }
  function hat(dest, t, vol = 0.03, len = 0.04) { noise(dest, t, len, { freq: 7000, vol }); }

  /* ---------- 曲調（お題に合わせて選ぶ） ---------- */
  const CH = { // 根音からの半音
    i: [0, 3, 7], III: [3, 7, 10], iv: [5, 8, 12], V: [7, 11, 14], VI: [8, 12, 15], VII: [10, 14, 17],
    I: [0, 4, 7], ii: [2, 5, 9], IV: [5, 9, 12], vi: [9, 12, 16],
  };
  const STYLES = {
    spy:     { root: 50, lead: 'sawtooth', leadCut: 1500, pad: 'sawtooth', padCut: 650, bass: 'triangle', bassCut: 900, tempo: 1.0, swing: 0, drums: 'brush',
               minor: ['i', 'VI', 'iv', 'V'], major: ['I', 'vi', 'IV', 'V'] },
    electro: { root: 45, lead: 'square', leadCut: 2600, pad: 'sawtooth', padCut: 1100, bass: 'sawtooth', bassCut: 420, tempo: 1.08, swing: 0, drums: 'club',
               minor: ['i', 'VII', 'VI', 'VII'], major: ['I', 'V', 'vi', 'IV'] },
    retro:   { root: 48, lead: 'square', leadCut: 9000, pad: 'square', padCut: 2400, bass: 'triangle', bassCut: 4000, tempo: 1.05, swing: 0, drums: 'chip',
               minor: ['i', 'VI', 'III', 'VII'], major: ['I', 'V', 'vi', 'IV'] },
    comic:   { root: 53, lead: 'triangle', leadCut: 6000, pad: 'triangle', padCut: 3000, bass: 'square', bassCut: 500, tempo: 0.95, swing: 0.16, drums: 'chip',
               minor: ['i', 'iv', 'V', 'i'], major: ['I', 'IV', 'V', 'I'] },
  };

  /* ---------- 場面ごとの曲 ---------- */
  const SCENES = {
    title: { bpm: 86, mode: (s) => (s === 'comic' || s === 'retro' ? 'major' : 'minor') },
    draft: { bpm: 146, mode: (s) => (s === 'comic' ? 'major' : 'minor') },
    stage: { bpm: 104, mode: () => 'minor' },
    win:   { bpm: 118, mode: () => 'major' },
    lose:  { bpm: 66,  mode: () => 'minor' },
  };
  function drums(sty, out, t, pos, lvl) {
    if (sty.drums === 'club') {
      if (lvl >= 2 && pos % 4 === 0) kick(out, t, 0.45);
      if (lvl >= 2 && (pos === 4 || pos === 12)) snare(out, t, 0.08);
      if (lvl >= 1 && pos % 2 === 1) hat(out, t, 0.025);
    } else if (sty.drums === 'chip') {
      if (lvl >= 2 && (pos === 0 || pos === 8)) tone(out, t, 110, 0.08, { type: 'square', slide: 50, vol: 0.12 });
      if (lvl >= 2 && (pos === 4 || pos === 12)) noise(out, t, 0.08, { freq: 2500, vol: 0.06 });
      if (lvl >= 1 && pos % 4 === 2) noise(out, t, 0.02, { freq: 9000, vol: 0.03 });
    } else { // brush
      if (lvl >= 1 && pos % 2 === 0) hat(out, t, 0.018, 0.07);
      if (lvl >= 2 && (pos === 4 || pos === 12)) noise(out, t, 0.12, { type: 'bandpass', freq: 2200, vol: 0.05 });
      if (lvl >= 3 && pos % 4 === 0) kick(out, t, 0.35);
    }
  }
  function stepMusic(t, s) {
    const sty = STYLES[song.style], sc = song.scene, out = song.gain;
    const pos = s % 16, bar = Math.floor(s / 16);
    const prog = sty[SCENES[sc].mode(song.style)];
    const ch = CH[prog[bar % 4]].map((x) => x + sty.root);
    const L = (n, dur, vol, oct = 12) => tone(out, t, hz(n + oct), dur, { type: sty.lead, cut: sty.leadCut, vol });
    const B = (n, dur, vol) => tone(out, t, hz(n - 12), dur, { type: sty.bass, cut: sty.bassCut, vol });
    const P = (dur, vol) => ch.forEach((n, k) => tone(out, t, hz(n), dur, { type: sty.pad, cut: sty.padCut, vol, attack: 0.25, release: 0.4, detune: (k - 1) * 6 }));
    const sixteenth = 60 / song.bpm / 4;

    if (sc === 'title') {
      if (pos === 0) P(sixteenth * 16, 0.035);
      if (pos === 0 || pos === 8) B(ch[0], sixteenth * 7, 0.11);
      if ([0, 6, 10, 14].includes(pos) && bar % 2 === 1) L(ch[[0, 1, 2, 1][[0, 6, 10, 14].indexOf(pos)]], sixteenth * 3, 0.035);
      drums(sty, out, t, pos, 1);
    } else if (sc === 'draft') {
      if (pos % 2 === 0) B(pos % 4 === 0 ? ch[0] : ch[0] + 12, sixteenth * 1.6, 0.12);
      if (pos % 2 === 0) L(ch[(pos / 2) % 3] + (pos >= 8 ? 12 : 0), sixteenth * 1.4, 0.035);
      drums(sty, out, t, pos, urgent ? 3 : 2);
      if (urgent && pos % 4 === 0) snare(out, t, 0.06);
    } else if (sc === 'stage') {
      const fin = song.final;
      const pat = [0, 0, 12, 0, 7, 0, 12, 0];
      if (pos % 2 === 0) B(ch[0] + pat[pos / 2], sixteenth * 1.7, 0.12);
      if (pos === 0) P(sixteenth * 16, 0.028);
      if ([0, 3, 6, 10, 13].includes(pos)) L(ch[2] + (fin && pos > 8 ? 12 : 0), sixteenth * 0.9, fin ? 0.04 : 0.03);
      drums(sty, out, t, pos, fin ? 3 : 1);
      if (fin && pos % 4 === 0 && sty.drums !== 'club') kick(out, t, 0.35);
    } else if (sc === 'win') {
      if (bar < 2) {
        const seq = bar === 0 ? [0, 4, 7, 12] : [7, 11, 14, 19];
        if (pos % 2 === 0 && pos < 8) L(sty.root + seq[pos / 2], sixteenth * 2, 0.06);
        if (pos === 8) L(sty.root + seq[3], sixteenth * 8, 0.06);
        if (pos === 0) P(sixteenth * 16, 0.04);
        if (pos % 4 === 0) kick(out, t, 0.3);
      } else {
        if (pos === 0) P(sixteenth * 16, 0.03);
        if (pos % 4 === 0) B(ch[0], sixteenth * 3, 0.1);
        if ([0, 4, 8, 12].includes(pos)) L(ch[(pos / 4) % 3] + 12, sixteenth * 2, 0.03);
        drums(sty, out, t, pos, 2);
      }
    } else if (sc === 'lose') {
      if (pos === 0) P(sixteenth * 16, 0.035);
      if (pos === 0) B(ch[0], sixteenth * 15, 0.09);
      if (pos === 0 || pos === 8) L(ch[pos ? 1 : 2] - (bar % 2) * 2, sixteenth * 7, 0.03);
    }
  }
  function loop() {
    if (!song || !ctx) return;
    const ahead = ctx.currentTime + 0.15;
    while (song.next < ahead) {
      const s = song.step, sty = STYLES[song.style];
      const sw = s % 2 === 1 ? sty.swing * (60 / song.bpm / 4) : 0;
      stepMusic(song.next + sw, s);
      song.step++;
      song.next += 60 / song.bpm / 4;
    }
  }
  function stopSong(fade = 0.3) {
    if (!song) return;
    const g = song.gain, t = ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => g.disconnect(), (fade + 0.2) * 1000);
    song = null;
  }
  function play(scene, style = 'electro', final = false) {
    want = { scene, style, final };
    if (!ctx) return; // 最初のタップまで待つ
    if (song && song.scene === scene && song.style === style && song.final === final) return;
    stopSong();
    urgent = false;
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(bgmBus);
    const lvl = { title: 1.6, draft: 1.1, stage: final ? 1.0 : 1.5, win: 0.9, lose: 1.8 }[scene] || 1;
    g.gain.linearRampToValueAtTime(lvl, ctx.currentTime + 0.4);
    const sty = STYLES[style] || STYLES.electro;
    song = { scene, style: STYLES[style] ? style : 'electro', final, gain: g, step: 0, next: ctx.currentTime + 0.08,
             bpm: SCENES[scene].bpm * sty.tempo * (scene === 'stage' && final ? 1.18 : 1) };
    if (!loopId) loopId = setInterval(loop, 25);
  }
  function setUrgent(on) {
    if (!song || song.scene !== 'draft' || urgent === on) return;
    urgent = on;
    song.bpm = SCENES.draft.bpm * STYLES[song.style].tempo * (on ? 1.3 : 1);
  }

  /* ---------- 効果音 ---------- */
  function sfx(name, opt) {
    if (!ctx || !st.on) return;
    const t = ctx.currentTime + 0.01, o = sfxBus;
    switch (name) {
      case 'click': tone(o, t, 900, 0.05, { type: 'square', vol: 0.05, cut: 3000 }); break;
      case 'tick': tone(o, t, opt ? 1500 : 1100, 0.06, { type: 'square', vol: 0.1, cut: 4000 }); break;
      case 'timeout': tone(o, t, 220, 0.35, { type: 'sawtooth', slide: 110, vol: 0.12, cut: 1200 }); break;
      case 'spin':
        for (let i = 0; i < 16; i++) {
          const tt = t + i * 0.065 * (1 + i * 0.02);
          noise(o, tt, 0.03, { type: 'bandpass', freq: 1500 + Math.random() * 2500, vol: 0.12 });
        }
        break;
      case 'ok': [0, 4, 7, 12].forEach((n, i) => tone(o, t + i * 0.07, hz(72 + n), 0.18, { type: 'square', vol: 0.07, cut: 5000 })); break;
      case 'great': [0, 4, 7, 12, 16, 19].forEach((n, i) => tone(o, t + i * 0.06, hz(72 + n), 0.2, { type: 'square', vol: 0.07, cut: 6000 })); break;
      case 'ng': tone(o, t, 330, 0.18, { type: 'sawtooth', vol: 0.09, cut: 1400 }); tone(o, t + 0.18, 247, 0.35, { type: 'sawtooth', slide: 180, vol: 0.09, cut: 1200 }); break;
      case 'out': tone(o, t, 120, 0.5, { type: 'square', slide: 50, vol: 0.12, cut: 800 }); break;
    }
  }

  /* ---------- 設定 ---------- */
  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(st.on ? 1 : 0, t, 0.05);
    bgmBus.gain.setTargetAtTime(st.bgm * 1.3, t, 0.05);
    sfxBus.gain.setTargetAtTime(st.sfx * 1.0, t, 0.05);
  }
  function toggle() { st.on = !st.on; save(); unlock(); apply(); return st.on; }
  function setVol(kind, v) { st[kind] = Math.max(0, Math.min(1, v)); save(); apply(); }

  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  function _fill(sec) { if (song) while (song.next < sec) { const st0 = song.step; stepMusic(song.next, st0); song.step++; song.next += 60 / song.bpm / 4; } }
  return { _fill, play, setUrgent, sfx, toggle, setVol, get on() { return st.on; }, get bgm() { return st.bgm; }, get sfxVol() { return st.sfx; } };
})();
