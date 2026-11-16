// Synthesised sound only: every effect is an oscillator or a filtered noise burst
// built on first user gesture, so the game ships no audio files and makes no requests.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      const length = Math.floor(ctx.sampleRate * 0.5);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function noise(when, duration, filterFreq, filterType, gainValue, decay = 0.08) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + decay);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when, Math.random() * 0.3, duration + decay);
    source.stop(when + duration + decay + 0.02);
  }

  function tone(when, duration, freqFrom, freqTo, type, gainValue) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, when);
    if (freqTo !== freqFrom) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), when + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  const bank = {
    shot(kind) {
      if (!ensure()) return;
      const now = ctx.currentTime;
      if (kind === 'shotgun') noise(now, 0.16, 900, 'lowpass', 0.9);
      else if (kind === 'smg') noise(now, 0.07, 1600, 'bandpass', 0.55);
      else if (kind === 'dmr') { noise(now, 0.22, 700, 'lowpass', 1.0); tone(now, 0.12, 180, 60, 'sawtooth', 0.25); }
      else noise(now, 0.11, 1200, 'bandpass', 0.7);
      tone(now, 0.05, 220, 90, 'square', 0.12);
    },
    enemyShot(distance) {
      if (!ensure()) return;
      const now = ctx.currentTime;
      const volume = Math.max(0.08, 0.5 - distance * 0.012);
      noise(now, 0.09, 1000, 'bandpass', volume);
    },
    reload() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      tone(now, 0.05, 900, 500, 'square', 0.08);
      tone(now + 0.28, 0.05, 700, 400, 'square', 0.08);
      tone(now + 0.6, 0.06, 1100, 700, 'square', 0.1);
    },
    dry() {
      if (!ensure()) return;
      tone(ctx.currentTime, 0.04, 1200, 900, 'square', 0.08);
    },
    hit(killed) {
      if (!ensure()) return;
      const now = ctx.currentTime;
      tone(now, 0.07, killed ? 1400 : 1000, killed ? 900 : 700, 'sine', 0.22);
      if (killed) tone(now + 0.08, 0.1, 1800, 1200, 'sine', 0.18);
    },
    hurt() {
      if (!ensure()) return;
      tone(ctx.currentTime, 0.12, 140, 70, 'sawtooth', 0.25);
    },
    plantBeep(final) {
      if (!ensure()) return;
      tone(ctx.currentTime, final ? 0.3 : 0.09, final ? 1600 : 1200, final ? 1600 : 1200, 'sine', 0.2);
    },
    plant() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      tone(now, 0.1, 500, 800, 'square', 0.15);
      tone(now + 0.12, 0.16, 800, 1200, 'square', 0.15);
    },
    explosion() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      noise(now, 0.5, 300, 'lowpass', 1.0, 0.4);
      tone(now, 0.4, 90, 30, 'sine', 0.6);
    },
    roundWin() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      [523, 659, 784].forEach((freq, i) => tone(now + i * 0.11, 0.22, freq, freq, 'triangle', 0.2));
    },
    roundLose() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      [392, 330, 262].forEach((freq, i) => tone(now + i * 0.13, 0.24, freq, freq, 'triangle', 0.18));
    },
    buy() {
      if (!ensure()) return;
      const now = ctx.currentTime;
      tone(now, 0.08, 880, 880, 'sine', 0.15);
      tone(now + 0.07, 0.1, 1320, 1320, 'sine', 0.15);
    },
    denied() {
      if (!ensure()) return;
      tone(ctx.currentTime, 0.12, 220, 160, 'square', 0.12);
    },
  };

  return { unlock, ...bank };
}
