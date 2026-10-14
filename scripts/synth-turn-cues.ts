/**
 * Renders the three agent-turn cues (`turnDone`, `turnFailed`, `turnNeedsInput` in
 * `packages/editor/src/lib/sfx-player.ts`) from sine partials with ffmpeg, so a tweak is an edit
 * here and a rerun, not a sound hunt:
 *
 *   bun scripts/synth-turn-cues.ts [out-dir]   # default apps/editor/public/audios/sfx
 *
 * Each cue is two struck notes: a raised-cosine attack, an exponential decay per partial (the
 * upper ones die first, which keeps it warm), a few quiet echoes, a fade to silence by 600 ms.
 * The three are matched on their loudest moment as played, level with `item_place`, and
 * encoded mono 44.1 kHz with bit-exact output: ffmpeg 8.1.2 with LAME 3.100 gives the same bytes
 * on every run.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Partial = { ratio: number; gain: number; decay: number }
type Note = { at: number; hz: number; gain: number; tau: number }
type Cue = {
  file: string
  notes: Note[]
  partials: Partial[]
  attack: number
  lowpass: number
  /** `aecho` delays (ms) and decays: the room the notes ring in. */
  room: string
}

const DURATION = 0.6
const SAMPLE_RATE = 44_100
/**
 * The loudest 400 ms (EBU momentary) as played, the mono file on both speakers. The other cues,
 * measured the same way with their playback gain: `success` -15.5, `structure_build_end` -17.6,
 * `item_place` -19.9, `menu_click` -26.1. A short cue is heard by its loudest moment, so that is
 * what the three are matched on, level with `item_place`: they are meant to be heard from another
 * app, and still sit under `success`.
 */
const TARGET_MOMENTARY_LUFS = -20
/** Where the first, measuring pass renders, far from clipping. */
const PRESCALE_DB = -20

/** A soft mallet on glass: the octave and twelfth fade fast, a faint inharmonic shimmer faster. */
const BELL: Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.22, decay: 0.6 },
  { ratio: 3, gain: 0.07, decay: 0.4 },
  { ratio: 4.2, gain: 0.025, decay: 0.25 },
]
/** Purer for the ping: a faint octave, nothing above. */
const PING: Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.12, decay: 0.5 },
]
/** Rounder for the failure: no shimmer, a quieter octave. */
const MUTED_BELL: Partial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.14, decay: 0.55 },
  { ratio: 3, gain: 0.035, decay: 0.35 },
]

const CUES: Cue[] = [
  {
    // Done: a rising major third, G5 into a held B5: "da-ding", a resolve.
    file: 'turn_done.mp3',
    notes: [
      { at: 0, hz: 783.99, gain: 0.7, tau: 0.1 },
      { at: 0.11, hz: 987.77, gain: 1, tau: 0.2 },
    ],
    partials: BELL,
    attack: 0.006,
    lowpass: 6000,
    room: '37|61|97:0.18|0.11|0.06',
  },
  {
    // Failed: a falling minor third, C5 to A4, slower to speak and darker; a sigh, not an alarm.
    file: 'turn_failed.mp3',
    notes: [
      { at: 0, hz: 523.25, gain: 0.85, tau: 0.14 },
      { at: 0.15, hz: 440, gain: 1, tau: 0.22 },
    ],
    partials: MUTED_BELL,
    attack: 0.014,
    lowpass: 3800,
    room: '37|61|97:0.18|0.11|0.06',
  },
  {
    // Needs input: the same D6 twice, short, dry and well apart, "ping … ping": a knock that waits,
    // above the done chime and in another rhythm.
    file: 'turn_needs_input.mp3',
    notes: [
      { at: 0, hz: 1174.66, gain: 1, tau: 0.055 },
      { at: 0.22, hz: 1174.66, gain: 1, tau: 0.065 },
    ],
    partials: PING,
    attack: 0.004,
    lowpass: 7000,
    room: '29|53:0.08|0.04',
  },
]

function noteExpression(note: Note, partials: Partial[], attack: number) {
  const t = `(t-${note.at})`
  const onset = `if(lt(${t},${attack}),0.5-0.5*cos(PI*${t}/${attack}),1)`
  const body = partials
    .map(
      (partial) =>
        `${partial.gain}*exp(-${t}/${(note.tau * partial.decay).toFixed(4)})*sin(2*PI*${(note.hz * partial.ratio).toFixed(3)}*${t})`,
    )
    .join('+')
  return `gte(t,${note.at})*${note.gain}*${onset}*(${body})`
}

function ffmpeg(args: string[]) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8' })
  if (run.status !== 0) throw new Error(`ffmpeg failed:\n${run.stderr}`)
  return run.stderr
}

function filterChain(cue: Cue, gainDb: number) {
  return [
    // Gain first, in doubles: summed partials and echoes go past full scale before any trim.
    'aformat=sample_fmts=dbl',
    `volume=${gainDb.toFixed(2)}dB:precision=double`,
    'highpass=f=160',
    `lowpass=f=${cue.lowpass}`,
    // Early echoes, quiet and quick, so the notes ring rather than stop dead.
    `aecho=1:1:${cue.room}`,
    `afade=t=out:st=${DURATION - 0.14}:d=0.14:curve=exp`,
    `atrim=0:${DURATION}`,
  ].join(',')
}

function source(cue: Cue) {
  const expression = cue.notes.map((note) => noteExpression(note, cue.partials, cue.attack))
  return `aevalsrc='${expression.join('+')}':s=${SAMPLE_RATE}:d=${DURATION}`
}

/** The cue's loudest momentary loudness as played (mono on both speakers), integrated, true peak. */
function loudness(input: string[], filters: string) {
  const asPlayed = 'pan=stereo|c0=c0|c1=c0,'
  const log = ffmpeg([...input, '-af', `${filters}${asPlayed}ebur128=peak=true`, '-f', 'null', '-'])
  const momentary = [...log.matchAll(/M:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]))
  const summary = log.slice(log.lastIndexOf('Summary:'))
  return {
    momentary: Math.max(...momentary),
    integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
    peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]),
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(process.argv[2] ?? join(root, 'apps/editor/public/audios/sfx'))

for (const cue of CUES) {
  const lavfi = ['-f', 'lavfi', '-i', source(cue)]
  const unscaled = loudness(lavfi, `${filterChain(cue, PRESCALE_DB)},`)
  const gainDb = PRESCALE_DB + TARGET_MOMENTARY_LUFS - unscaled.momentary
  const out = join(outDir, cue.file)
  ffmpeg([
    '-y',
    ...lavfi,
    '-af',
    filterChain(cue, gainDb),
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
  const encoded = loudness(['-i', out], '')
  console.log(
    `${cue.file}: momentary max ${encoded.momentary} LUFS, integrated ${encoded.integrated} LUFS, true peak ${encoded.peak} dBFS`,
  )
}
