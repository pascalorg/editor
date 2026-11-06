/**
 * Renders the light-switch cues (`switchOn`, `switchOff` in
 * `packages/editor/src/lib/sfx-player.ts`) with ffmpeg:
 *
 *   bun scripts/synth-switch-cues.ts [out-dir]   # default apps/editor/public/audios/sfx
 *
 * A rocker switch is two quick snaps: the toggle hitting its stop, then the
 * spring settling. Each snap is a bright damped ring over a 3 ms burst of
 * noise; "on" rings higher than "off". Both peak at -6 dBFS, encoded mono
 * 44.1 kHz with bit-exact output.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Snap = { at: number; hz: number; gain: number; tau: number }
const CUES: { file: string; snaps: Snap[] }[] = [
  {
    file: 'switch_on.mp3',
    snaps: [
      { at: 0, hz: 2400, gain: 1, tau: 0.009 },
      { at: 0.028, hz: 3100, gain: 0.35, tau: 0.006 },
    ],
  },
  {
    file: 'switch_off.mp3',
    snaps: [
      { at: 0, hz: 1700, gain: 1, tau: 0.011 },
      { at: 0.032, hz: 2200, gain: 0.3, tau: 0.007 },
    ],
  },
]

const DURATION = 0.16
const SAMPLE_RATE = 44_100
const PEAK_DB = -6

function snapExpression({ at, hz, gain, tau }: Snap) {
  const t = `(t-${at})`
  const ring = `sin(2*PI*${hz}*${t})+0.4*sin(2*PI*${(hz * 2.76).toFixed(1)}*${t})`
  const burst = `if(lt(${t},0.003),(random(0)*2-1)*0.8,0)`
  return `gte(t,${at})*${gain}*exp(-${t}/${tau})*(${ring}+${burst})`
}

function ffmpeg(args: string[]) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`ffmpeg failed:\n${run.stderr}`)
  return run.stderr
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(process.argv[2] ?? join(root, 'apps/editor/public/audios/sfx'))

for (const cue of CUES) {
  const source = `aevalsrc='${cue.snaps.map(snapExpression).join('+')}':s=${SAMPLE_RATE}:d=${DURATION}`
  // Rendered 20 dB down first so the summed snaps never saturate the measurement.
  const chain =
    'aformat=sample_fmts=dbl,volume=-20dB:precision=double,highpass=f=300,lowpass=f=9000'
  const measured = ffmpeg([
    '-f',
    'lavfi',
    '-i',
    source,
    '-af',
    `${chain},volumedetect`,
    '-f',
    'null',
    '-',
  ])
  const peak = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(measured)?.[1])
  const out = join(outDir, cue.file)
  ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-af',
    `${chain},volume=${(PEAK_DB - peak).toFixed(2)}dB:precision=double,afade=t=out:st=${DURATION - 0.04}:d=0.04`,
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    '-c:a',
    'libmp3lame',
    '-b:a',
    '112k',
    '-map_metadata',
    '-1',
    '-id3v2_version',
    '0',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    out,
  ])
  console.log(`${cue.file}: peak ${PEAK_DB} dBFS (from ${peak} dB)`)
}
