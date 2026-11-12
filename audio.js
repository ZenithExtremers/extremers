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
  /* ---------- お題ごとの曲（ドラフト・関門用） ---------- */
  let curve = null;
  function dist() { // 音ごとに新しい歪みを作る（共有すると他の音とまざってしまう）
    if (!curve) { const n = 1024; curve = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 6); } }
    const sh = ctx.createWaveShaper(); sh.curve = curve; sh.oversample = '2x';
    return sh;
  }
  function voice(dest, t, freq, dur, o = {}) { // 何本かのオシレーター＋フィルター＋エンベロープ
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = o.ftype || 'lowpass'; f.frequency.value = o.cut || 3000; f.Q.value = o.q ?? 0.8;
    if (o.fenv) { f.frequency.setValueAtTime(o.cut * 0.3, t); f.frequency.exponentialRampToValueAtTime(o.cut, t + o.fenv); }
    const v = o.vol ?? 0.08, a = o.attack ?? 0.005, r = o.release ?? 0.08;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    if (o.decay) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * (o.sustain ?? 0.2)), t + Math.min(a + o.decay, dur * 0.95));
    else g.gain.setValueAtTime(v, t + Math.max(a, dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const freqs = o.stack || [0];
    let lfo = null;
    if (o.vib) { lfo = ctx.createOscillator(); lfo.frequency.value = o.vibRate || 5.5; const lg = ctx.createGain(); lg.gain.value = freq * o.vib; lfo.connect(lg); lfo.start(t); lfo.stop(t + dur + 0.05); o._lg = lg; }
    freqs.forEach((semi, k) => {
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sawtooth';
      const fr = freq * Math.pow(2, semi / 12);
      osc.frequency.setValueAtTime(fr, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide * Math.pow(2, semi / 12), t + (o.slideT || dur));
      osc.detune.value = (o.spread || 0) * (k % 2 ? 1 : -1);
      if (o._lg) o._lg.connect(osc.frequency);
      osc.connect(f); osc.start(t); osc.stop(t + dur + 0.05);
    });
    if (o.drive) { const d = dist(), pre = ctx.createGain(); pre.gain.value = o.drive; f.connect(pre); pre.connect(d); const post = ctx.createGain(); post.gain.value = 1; d.connect(post); post.connect(g); }
    else f.connect(g);
    g.connect(dest);
  }
  function inst(out, t, s16) {
    const N = (m) => hz(m);
    return {
      gtr: (notes, len, vol = 0.05) => notes.forEach((m) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 7, 12], cut: 2600, drive: 4, vol, decay: s16 * len * 0.8, sustain: 0.5 })),
      mute: (m, vol = 0.05) => voice(out, t, N(m), s16 * 0.9, { type: 'sawtooth', stack: [0, 7], cut: 900, drive: 3, vol, decay: s16 * 0.6, sustain: 0.1 }),
      brass: (notes, len, vol = 0.05) => notes.forEach((m) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 0.1], spread: 8, cut: 2400, fenv: 0.08, attack: 0.03, vol })),
      str: (m, len, vol = 0.035) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 0.08], spread: 10, cut: 3000, attack: 0.01, decay: s16 * len * 0.7, sustain: 0.3, vol }),
      pad: (notes, len, vol = 0.03, cut = 1400) => notes.forEach((m) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 0.1], spread: 12, cut, attack: s16 * 3, release: s16 * 3, vol })),
      choir: (notes, len, vol = 0.03) => notes.forEach((m) => voice(out, t, N(m), s16 * len, { type: 'triangle', stack: [0, 12], spread: 9, cut: 1800, attack: s16 * 4, release: s16 * 4, vol, vib: 0.004 })),
      piano: (m, len, vol = 0.06) => voice(out, t, N(m), s16 * len, { type: 'triangle', stack: [0, 12], cut: 4500, attack: 0.003, decay: 0.5, sustain: 0.15, vol }),
      pluck: (m, vol = 0.05) => voice(out, t, N(m), s16 * 2.5, { type: 'triangle', stack: [0, 12], cut: 5000, attack: 0.002, decay: 0.12, sustain: 0.05, vol }),
      bell: (m, vol = 0.04) => voice(out, t, N(m), 1.2, { type: 'sine', stack: [0, 19, 28], cut: 9000, attack: 0.002, decay: 0.6, sustain: 0.05, vol }),
      whistle: (m, len, vol = 0.04) => voice(out, t, N(m), s16 * len, { type: 'sine', cut: 8000, attack: 0.02, vol, vib: 0.008, vibRate: 6 }),
      accord: (notes, len, vol = 0.03) => notes.forEach((m) => voice(out, t, N(m), s16 * len, { type: 'square', stack: [0, 0.12], spread: 6, cut: 2200, attack: 0.02, vol })),
      sax: (m, len, vol = 0.05) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', ftype: 'bandpass', cut: 1300, q: 1.2, attack: 0.03, vol, vib: 0.006 }),
      vibes: (notes, vol = 0.035) => notes.forEach((m) => voice(out, t, N(m), 0.9, { type: 'sine', stack: [0, 12], cut: 6000, attack: 0.003, decay: 0.5, sustain: 0.1, vol, vib: 0.01, vibRate: 7 })),
      pizz: (m, vol = 0.12) => voice(out, t, N(m), 0.35, { type: 'triangle', stack: [0, 0], cut: 900, attack: 0.003, decay: 0.2, sustain: 0.1, vol, slide: N(m) * 0.98, slideT: 0.1 }),
      bass: (m, len, vol = 0.1, cut = 700) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', cut, attack: 0.004, decay: s16 * len * 0.8, sustain: 0.5, vol }),
      fuzz: (m, len, vol = 0.07) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 12], cut: 1500, drive: 8, vol, decay: s16 * len * 0.9, sustain: 0.6 }),
      sub: (m, len, vol = 0.22, to) => voice(out, t, N(m), s16 * len, { type: 'sine', cut: 400, attack: 0.004, vol, slide: to ? N(to) : undefined, slideT: s16 * 2, decay: s16 * len, sustain: 0.6 }),
      drone: (m, len, vol = 0.05) => voice(out, t, N(m), s16 * len, { type: 'sawtooth', stack: [0, 0.07, 12], spread: 7, cut: 380, attack: s16 * 4, release: s16 * 4, vol }),
      kick: (v = 0.45) => kick(out, t, v),
      snare: (v = 0.1) => snare(out, t, v),
      clap: (v = 0.1) => { noise(out, t, 0.12, { type: 'bandpass', freq: 1300, vol: v }); noise(out, t + 0.012, 0.1, { type: 'bandpass', freq: 1300, vol: v * 0.7 }); },
      hat: (v = 0.025) => hat(out, t, v),
      ohat: (v = 0.03) => hat(out, t, v, 0.2),
      crash: (v = 0.06) => noise(out, t, 1.4, { freq: 4500, vol: v }),
      shaker: (v = 0.015) => noise(out, t, 0.05, { type: 'bandpass', freq: 8000, vol: v }),
      snap: (v = 0.08) => noise(out, t, 0.04, { type: 'bandpass', freq: 2800, vol: v }),
      tick: (v = 0.06) => tone(out, t, 3200, 0.02, { type: 'square', vol: v, cut: 8000 }),
      tom: (f = 120, v = 0.25) => tone(out, t, f, 0.3, { type: 'sine', slide: f * 0.55, vol: v, attack: 0.002, release: 0.25 }),
      taiko: (v = 0.5) => { tone(out, t, 75, 0.6, { type: 'sine', slide: 42, vol: v, attack: 0.002, release: 0.5 }); noise(out, t, 0.15, { type: 'lowpass', freq: 500, vol: v * 0.3 }); },
      hit: (v = 0.4) => { tone(out, t, 55, 1.2, { type: 'sawtooth', slide: 35, vol: v * 0.4, cut: 300 }); kick(out, t, v); noise(out, t, 0.8, { type: 'lowpass', freq: 1200, vol: v * 0.2 }); },
      whisper: (dur, v = 0.03) => { const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(2600, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t + dur); src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + dur + 0.05); },
      scratch: (v = 0.06) => { const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); src.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = 8; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3500, t + 0.06); f.frequency.exponentialRampToValueAtTime(500, t + 0.14); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + 0.2); },
      ping: (m, v = 0.05) => { voice(out, t, N(m), 1.5, { type: 'sine', cut: 6000, attack: 0.002, decay: 1.2, sustain: 0.05, vol: v }); voice(out, t + 0.35, N(m), 1.2, { type: 'sine', cut: 6000, attack: 0.002, decay: 1, sustain: 0.05, vol: v * 0.4 }); },
      riser: (len, v = 0.03) => voice(out, t, 200, s16 * len, { type: 'sawtooth', cut: 4000, attack: s16 * len * 0.9, release: 0.05, vol: v, slide: 1600, slideT: s16 * len }),
    };
  }
  const SC = { min: [0, 2, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11], dor: [0, 2, 3, 5, 7, 9, 10], phr: [0, 1, 3, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10], maj: [0, 2, 4, 5, 7, 9, 11] };
  const deg = (scale, root, d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const triad = (scale, root, d) => [deg(scale, root, d), deg(scale, root, d + 2), deg(scale, root, d + 4)];
  // 各お題の曲。lvl：1＝関門、2＝ドラフト、3＝最終関門・ドラフト残り3秒
  const GROOVES = {
    assassin: { bpm: 132, root: 40, sc: 'min', prog: [0, 0, 5, 4], base: 'spy', fn(h) { // サーフロック風の大見得
      const { p, b, I, lvl, R } = h, riff = [0, 0, 3, 0, 5, 0, 6, 5];
      if (p % 2 === 0) I.bass(R + riff[p / 2] - 12, 1.8, 0.11, 900);
      if ([0, 6, 10].includes(p)) I.gtr([R + 12], p === 0 ? 5 : 3, 0.045);
      if (p === 14 && b % 2) I.brass([R + 24, R + 31], 2, 0.05);
      if (p === 0 || p === 8 || (lvl >= 2 && p === 11)) I.kick();
      if (p === 4 || p === 12) I.snare(0.1);
      if (p % 2 === 0) I.hat(0.02);
      if (lvl >= 3 && p === 0 && b % 2 === 0) I.crash(0.05);
      if (lvl >= 3 && b % 4 === 3 && p >= 12) I.tom(140 - (p - 12) * 15, 0.22);
    } },
    guard: { bpm: 120, root: 50, sc: 'min', prog: [0, 5, 2, 6], base: 'spy', fn(h) { // 壮大な防衛戦
      const { p, I, lvl, C } = h;
      if (p % 2 === 0) I.str(C[(p / 2) % 3] + 12, 1.6, 0.03);
      if (p === 0) { I.brass([C[0] - 12, C[1] - 12], 16, 0.04); I.choir(C, 16, 0.02); }
      if (p === 0 || p === 10) I.tom(90, 0.3);
      if (lvl >= 2 && p % 4 === 0) I.kick(0.3);
      if (lvl >= 3 && p >= 8) I.snare(0.04 + (p - 8) * 0.006);
      if (lvl >= 3 && p === 0) I.crash(0.04);
    } },
    escape: { gain: 1.7, bpm: 150, root: 45, sc: 'harm', prog: [0, 5, 3, 4], base: 'electro', fn(h) { // 疑いから逃走へ
      const { p, I, lvl, R, C } = h;
      I.bass(R - 12, 0.9, 0.08, 500 + lvl * 200);
      if (p % 4 === 0) I.tick(0.05);
      if (p === 0 && h.b % 2 === 0) I.pad([C[0], C[0] + 7], 32, 0.014, 800); // 半音ぶつけの「ファー」をやめて、低く柔らかい5度に
      if (lvl >= 2) { if ([0, 7, 10].includes(p)) I.kick(0.4); if (p === 4 || p === 12) I.snare(0.09); I.hat(p % 2 ? 0.02 : 0.012); }
      if (lvl >= 3 && p % 2 === 0) I.str(C[(p / 2) % 3] + 12, 1, 0.022);
    } },
    bomb: { bpm: 128, root: 38, sc: 'min', prog: [0, 0, 5, 6], base: 'electro', fn(h) { // 時限爆弾の刻み
      const { p, b, I, lvl, C } = h, os = [0, 12, 7, 12, 3, 12, 7, 12];
      I.str(C[0] + os[p % 8] + 12, 0.9, 0.028 + lvl * 0.004);
      if (p % 2 === 0) I.tick(0.05);
      if (p === 0 && b % 2 === 0) I.hit(0.35);
      if (lvl >= 2 && (p === 0 || p === 8)) I.taiko(0.35);
      if (lvl >= 3) { if (p % 2 === 0) I.snare(0.035); if (p === 0 && b % 4 === 3) I.riser(64, 0.025); }
    } },
    vault: { gain: 1.3, bpm: 140, root: 41, sc: 'min', prog: [0, 5, 3, 4], base: 'electro', fn(h) { // トラップで金庫破り
      const { p, b, I, lvl, R, C } = h;
      if (p === 0) I.sub(R - 12, 5, 0.24); if (p === 6) I.sub(R - 12, 3, 0.2, R - 5); if (p === 10) I.sub(R - 9, 5, 0.2);
      if (p === 8) I.clap(0.11);
      I.hat(p % 4 === 0 ? 0.025 : 0.014);
      if (b % 2 && p >= 12) I.hat(0.02);
      if ([0, 3, 6, 11].includes(p) && b % 2 === 0) I.pluck(C[(p % 3)] + 24, 0.04);
      if (lvl >= 3 && p % 2 && p > 8) I.hat(0.02);
      if (lvl >= 2 && p === 0) I.kick(0.4);
    } },
    hostage: { gain: 1.2, bpm: 84, root: 38, sc: 'min', prog: [0, 5, 6, 4], base: 'spy', fn(h) { // 深い海の底のような緊張
      const { p, b, I, lvl, C, R } = h;
      if (p === 0 && b % 2 === 0) I.drone(R - 12, 32, 0.05);
      if (p === 0 && b % 2 === 1) I.ping(R + 31, 0.035);
      if (p === 0 || p === 3) I.kick(p ? 0.18 : 0.28);
      if ([4, 10].includes(p)) I.piano(C[p === 4 ? 1 : 2] + 12, 6, 0.03);
      if (lvl >= 2 && p % 2 === 0) I.bass(C[0] - 12, 1.6, 0.07, 500);
      if (lvl >= 3 && p % 4 === 2) I.str(C[2] + 12, 1.5, 0.025);
    } },
    traitor: { bpm: 126, root: 50, sc: 'dor', prog: [0, 6, 3, 0], base: 'retro', fn(h) { // ケルト・パンク
      const { p, b, I, lvl, C, S2 } = h, mel = [0, 2, 4, 2, 0, -1, 0, 4];
      if (p % 2 === 0) I.mute(C[0] - 12, 0.04);
      if (p % 2 === 0) I.whistle(S2(mel[(p / 2 + b) % 8] + (b % 2 ? 7 : 7)) + 12, 1.8, 0.035);
      if (p % 4 === 2) I.accord(C.map((x) => x + 12), 1.5, 0.018);
      if (p === 0 || p === 6 || p === 8) I.kick(0.4);
      if (p === 4 || p === 12) I.snare(0.1);
      if (p % 2 === 0) I.ohat(0.02);
      if (lvl >= 3 && p === 14 && b % 2) I.clap(0.14);
    } },
    weapon: { gain: 1.4, bpm: 90, root: 40, sc: 'phr', prog: [0, 1, 0, 4], base: 'electro', fn(h) { // 悪魔のささやき
      const { p, b, I, lvl, R } = h;
      if (p === 0 && b % 2 === 0) I.drone(R - 12, 32, 0.05);
      if (p === 0 && b % 2 === 1) I.whisper(60 / 90 * 4, 0.035);
      if ([2, 5, 11].includes(p)) I.bell(R + 24 + [0, 1, 6][[2, 5, 11].indexOf(p)] + (b % 2 ? 0 : 12), 0.025);
      if (p === 0 || p === 2) I.kick(0.2);
      if (lvl >= 2 && p === 8) I.hit(0.2);
      if (lvl >= 3 && p % 4 === 0) I.fuzz(R - 12, 2, 0.04);
    } },
    pursuit: { bpm: 112, root: 38, sc: 'harm', prog: [0, 0, 5, 4], base: 'spy', fn(h) { // 悪の軍勢の行進
      const { p, I, lvl, C, R } = h;
      if ([0, 2, 3, 4, 6, 8, 10, 11, 12, 14].includes(p)) I.snare(p % 4 === 0 ? 0.08 : 0.04);
      if (p % 4 === 0) I.kick(0.35);
      if (p % 2 === 0) I.brass([[R - 12, R - 12, R - 11, R - 12][(p / 2) % 4]], 1.6, 0.05);
      if (p === 0) I.choir(C, 16, 0.02);
      if (lvl >= 3 && p === 0) I.crash(0.05);
      if (lvl >= 2 && p === 8) I.taiko(0.3);
    } },
    mastermind: { gain: 1.6, bpm: 72, root: 37, sc: 'min', prog: [0, 5, 0, 1], base: 'spy', fn(h) { // 闇に潜む者
      const { p, b, I, lvl, C, R } = h;
      if (p === 0) I.drone(R - 12, 16, 0.05);
      if (p === 0 && b % 2 === 0) I.piano(R, 14, 0.05);
      if (p === 9 && b % 2) I.bell(R + 30, 0.02);
      if (p === 0) I.pad(C, 16, 0.02, 700);
      if (lvl >= 2 && p % 2 === 0) I.bass(R - 12, 1.5, 0.06, 300);
      if (lvl >= 3) { if (p === 0 || p === 3) I.kick(0.25); if (p % 2 === 0) I.str(C[1] + 12, 1, 0.02); }
    } },
    infiltrate: { gain: 1.4, bpm: 96, root: 45, sc: 'dor', prog: [0, 3, 6, 4], base: 'retro', fn(h) { // 遺跡を探る
      const { p, I, lvl, C } = h;
      I.pluck(C[[0, 1, 2, 1][p % 4]] + 12 + (p >= 8 ? 12 : 0), 0.035);
      I.shaker(p % 2 ? 0.012 : 0.02);
      if (p === 0 || p === 10) I.tom(150, 0.18);
      if (p === 0) I.pad(C, 16, 0.02, 1100);
      if (lvl >= 2 && p % 4 === 0) I.bass(C[0] - 12, 3, 0.08, 600);
      if (lvl >= 3 && (p === 4 || p === 12)) I.snare(0.07);
    } },
    riot: { bpm: 168, root: 40, sc: 'min', prog: [0, 0, 6, 5], base: 'electro', fn(h) { // 大暴れ
      const { p, b, I, lvl, R } = h, riff = [0, 0, 12, 0, 10, 0, 7, 3];
      if (p % 2 === 0) I.fuzz(R + riff[p / 2] - 12, 1.8, 0.06);
      if ([0, 3, 8, 10].includes(p)) I.kick(0.45);
      if (p === 4 || p === 12) I.snare(0.12);
      if (b % 4 === 3 && p >= 8) I.snare(0.07);
      I.hat(0.018);
      if (p === 0) I.crash(0.04);
      if (p === 14 && b % 2) I.scratch(0.07);
      if (lvl >= 3 && p % 4 === 2) I.gtr([R + 19], 1, 0.03);
    } },
    build: { gain: 1.4, bpm: 150, root: 43, sc: 'min', prog: [0, 5, 2, 6], base: 'electro', fn(h) { // 全速で組み上げる
      const { p, I, lvl, C } = h, toms = [150, 0, 110, 150, 0, 90, 150, 110];
      if (toms[p % 8]) I.tom(toms[p % 8], 0.18);
      I.shaker(0.014);
      if ([0, 3, 6, 10, 12].includes(p)) I.str(C[0] + (p === 6 ? 7 : 0), 1, 0.04);
      if (p === 0) I.brass([C[0] - 12], 8, 0.05);
      if (lvl >= 2 && p % 4 === 0) I.kick(0.35);
      if (lvl >= 3 && p % 2 === 0) I.str(C[2] + 12, 0.8, 0.025);
    } },
    contest: { bpm: 160, root: 40, sc: 'min', prog: [0, 5, 2, 6], base: 'retro', fn(h) { // アンチヒーローのロック
      const { p, b, I, lvl, C, S2 } = h, mot = [4, 4, 2, 4, 6, 4, 2, 0];
      if (p % 2 === 0) I.gtr([C[0]], 1.8, 0.035);
      if (p % 2 === 0) I.bass(C[0] - 12, 1.8, 0.09, 800);
      if (p % 2 === 0 && b % 2 === 1) voice(h.out, h.t, hz(S2(mot[p / 2]) + 24), h.s16 * 1.8, { type: 'square', cut: 3500, vol: 0.03 });
      if ([0, 6, 8].includes(p)) I.kick(0.45);
      if (p === 4 || p === 12 || (lvl >= 3 && p % 2 === 0 && p > 12)) I.snare(0.1);
      if (p % 2 === 0) I.hat(0.02);
    } },
    persuade: { gain: 1.8, bpm: 66, root: 45, sc: 'min', prog: [0, 5, 2, 6], base: 'spy', fn(h) { // 静かに心を動かす
      const { p, b, I, lvl, C } = h;
      if (p % 2 === 0) I.piano(C[[0, 1, 2, 1, 0, 1, 2, 1][p / 2]] + (p >= 8 ? 12 : 0), 3, 0.04);
      if (p === 0) I.pad(C, 16, 0.02 + Math.min(4, b) * 0.004, 1000);
      if (lvl >= 2 && p === 0) I.str(C[0] - 12, 16, 0.03);
      if (lvl >= 3 && p === 0) { I.taiko(0.35); I.brass([C[0], C[2]], 14, 0.03); }
    } },
    hide: { gain: 1.4, bpm: 112, root: 40, sc: 'dor', prog: [0, 0, 3, 0], base: 'comic', swing: 0.2, fn(h) { // こっそりジャズ
      const { p, b, I, lvl, R } = h, walk = [0, 3, 5, 6];
      if (p % 4 === 0) I.pizz(R - 12 + walk[(p / 4 + b) % 4]);
      if (p === 4 || p === 12) I.snap(0.08);
      if (p % 2 === 0) I.hat(0.012);
      const ph = [[0, 7], [3, 7], [6, 6], [10, 7]];
      ph.forEach(([q, n]) => { if (p === q && b % 2 === 0) I.sax(R + 12 + n + (q === 6 ? -1 : 0), 2, 0.045); });
      if (p === 8 && b % 2 === 1) I.vibes([R + 15, R + 19, R + 22], 0.025);
      if (lvl >= 3 && p === 14) I.snare(0.05);
    } },
    haul: { bpm: 140, root: 38, sc: 'min', prog: [0, 0, 5, 6], base: 'electro', fn(h) { // 爆走する輸送隊
      const { p, b, I, lvl, R, C } = h;
      if ([0, 3, 6, 8, 10, 13].includes(p)) I.taiko(p % 8 === 0 ? 0.45 : 0.28);
      I.mute(R - 12, 0.035);
      if (p === 0) I.brass([C[0], C[2]], 6, 0.05);
      if (p === 8 && b % 2) I.brass([C[1] + 12], 6, 0.04);
      if (lvl >= 2 && p % 4 === 0) I.kick(0.35);
      if (lvl >= 3 && p % 2 === 1) I.snare(0.04);
    } },
  };
  function stepGroove(t, s) {
    const g = GROOVES[song.groove], sc = SC[g.sc], s16 = 60 / song.bpm / 4;
    const p = s % 16, b = Math.floor(s / 16);
    const C = triad(sc, g.root, g.prog[b % g.prog.length]);
    const lvl = song.scene === 'draft' ? (urgent ? 3 : 2) : (song.final ? 3 : 1);
    g.fn({ p, b, t, s16, lvl, R: g.root, C, S2: (d) => deg(sc, g.root, d), I: inst(song.gain, t, s16), out: song.gain });
  }
  function stepMusic(t, s) {
    if (song.groove) return stepGroove(t, s);
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
      const swing = song.groove ? (GROOVES[song.groove].swing || 0) : sty.swing;
      const sw = s % 2 === 1 ? swing * (60 / song.bpm / 4) : 0;
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
    const lvl = GROOVES[style] && (scene === 'draft' || scene === 'stage') ? 1.3 * (GROOVES[style].gain || 1) : ({ title: 1.6, draft: 1.1, stage: final ? 1.0 : 1.5, win: 0.9, lose: 1.8 }[scene] || 1);
    g.gain.linearRampToValueAtTime(lvl, ctx.currentTime + 0.4);
    const gr = GROOVES[style] && (scene === 'draft' || scene === 'stage') ? style : null;
    const baseKey = GROOVES[style] ? GROOVES[style].base : (STYLES[style] ? style : 'electro');
    const sty = STYLES[baseKey];
    song = { scene, style: baseKey, groove: gr, final, gain: g, step: 0, next: ctx.currentTime + 0.08,
             bpm: gr ? GROOVES[gr].bpm * (scene === 'stage' && final ? 1.1 : scene === 'draft' ? 1.08 : 1) : SCENES[scene].bpm * sty.tempo * (scene === 'stage' && final ? 1.18 : 1) };
    if (!loopId) loopId = setInterval(loop, 25);
  }
  function setUrgent(on) {
    if (!song || song.scene !== 'draft' || urgent === on) return;
    urgent = on;
    song.bpm = (song.groove ? GROOVES[song.groove].bpm * 1.08 : SCENES.draft.bpm * STYLES[song.style].tempo) * (on ? 1.25 : 1);
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
  return { GROOVE_KEYS: Object.keys(GROOVES), _fill, play, setUrgent, sfx, toggle, setVol, get on() { return st.on; }, get bgm() { return st.bgm; }, get sfxVol() { return st.sfx; } };
})();
