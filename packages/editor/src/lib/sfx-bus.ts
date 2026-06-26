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
  'sfx:item-rotate': undefined
  'sfx:resize': undefined
  'sfx:structure-build-start': undefined
  'sfx:structure-build': undefined
  'sfx:structure-delete': undefined
  'sfx:snapshot-capture': undefined
  'sfx:menu-hover': undefined
  'sfx:menu-click': undefined
  'sfx:paint-apply': undefined
}

/**
 * Dedicated event emitter for SFX
 * Tools should use this to trigger sound effects
 */
export const sfxEmitter = mitt<SFXEvents>()

let sfxBusInitialized = false

/**
 * Initialize SFX Bus - connects SFX events to actual sound playback.
 * Safe to call multiple times; re-registration is a no-op once initialized.
 */
export function initSFXBus() {
  if (sfxBusInitialized) return
  sfxBusInitialized = true
  // Map SFX events to sound playback
  sfxEmitter.on('sfx:grid-snap', () => playSFX('gridSnap'))
  sfxEmitter.on('sfx:item-delete', () => playSFX('itemDelete'))
  sfxEmitter.on('sfx:item-pick', () => playSFX('itemPick'))
  sfxEmitter.on('sfx:item-place', () => playSFX('itemPlace'))
  sfxEmitter.on('sfx:item-rotate', () => playSFX('itemRotate'))
  sfxEmitter.on('sfx:resize', () => playSFX('resize'))
  sfxEmitter.on('sfx:structure-build-start', () => playSFX('structureBuildStart'))
  sfxEmitter.on('sfx:structure-build', () => playSFX('structureBuildEnd'))
  sfxEmitter.on('sfx:structure-delete', () => playSFX('structureDelete'))
  sfxEmitter.on('sfx:snapshot-capture', () => playSFX('snapshotCapture'))
  sfxEmitter.on('sfx:menu-hover', () => playSFX('menuHover'))
  sfxEmitter.on('sfx:menu-click', () => playSFX('menuClick'))
  sfxEmitter.on('sfx:paint-apply', () => playSFX('paintApply'))
}

/**
 * Helper function to trigger SFX events from tools
 * @example
 * triggerSFX('sfx:item-place')
 */
export function triggerSFX(event: keyof SFXEvents) {
  sfxEmitter.emit(event)
}

/**
 * Node types whose deletion should use the lighter item-delete cue rather
 * than the heavier structure-delete one. Shelves are furniture-like placeable
 * objects, so they sound like items being removed, not structures demolished.
 */
const ITEM_DELETE_NODE_TYPES = new Set(['item', 'shelf'])

/**
 * Emit the delete SFX appropriate for a deleted node's type.
 */
export function emitDeleteSFX(nodeType: string | undefined) {
  sfxEmitter.emit(
    nodeType && ITEM_DELETE_NODE_TYPES.has(nodeType) ? 'sfx:item-delete' : 'sfx:structure-delete',
  )
}
