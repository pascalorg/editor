import { Howl, Howler } from 'howler'
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
}

const DEFAULT_MIN_INTERVAL_MS = 30
const SFX_FAILURE_BACKOFF_MS = 5_000

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
    minIntervalMs: 50,
  },
  itemDelete: {
    src: '/audios/sfx/item_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
  },
  itemPick: {
    src: '/audios/sfx/item_pick.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.92, 1.0],
  },
  itemPlace: {
    src: '/audios/sfx/item_place.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.9, 1.0],
  },
  itemRotate: {
    src: '/audios/sfx/item_rotate.mp3',
    rateRange: [0.94, 1.06],
    volumeRange: [0.92, 1.0],
  },
  // Ticks as a resize handle is dragged across snap steps. Fires in rapid
  // succession, so it mirrors gridSnap: three variations cycled round-robin
  // with pitch jitter and a gap so the run reads as texture, not a tone.
  resize: {
    src: ['/audios/sfx/resize_0.mp3', '/audios/sfx/resize_1.mp3', '/audios/sfx/resize_2.mp3'],
    rateRange: [0.98, 1.02],
    volumeRange: [0.26, 0.34],
    minIntervalMs: 80,
  },
  // Fired when a structure draft begins (first click of a wall/slab/etc).
  structureBuildStart: {
    src: '/audios/sfx/structure_build_start.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
  },
  // Fired when a structure is committed (segment placed / polygon closed).
  structureBuildEnd: {
    src: '/audios/sfx/structure_build_end.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.88, 1.0],
  },
  structureDelete: {
    src: '/audios/sfx/structure_delete.mp3',
    rateRange: [0.9, 1.1],
    volumeRange: [0.9, 1.0],
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
    minIntervalMs: 0,
  },
  // Fired when a main category in the Build / Items panels is clicked.
  menuClick: {
    src: '/audios/sfx/menu_click.mp3',
    rateRange: [0.98, 1.02],
    volumeRange: [0.5, 0.6],
  },
  // Fired when a material is applied to a surface in paint mode. Painting can
  // fire in quick succession across faces, so keep variation + a small gap.
  paintApply: {
    src: '/audios/sfx/paint_apply.mp3',
    rateRange: [0.95, 1.05],
    volumeRange: [0.85, 1.0],
    minIntervalMs: 60,
  },
} as const

export type SFXName = keyof typeof SFX

export type SFXPlaybackOptions = {
  source?: 'local' | 'remote'
  stereo?: number
  volumeMultiplier?: number
}

function randomInRange([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

let sfxCache = new Map<SFXName, Howl[]>()
let sfxAudioContext: AudioContext | null = null
let sfxRetryAfter = 0
const lastPlayedAt = new Map<SFXName, number>()
const lastVariation = new Map<SFXName, number>()

function unloadCachedSounds(resetPlaybackState: boolean) {
  for (const sounds of sfxCache.values()) {
    for (const sound of sounds) {
      try {
        sound.unload()
      } catch {}
    }
  }
  sfxCache.clear()
  sfxAudioContext = null
  if (resetPlaybackState) {
    sfxRetryAfter = 0
    lastPlayedAt.clear()
    lastVariation.clear()
  }
}

function cacheNeedsRebuild(): boolean {
  if (sfxCache.size === 0) return true
  if (sfxAudioContext !== Howler.ctx) return true
  for (const sounds of sfxCache.values()) {
    if (sounds.some((sound) => sound.state() === 'unloaded')) return true
  }
  return false
}

export function preloadSFX() {
  if (!cacheNeedsRebuild()) return
  unloadCachedSounds(false)

  for (const [name, config] of Object.entries(SFX)) {
    const sources = Array.isArray(config.src) ? config.src : [config.src]
    sfxCache.set(
      name as SFXName,
      sources.map(
        (src) =>
          new Howl({
            src: [src],
            preload: true,
            volume: 0.5,
          }),
      ),
    )
  }
  sfxAudioContext = Howler.ctx ?? null
}

export function disposeSFX() {
  unloadCachedSounds(true)
}

/**
 * Play a sound effect with volume based on audio settings
 */
export function playSFX(name: SFXName, options: SFXPlaybackOptions = {}) {
  const config = SFX[name]!
  const { masterVolume, sfxVolume, muted } = useAudio.getState()

  if (muted) return

  // Drop rapid repeats — two plays of the same SFX within minIntervalMs just
  // smear into noise, they don't add useful information.
  const now = performance.now()
  if (now < sfxRetryAfter) return
  const minInterval = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const source = options.source ?? 'local'
  const playbackKey = `${source}:${name}`
  const last = lastPlayedAt.get(playbackKey)
  if (last !== undefined && now - last < minInterval) return
  // Local feedback stays legible when a collaborator makes the same kind of
  // change at nearly the same time; the quieter remote cue yields instead.
  const lastLocal = lastPlayedAt.get(`local:${name}`)
  if (source === 'remote' && lastLocal !== undefined && now - lastLocal < 120) return
  lastPlayedAt.set(playbackKey, now)

  try {
    preloadSFX()
    const sounds = sfxCache.get(name)
    if (!sounds || sounds.length === 0) return

    // Pick a random variation, avoiding an immediate repeat of the last one so
    // consecutive plays don't land on the same file.
    let index = Math.floor(Math.random() * sounds.length)
    if (sounds.length > 1 && index === lastVariation.get(name)) {
      index = (index + 1) % sounds.length
    }
    lastVariation.set(name, index)
    const sound = sounds[index]!
    // Howler queues per-play mutations while a sound is loading. If its global
    // AudioContext is replaced before that queue drains, stereo setup can try
    // to connect nodes from different contexts and throw asynchronously.
    if (sound.state() !== 'loaded') return
    const baseVolume = (masterVolume / 100) * (sfxVolume / 100)
    const volumeJitter = config.volumeRange ? randomInRange(config.volumeRange) : 1
    const volumeMultiplier = Number.isFinite(options.volumeMultiplier)
      ? Math.max(0, Math.min(2, options.volumeMultiplier!))
      : 1
    const rate = config.rateRange ? randomInRange(config.rateRange) : 1
    const id = sound.play()
    sound.volume(baseVolume * volumeJitter * volumeMultiplier, id)
    if (Number.isFinite(options.stereo)) {
      sound.stereo(Math.max(-1, Math.min(1, options.stereo!)), id)
    }
    if (rate !== 1) sound.rate(rate, id)
  } catch {
    // Optional audio must never abort an editor input callback. Rebuild from
    // the current Howler context after a backoff instead of retrying every pointer cue.
    unloadCachedSounds(false)
    sfxRetryAfter = now + SFX_FAILURE_BACKOFF_MS
  }
}

/**
 * Update all cached SFX volumes (useful when settings change)
 */
export function updateSFXVolumes() {
  const { masterVolume, sfxVolume } = useAudio.getState()
  const finalVolume = (masterVolume / 100) * (sfxVolume / 100)

  try {
    if (performance.now() < sfxRetryAfter) return
    preloadSFX()
    sfxCache.forEach((sounds) => {
      sounds.forEach((sound) => {
        sound.volume(finalVolume)
      })
    })
  } catch {
    unloadCachedSounds(false)
    sfxRetryAfter = performance.now() + SFX_FAILURE_BACKOFF_MS
  }
}
