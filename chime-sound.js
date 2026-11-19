/**
 * Joget Skin — save chime sounds (shared by savechime.js and the popup's 试听 button).
 * Soft sine/triangle tones only, gentle 12–20 ms attack, smooth exponential decay,
 * lowpass-warmed, with a light echo tail. Defines globalThis.JogetSkinChime.
 */
(function (root) {
  "use strict";

  const C5 = 523.25;
  const E5 = 659.25;
  const G5 = 783.99;
  const C6 = 1046.5;

  // one soft "bell" note: sine fundamental + quiet partials, gentle attack, exp decay
  function note(ac, out, t, freq, opts) {
    const o = Object.assign({ attack: 0.015, decay: 0.45, gain: 0.5, type: "sine", partials: [[2, 0.18], [3, 0.05]] }, opts);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.gain, t + o.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay);
    env.connect(out);
    const stopAt = t + o.attack + o.decay + 0.05;
    [[1, 1]].concat(o.partials).forEach(([mult, level]) => {
      const osc = ac.createOscillator();
      osc.type = mult === 1 ? o.type : "sine";
      osc.frequency.setValueAtTime(freq * mult, t);
      if (o.glideFrom) {
        osc.frequency.setValueAtTime(o.glideFrom * mult, t);
        osc.frequency.exponentialRampToValueAtTime(freq * mult, t + o.glideTime);
      }
      const g = ac.createGain();
      g.gain.value = level;
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(stopAt);
    });
    return stopAt;
  }

  // output chain: soft lowpass + light echo tail ("reverb-ish") -> master
  function chain(ac, dest, volume) {
    const master = ac.createGain();
    master.gain.value = volume;
    master.connect(dest);
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    lp.Q.value = 0.5;
    lp.connect(master);
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.11;
    const fb = ac.createGain();
    fb.gain.value = 0.22;
    const wet = ac.createGain();
    wet.gain.value = 0.28;
    lp.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    return lp;
  }

  const SOUNDS = {
    // 柔和叮咚 — two soft bell notes, a rising perfect fifth C5 -> G5 (default, softest)
    soft: {
      label: "柔和叮咚",
      play(ac, out, t) {
        note(ac, out, t, C5, { gain: 0.42, decay: 0.42 });
        return note(ac, out, t + 0.13, G5, { gain: 0.38, decay: 0.5 });
      },
    },
    // 木琴 — warm marimba-like arpeggio C5 -> E5 -> G5
    marimba: {
      label: "木琴",
      play(ac, out, t) {
        const m = { type: "triangle", attack: 0.012, decay: 0.26, gain: 0.45, partials: [[4, 0.06]] };
        note(ac, out, t, C5, m);
        note(ac, out, t + 0.085, E5, m);
        return note(ac, out, t + 0.17, G5, Object.assign({}, m, { decay: 0.38 }));
      },
    },
    // 泡泡 — a soft little "pop" gliding up, then a gentle ding
    bubble: {
      label: "泡泡",
      play(ac, out, t) {
        note(ac, out, t, E5, { glideFrom: 330, glideTime: 0.07, attack: 0.012, decay: 0.16, gain: 0.4, partials: [] });
        return note(ac, out, t + 0.12, C6, { attack: 0.018, decay: 0.42, gain: 0.26, partials: [[2, 0.08]] });
      },
    },
  };

  const DEFAULT = "soft";

  /** Schedule a sound on an AudioContext (or OfflineAudioContext). Returns end time. */
  function play(ac, name, startAt, volume) {
    const s = SOUNDS[name] || SOUNDS[DEFAULT];
    const out = chain(ac, ac.destination, volume == null ? 0.7 : volume);
    return s.play(ac, out, startAt == null ? ac.currentTime + 0.005 : startAt) + 0.6;
  }

  /** Render a sound to a WAV Blob (for the HTMLAudioElement fallback). */
  async function renderWav(name) {
    const rate = 44100;
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const off = new OAC(1, Math.ceil(rate * 1.4), rate);
    play(off, name, 0.0);
    const buf = await off.startRendering();
    const pcm = buf.getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    str(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    }
    return new Blob([view], { type: "audio/wav" });
  }

  root.JogetSkinChime = { SOUNDS, DEFAULT, play, renderWav };
})(typeof globalThis !== "undefined" ? globalThis : window);
