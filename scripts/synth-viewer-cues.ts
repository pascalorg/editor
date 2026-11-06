/**
 * Renders the viewer's UI cues (`viewerHover`, `viewerSelect`, `viewerDeselect`,
 * `switchOn`, `switchOff`, `doorSwing` in `packages/editor/src/lib/sfx-player.ts`)
 * with ffmpeg:
 *
 *   bun scripts/synth-viewer-cues.ts [out-dir]   # default apps/editor/public/audios/sfx
 *
 * The recipes are the "Minimal" UI sound kit by Raphael Salaja (MIT), as the
 * Pascal marketing house plays them: one sine voice, a 1 ms linear attack, an
 * exponential decay, then a short linear release; the switches sweep their
 * pitch exponentially. Gains keep that house's mix against the door
 * recordings, which it plays at 0.4: each cue is written at its gain / 0.4 so
 * the files sit beside door_open.mp3 at playback volume 1.
 *
 * `door_swing.mp3` is ours: the air a leaf pushes as it swings shut, band-passed
 * noise that swells over the 520 ms leaf run and dies just before the latch
 * (`door_close.mp3`, played as the leaf lands), well under the latch's level.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Cue = {
  file: string
  frequency: number
  endFrequency?: number
  attack: number
  decay: number
  release: number
  gain: number
}

const DOOR_GAIN = 0.4
const CUES: Cue[] = [
  { file: 'viewer_hover.mp3', frequency: 1300, attack: 0, decay: 0.01, release: 0.004, gain: 0.04 },
  { file: 'viewer_select.mp3', frequency: 800, attack: 0, decay: 0.015, release: 0.005, gain: 0.1 },
  {
    file: 'viewer_deselect.mp3',
    frequency: 620,
    attack: 0.001,
    decay: 0.012,
    release: 0.004,
    gain: 0.04,
  },
  {
    file: 'switch_on.mp3',
    frequency: 680,
    endFrequency: 960,
    attack: 0.002,
    decay: 0.022,
    release: 0.006,
    gain: 0.065,
  },
  {
    file: 'switch_off.mp3',
    frequency: 760,
    endFrequency: 480,
    attack: 0.002,
    decay: 0.022,
    release: 0.006,
    gain: 0.055,
  },
]

const SAMPLE_RATE = 44_100
const PAD = 0.04

function expression(cue: Cue) {
  const attack = Math.max(0.001, cue.attack)
  const duration = attack + cue.decay + cue.release
  const peak = cue.gain / DOOR_GAIN
  const floor = 0.0001 / DOOR_GAIN
  // Phase of a sine whose pitch moves exponentially from frequency to endFrequency over the cue.
  const ratio = (cue.endFrequency ?? cue.frequency) / cue.frequency
  const phase =
    ratio === 1
      ? `2*PI*${cue.frequency}*t`
      : `2*PI*${cue.frequency}*${duration}/log(${ratio})*(pow(${ratio},min(t,${duration})/${duration})-1)`
  const envelope = [
    `if(lt(t,${attack}),${peak}*t/${attack},`,
    `if(lt(t,${attack + cue.decay}),${peak}*pow(${floor / peak},(t-${attack})/${cue.decay}),`,
    `if(lt(t,${duration}),${floor}*(1-(t-${attack + cue.decay})/${cue.release}),0)))`,
  ].join('')
  return { source: `${envelope}*sin(${phase})`, duration: duration + PAD }
}

function ffmpeg(args: string[]) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`ffmpeg failed:\n${run.stderr}`)
  return run.stderr
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(process.argv[2] ?? join(root, 'apps/editor/public/audios/sfx'))

for (const cue of CUES) {
  const { source, duration } = expression(cue)
  const out = join(outDir, cue.file)
  ffmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${source}':s=${SAMPLE_RATE}:d=${duration.toFixed(3)}`,
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
  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(
    ffmpeg(['-i', out, '-af', 'volumedetect', '-f', 'null', '-']),
  )?.[1]
  console.log(`${cue.file}: peak ${peak} dBFS`)
}

// The swing: noise under a raised-sine swell cresting at 70 % of its length.
const SWING = { file: 'door_swing.mp3', duration: 0.46, crest: 0.7, peakDb: -26 }
const swell = `if(lt(t,${SWING.duration * SWING.crest}),pow(sin(PI/2*t/${SWING.duration * SWING.crest}),2),pow(cos(PI/2*(t-${SWING.duration * SWING.crest})/${SWING.duration * (1 - SWING.crest)}),2))`
const swingSource = `aevalsrc='${swell}*(random(0)*2-1)':s=${SAMPLE_RATE}:d=${SWING.duration}`
const swingFilters = 'aformat=sample_fmts=dbl,highpass=f=220,lowpass=f=1400,lowpass=f=1400'
const swingPeak = Number(
  /max_volume:\s*(-?[\d.]+) dB/.exec(
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      swingSource,
      '-af',
      `${swingFilters},volumedetect`,
      '-f',
      'null',
      '-',
    ]),
  )?.[1],
)
ffmpeg([
  '-y',
  '-f',
  'lavfi',
  '-i',
  swingSource,
  '-af',
  `${swingFilters},volume=${(SWING.peakDb - swingPeak).toFixed(2)}dB:precision=double`,
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
  join(outDir, SWING.file),
])
console.log(`${SWING.file}: peak ${SWING.peakDb} dBFS`)
