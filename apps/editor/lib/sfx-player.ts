import { Howl } from 'howler'
import useAudio from '@/store/use-audio'

// SFX sound definitions
export const SFX = {
  gridSnap: '/audios/sfx/grid_snap.mp3',
  itemDelete: '/audios/sfx/item_delete.mp3',
  itemPick: '/audios/sfx/item_pick.mp3',
  itemPlace: '/audios/sfx/item_place.mp3',
  structureBuild: '/audios/sfx/structure_build.mp3',
  structureDelete: '/audios/sfx/structure_delete.mp3',
} as const

export type SFXName = keyof typeof SFX

// Preload all SFX sounds
const sfxCache = new Map<SFXName, Howl>()

// Initialize all sounds
Object.entries(SFX).forEach(([name, path]) => {
  const sound = new Howl({
    src: [path],
    preload: true,
    volume: 0.5, // Will be adjusted by the bus
  })
  sfxCache.set(name as SFXName, sound)
})

/**
 * Play a sound effect with volume based on audio settings
 */
export function playSFX(name: SFXName) {
  const sound = sfxCache.get(name)
  if (!sound) {
    console.warn(`SFX not found: ${name}`)
    return
  }

  const { masterVolume, sfxVolume, muted } = useAudio.getState()

  if (muted) return

  // Calculate final volume (masterVolume and sfxVolume are 0-100)
  const finalVolume = (masterVolume / 100) * (sfxVolume / 100)
  sound.volume(finalVolume)
  sound.play()
}

/**
 * Update all cached SFX volumes (useful when settings change)
 */
export function updateSFXVolumes() {
  const { masterVolume, sfxVolume } = useAudio.getState()
  const finalVolume = (masterVolume / 100) * (sfxVolume / 100)

  sfxCache.forEach((sound) => {
    sound.volume(finalVolume)
  })
}
