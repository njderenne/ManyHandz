/**
 * Generates the standard UI sounds (assets/sounds/*.wav) as short synthesized tones.
 * Run with: node scripts/generate-sounds.mjs   (regenerate any time; swap for real assets per app)
 */
import fs from 'fs'
import path from 'path'

const SR = 44100
const dir = path.join(process.cwd(), 'assets', 'sounds')
fs.mkdirSync(dir, { recursive: true })

function note(freq, dur, gain = 0.4) {
  const n = Math.floor(SR * dur)
  const fade = Math.floor(SR * 0.008)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let env = 1
    if (i < fade) env = i / fade
    else if (i > n - fade) env = (n - i) / fade
    out[i] = Math.sin((2 * Math.PI * freq * i) / SR) * env * gain
  }
  return out
}

function seq(notes) {
  const parts = notes.map((x) => note(x.f, x.d))
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Float32Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE((s * 0x7fff) | 0, i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const sounds = {
  tap: seq([{ f: 1200, d: 0.05 }]),
  success: seq([{ f: 660, d: 0.09 }, { f: 990, d: 0.12 }]),
  error: seq([{ f: 420, d: 0.1 }, { f: 300, d: 0.16 }]),
  notify: seq([{ f: 880, d: 0.08 }, { f: 1175, d: 0.13 }]),
}

for (const [name, s] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(dir, `${name}.wav`), wav(s))
  console.log(`wrote assets/sounds/${name}.wav`)
}
