// 生成游戏用的音乐和音效（程序合成，无版权问题）：16 位单声道 22050 Hz WAV。
import fs from 'node:fs';
import path from 'node:path';

const RATE = 22050;
const out = path.resolve(process.argv[2] || 'game/audio');
fs.mkdirSync(out, {recursive: true});

function wav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(out, name), Buffer.concat([h, data]));
  console.log(name, (data.length / 1024).toFixed(0) + ' KB');
}
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const square = (p, duty = 0.5) => (p % 1) < duty ? 1 : -1;
const tri = p => 1 - 4 * Math.abs((p % 1) - 0.5);
const env = (t, len, a = 0.005, r = 0.08) => Math.min(1, t / a) * Math.min(1, Math.max(0, (len - t) / r));

// 音效：频率从 f0 滑到 f1
function sweep(len, f0, f1, wave, vol = 0.5) {
  const n = Math.floor(len * RATE), s = new Float32Array(n); let p = 0;
  for (let i = 0; i < n; i++) { const t = i / RATE, f = f0 * (f1 / f0) ** (t / len); p += f / RATE; s[i] = wave(p) * env(t, len, 0.003, len * 0.6) * vol; }
  return s;
}
wav('pop.wav', sweep(0.12, 520, 1560, p => square(p, 0.25), 0.35));
wav('click.wav', sweep(0.05, 900, 700, tri, 0.5));
wav('miss.wav', sweep(0.3, 330, 110, p => square(p, 0.5), 0.3));
{ // 开始音：三连音上行
  const parts = [72, 76, 79, 84].map((m, i) => sweep(0.09 + (i === 3 ? 0.15 : 0), hz(m), hz(m), p => square(p, 0.25), 0.3));
  wav('start.wav', Float32Array.from(parts.flatMap(a => [...a])));
}

// 背景音乐：120 BPM、4 小节循环（C - Am - F - G），三角波低音 + 方波琶音 + 噪声鼓点。
{
  const bpm = 120, beat = 60 / bpm, bars = 4, len = bars * 4 * beat, n = Math.round(len * RATE);
  const s = new Float32Array(n);
  const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
  const melody = [76, 79, 81, 79, 76, 74, 72, 74, 72, 76, 77, 76, 74, 72, 71, 74];
  let seed = 1; const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, b = t / beat, bar = Math.floor(b / 4), ch = chords[bar % 4];
    const bt = (b % 1) * beat, eighth = Math.floor(b * 2), et = ((b * 2) % 1) * beat / 2;
    let v = 0;
    v += tri(t * hz(ch[0] - 24)) * 0.28 * env(bt, beat, 0.01, 0.1);                               // 低音
    v += square(t * hz(ch[eighth % 3] + 12), 0.25) * 0.07 * env(et, beat / 2, 0.003, 0.12);         // 琶音
    const q = Math.floor(b) % 16, qt = (b % 1) * beat;
    if (b % 2 < 1.5) v += square(t * hz(melody[q]), 0.5) * 0.06 * env(qt, beat * 0.9, 0.01, 0.2);  // 旋律
    if (Math.floor(b) % 2 === 0 && bt < 0.08) v += noise() * 0.25 * (1 - bt / 0.08);               // 底鼓
    if (bt > beat / 2 && bt - beat / 2 < 0.03) v += noise() * 0.08 * (1 - (bt - beat / 2) / 0.03); // 擦片
    s[i] = v;
  }
  wav('music.wav', s);
}
