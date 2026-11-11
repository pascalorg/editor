import { emitter, type InteractionSound } from '@pascal-app/core'
import { playSound, preloadSounds } from './player'
import type { SoundName } from './sounds'

/** Core interaction cues and their playback gain; windows use softer door recordings. */
export const INTERACTION_SOUNDS: Record<InteractionSound, [SoundName, number]> = {
  'door-open': ['doorOpen', 1],
  'door-swing': ['doorSwing', 1],
  'door-close': ['doorClose', 1],
  'window-open': ['doorOpen', 0.6],
  'window-swing': ['doorSwing', 0.6],
  'window-close': ['doorClose', 0.6],
  garage: ['garageDoor', 1],
  'shutters-open': ['shuttersOpen', 1],
  'shutters-close': ['shuttersClose', 1],
  // Cabinet doors and drawers: the panel recordings, as the marketing house plays its cabinets.
  'panel-open': ['shuttersOpen', 0.75],
  'panel-swing': ['doorSwing', 0.45],
  'panel-close': ['shuttersClose', 0.75],
  'switch-on': ['switchOn', 1],
  'switch-off': ['switchOff', 1],
}
let subscribers = 0
const handleInteractionSound = (sound: InteractionSound) => {
  const [name, volumeMultiplier] = INTERACTION_SOUNDS[sound]
  playSound(name, { volumeMultiplier })
}

/** Connect core interaction cues to playback; call the returned cleanup on unmount. */
export function initInteractionSounds(): () => void {
  preloadSounds()
  if (subscribers++ === 0) emitter.on('interaction:sound', handleInteractionSound)
  let active = true
  return () => {
    if (!active) return
    active = false
    if (--subscribers === 0) emitter.off('interaction:sound', handleInteractionSound)
  }
}
