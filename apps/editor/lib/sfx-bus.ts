import mitt from 'mitt'
import { playSFX } from './sfx-player'

/**
 * SFX-specific events that tools can trigger
 */
type SFXEvents = {
  'sfx:grid-snap': undefined
  'sfx:item-delete': undefined
  'sfx:item-pick': undefined
  'sfx:item-place': undefined
  'sfx:structure-build': undefined
  'sfx:structure-delete': undefined
}

/**
 * Dedicated event emitter for SFX
 * Tools should use this to trigger sound effects
 */
export const sfxEmitter = mitt<SFXEvents>()

/**
 * Initialize SFX Bus - connects SFX events to actual sound playback
 * Call once in your app initialization
 */
export function initSFXBus() {
  // Map SFX events to sound playback
  sfxEmitter.on('sfx:grid-snap', () => playSFX('gridSnap'))
  sfxEmitter.on('sfx:item-delete', () => playSFX('itemDelete'))
  sfxEmitter.on('sfx:item-pick', () => playSFX('itemPick'))
  sfxEmitter.on('sfx:item-place', () => playSFX('itemPlace'))
  sfxEmitter.on('sfx:structure-build', () => playSFX('structureBuild'))
  sfxEmitter.on('sfx:structure-delete', () => playSFX('structureDelete'))
}

/**
 * Helper function to trigger SFX events from tools
 * @example
 * triggerSFX('sfx:item-place')
 */
export function triggerSFX(event: keyof SFXEvents) {
  sfxEmitter.emit(event)
}
