import { Howl, Howler } from 'howler'
import { getViewerConfig } from '../lib/viewer-config'
import { useAudioSettings } from './audio-settings'
import { SOUNDS, type SoundName } from './sounds'

/** A host cue with filenames relative to the configured SFX base URL. */
export type SoundDefinition = {
  src: string | string[]
  rateRange?: [number, number]
  volumeRange?: [number, number]
  minIntervalMs?: number
  loop?: boolean
  volumeMultiplier?: number
  fadeInMs?: number
  fadeOutMs?: number
}

/** Per-play gain, stereo position and local/remote repeat suppression. */
export type SoundPlaybackOptions = {
  source?: 'local' | 'remote'
  stereo?: number
  volumeMultiplier?: number
}

const DEFAULT_MIN_INTERVAL_MS = 30
const SFX_FAILURE_BACKOFF_MS = 5_000
const DEFAULT_LOOP_FADE_MS = 90

function randomInRange([min, max]: [number, number]): number {
  return min + Math.random() * (max - min)
}

const sfxCache = new Map<SoundDefinition, Howl[]>()
let cachedBaseUrl: string | null = null
let unsubscribeAudio: (() => void) | null = null
const definitions = new Set<SoundDefinition>()
let sfxAudioContext: AudioContext | null = null
let sfxRetryAfter = 0
const lastPlayedAt = new Map<SoundDefinition, Partial<Record<'local' | 'remote', number>>>()
const lastVariation = new Map<SoundDefinition, number>()
let activeLoop: {
  id: number
  name: SoundDefinition
  sound: Howl
  volume: number
} | null = null
let pendingLoop: { name: SoundDefinition; sound: Howl } | null = null
let requestedLoop: SoundDefinition | null = null

function loopVolume(name: SoundDefinition): number {
  const { masterVolume, sfxVolume } = useAudioSettings.getState()
  return (masterVolume / 100) * (sfxVolume / 100) * (name.volumeMultiplier ?? 1)
}

function stopActiveLoop(fadeMs: number) {
  const active = activeLoop
  if (!active) return
  activeLoop = null

  if (fadeMs <= 0) {
    active.sound.stop(active.id)
    return
  }

  active.sound.once('fade', () => active.sound.stop(active.id), active.id)
  active.sound.fade(active.volume, 0, fadeMs, active.id)
}

function unloadCachedSounds(resetPlaybackState: boolean) {
  requestedLoop = null
  pendingLoop = null
  stopActiveLoop(0)
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
  if (sfxCache.size !== definitions.size || sfxCache.size === 0) return true
  if (cachedBaseUrl !== getViewerConfig().sfxBaseUrl) return true
  if (sfxAudioContext !== Howler.ctx) return true
  for (const sounds of sfxCache.values()) {
    if (sounds.some((sound) => sound.state() === 'unloaded')) return true
  }
  return false
}

/** Warm built-in cues and optional host cues without playing them. */
export function preloadSounds(extraSounds: readonly SoundDefinition[] = []) {
  for (const definition of [...Object.values(SOUNDS), ...extraSounds]) definitions.add(definition)
  if (performance.now() < sfxRetryAfter) return
  try {
    if (!unsubscribeAudio) unsubscribeAudio = useAudioSettings.subscribe(updateSoundVolumes)
    if (!cacheNeedsRebuild()) return
    unloadCachedSounds(false)
    const baseUrl = getViewerConfig().sfxBaseUrl.replace(/\/+$/, '')
    cachedBaseUrl = getViewerConfig().sfxBaseUrl
    for (const config of definitions) {
      const sources = Array.isArray(config.src) ? config.src : [config.src]
      sfxCache.set(
        config,
        sources.map(
          (src) =>
            new Howl({
              loop: config.loop ?? false,
              src: [`${baseUrl}/${src}`],
              preload: true,
              volume: 0.5,
            }),
        ),
      )
    }
    sfxAudioContext = Howler.ctx ?? null
  } catch {
    unloadCachedSounds(false)
    sfxRetryAfter = performance.now() + SFX_FAILURE_BACKOFF_MS
  }
}

/** Unload the shared sound cache and detach its settings subscription. */
export function disposeSounds() {
  unsubscribeAudio?.()
  unsubscribeAudio = null
  unloadCachedSounds(true)
  definitions.clear()
}

/** Start a host-defined loop, fading out the previously active loop. */
export function startSoundLoop(name: SoundDefinition) {
  definitions.add(name)
  const { muted } = useAudioSettings.getState()
  if (muted) {
    stopSoundLoop()
    return
  }

  requestedLoop = name
  const current = activeLoop
  if (current?.name === name && current.sound.playing(current.id)) return
  if (current) stopActiveLoop(current.name.fadeOutMs ?? DEFAULT_LOOP_FADE_MS)

  const now = performance.now()
  if (now < sfxRetryAfter) return

  try {
    preloadSounds()
    // A fresh Howler context rebuilds the cache and clears stale playback
    // state. Restore this current press after that cleanup so a first-use loop
    // can still begin when its asset finishes loading.
    requestedLoop = name
    const sound = sfxCache.get(name)?.[0]
    if (!sound) return
    if (sound.state() !== 'loaded') {
      if (pendingLoop?.name === name && pendingLoop.sound === sound) return
      pendingLoop = { name, sound }
      sound.once('load', () => {
        if (pendingLoop?.sound === sound) pendingLoop = null
        if (requestedLoop === name) startSoundLoop(name)
      })
      return
    }

    const config = name
    const volume = loopVolume(name)
    const id = sound.play()
    sound.volume(0, id)
    activeLoop = { id, name, sound, volume }
    sound.fade(0, volume, config.fadeInMs ?? DEFAULT_LOOP_FADE_MS, id)
  } catch {
    unloadCachedSounds(false)
    sfxRetryAfter = now + SFX_FAILURE_BACKOFF_MS
  }
}

/** Fade out the active loop and cancel any pending loop playback. */
export function stopSoundLoop() {
  requestedLoop = null
  pendingLoop = null
  const fadeMs = activeLoop ? (activeLoop.name.fadeOutMs ?? DEFAULT_LOOP_FADE_MS) : 0
  stopActiveLoop(fadeMs)
}

/** Play a built-in cue or host definition using the shared audio settings. */
export function playSound(sound: SoundName | SoundDefinition, options: SoundPlaybackOptions = {}) {
  const name: SoundDefinition = typeof sound === 'string' ? SOUNDS[sound] : sound
  const config = name
  definitions.add(config)
  const { masterVolume, sfxVolume, muted } = useAudioSettings.getState()

  if (muted) return

  // Drop rapid repeats — two plays of the same SFX within minIntervalMs just
  // smear into noise, they don't add useful information.
  const now = performance.now()
  if (now < sfxRetryAfter) return
  const minInterval = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const source = options.source ?? 'local'
  const times = lastPlayedAt.get(name) ?? {}
  const last = times[source]
  if (last !== undefined && now - last < minInterval) return
  // Local feedback stays legible when a collaborator makes the same kind of
  // change at nearly the same time; the quieter remote cue yields instead.
  const lastLocal = times.local
  if (source === 'remote' && lastLocal !== undefined && now - lastLocal < 120) return
  times[source] = now
  lastPlayedAt.set(name, times)

  try {
    preloadSounds()
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
    // Optional audio must never abort an input callback. Rebuild from
    // the current Howler context after a backoff instead of retrying every pointer cue.
    unloadCachedSounds(false)
    sfxRetryAfter = now + SFX_FAILURE_BACKOFF_MS
  }
}

/** Apply current volume and mute settings to cached sounds and the active loop. */
export function updateSoundVolumes() {
  const { masterVolume, muted, sfxVolume } = useAudioSettings.getState()
  if (muted) {
    stopSoundLoop()
    return
  }
  const finalVolume = (masterVolume / 100) * (sfxVolume / 100)

  try {
    if (performance.now() < sfxRetryAfter) return
    sfxCache.forEach((sounds) => {
      sounds.forEach((sound) => {
        sound.volume(finalVolume)
      })
    })
    if (activeLoop) {
      activeLoop.volume = loopVolume(activeLoop.name)
      activeLoop.sound.volume(activeLoop.volume, activeLoop.id)
    }
  } catch {
    unloadCachedSounds(false)
    sfxRetryAfter = performance.now() + SFX_FAILURE_BACKOFF_MS
  }
}
