import { Howl } from 'howler'
import useAudio from '../store/use-audio'

// Per-sound variation config. Playback rate also shifts pitch (one semitone ≈ 1.0595×),
// so a rate range of ~0.88–1.12 reads as a subtle ±2 semitones — enough to kill the
// machine-gun feeling when the same SFX fires in rapid succession.
type SFXConfig = {
  // One file, or several pre-rendered variations cycled round-robin per play.
  src: string | string[]
  // Random playback-rate range applied per play (1 = unchanged).
  rateRange?: [number, number]
  // Random volume multiplier range applied per play (1 = unchanged).
  volumeRange?: [number, number]
  // Minimum gap between two plays of this SFX. Triggers within this window
  // are silently dropped so bursty sequences don't phase-stack into noise.
  minIntervalMs?: number
  // Random stereo pan per play — max absolute offset (0 = center, 1 = hard
  // right). A small value like 0.15 keeps things centred but adds just enough
  // spread to stop repeats from stacking on the same point in the field.
  panJitter?: number
}

const DEFAULT_MIN_INTERVAL_MS = 30

// SFX sound definitions
export const SFX: Record<string, SFXConfig> = {
  gridSnap: {
    src: [
      '/audios/sfx/grid_snap_0.mp3',
      '/audios/sfx/grid_snap_1.mp3',
      '/audios/sfx/grid_snap_2.mp3',
    ],
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
    panJitter: 0.15,
    minIntervalMs: 50,
  },
  itemDelete: {
    src: '/audios/sfx/item_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.05,
  },
  itemPick: {
    src: '/audios/sfx/item_pick.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  itemPlace: {
    src: '/audios/sfx/item_place.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.9, 1.0],
    panJitter: 0.15,
  },
  itemRotate: {
    src: '/audios/sfx/item_rotate.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
    panJitter: 0.15,
  },
  // Ticks as a resize handle is dragged across snap steps. Fires in rapid
  // succession, so it mirrors gridSnap: three variations cycled round-robin
  // with pitch/pan jitter and a gap so the run reads as texture, not a tone.
  resize: {
    src: ['/audios/sfx/resize_0.mp3', '/audios/sfx/resize_1.mp3', '/audios/sfx/resize_2.mp3'],
    rateRange: [0.98, 1.02],
    volumeRange: [0.26, 0.34],
    panJitter: 0.15,
    minIntervalMs: 80,
  },
  // Fired when a structure draft begins (first click of a wall/slab/etc).
  structureBuildStart: {
    src: '/audios/sfx/structure_build_start.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
    panJitter: 0.15,
  },
  // Fired when a structure is committed (segment placed / polygon closed).
  structureBuildEnd: {
    src: '/audios/sfx/structure_build_end.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
    panJitter: 0.15,
  },
  structureDelete: {
    src: '/audios/sfx/structure_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
    panJitter: 0.08,
  },
  snapshotCapture: {
    // Shutter should sound consistent — no variation.
    src: '/audios/sfx/snapshot_capture.mp3',
  },
  // Soft tick when hovering a main category in the Build / Items panels.
  // Kept quiet and rate-locked so sweeping across the grid reads as texture,
  // not a melody.
  menuHover: {
    src: '/audios/sfx/menu_hover.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.2, 0.3],
    panJitter: 0.1,
    minIntervalMs: 0,
  },
  // Fired when a main category in the Build / Items panels is clicked.
  menuClick: {
    src: '/audios/sfx/menu_click.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
    panJitter: 0.1,
  },
  // Fired when a material is applied to a surface in paint mode. Painting can
  // fire in quick succession across faces, so keep variation + a small gap.
  paintApply: {
    src: '/audios/sfx/paint_apply.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.85, 1.0],
    panJitter: 0.12,
    minIntervalMs: 60,
  },
} as const

export type SFXName = keyof typeof SFX

function randomInRange([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

// Preload all SFX sounds. Each variation gets its own Howl so they can overlap
// and be cycled round-robin.
const sfxCache = new Map<SFXName, Howl[]>()
const lastPlayedAt = new Map<SFXName, number>()
const lastVariation = new Map<SFXName, number>()

// Initialize all sounds
Object.entries(SFX).forEach(([name, config]) => {
  const sources = Array.isArray(config.src) ? config.src : [config.src]
  const sounds = sources.map(
    (src) =>
      new Howl({
        src: [src],
        preload: true,
        volume: 0.5, // Will be adjusted by the bus
      }),
  )
  sfxCache.set(name as SFXName, sounds)
})

/**
 * Play a sound effect with volume based on audio settings
 */
export function playSFX(name: SFXName) {
  const sounds = sfxCache.get(name)
  if (!sounds || sounds.length === 0) {
    console.warn(`SFX not found: ${name}`)
    return
  }
  const config = SFX[name]!

  // Drop rapid repeats — two plays of the same SFX within minIntervalMs just
  // smear into noise, they don't add useful information.
  const now = performance.now()
  const minInterval = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const last = lastPlayedAt.get(name)
  if (last !== undefined && now - last < minInterval) return
  lastPlayedAt.set(name, now)

  // Pick a random variation, avoiding an immediate repeat of the last one so
  // consecutive plays don't land on the same file.
  let index = Math.floor(Math.random() * sounds.length)
  if (sounds.length > 1 && index === lastVariation.get(name)) {
    index = (index + 1) % sounds.length
  }
  lastVariation.set(name, index)
  const sound = sounds[index]!

  const { masterVolume, sfxVolume, muted } = useAudio.getState()

  if (muted) return

  // Calculate final volume (masterVolume and sfxVolume are 0-100)
  const baseVolume = (masterVolume / 100) * (sfxVolume / 100)
  const volumeJitter = config.volumeRange ? randomInRange(config.volumeRange) : 1
  const rate = config.rateRange ? randomInRange(config.rateRange) : 1

  // Apply per-play variation using the returned sound id so overlapping plays
  // don't fight over shared properties on the Howl.
  const id = sound.play()
  sound.volume(baseVolume * volumeJitter, id)
  if (rate !== 1) sound.rate(rate, id)
  if (config.panJitter) {
    const pan = (Math.random() * 2 - 1) * config.panJitter
    sound.stereo(pan, id)
  }
}

/**
 * Update all cached SFX volumes (useful when settings change)
 */
export function updateSFXVolumes() {
  const { masterVolume, sfxVolume } = useAudio.getState()
  const finalVolume = (masterVolume / 100) * (sfxVolume / 100)

  sfxCache.forEach((sounds) => {
    sounds.forEach((sound) => {
      sound.volume(finalVolume)
    })
  })
}
