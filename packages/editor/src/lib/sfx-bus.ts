import type { TerrainVerb } from '@pascal-app/core'
import mitt from 'mitt'
import useAudio from '../store/use-audio'
import {
  disposeSFX,
  type LoopSFXName,
  playSFX,
  startLoopSFX,
  stopLoopSFX,
  updateSFXVolumes,
} from './sfx-player'

/**
 * SFX-specific events that tools can trigger
 */
type SFXEvents = {
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
  'sfx:terrain-sculpt-start': TerrainVerb
  'sfx:terrain-sculpt-stop': undefined
}

type TriggerSFXEvent = {
  [Event in keyof SFXEvents]: SFXEvents[Event] extends undefined ? Event : never
}[keyof SFXEvents]

/**
 * Dedicated event emitter for SFX
 * Tools should use this to trigger sound effects
 */
export const sfxEmitter = mitt<SFXEvents>()

let sfxBusInitialized = false

const handleItemDelete = () => playSFX('itemDelete')
const handleItemPick = () => playSFX('itemPick')
const handleItemPlace = () => playSFX('itemPlace')
const handleItemRotate = () => playSFX('itemRotate')
const handleResize = () => playSFX('resize')
const handleStructureBuildStart = () => playSFX('structureBuildStart')
const handleStructureBuild = () => playSFX('structureBuildEnd')
const handleStructureDelete = () => playSFX('structureDelete')
const handleSnapshotCapture = () => playSFX('snapshotCapture')
const handleMenuHover = () => playSFX('menuHover')
const handleMenuClick = () => playSFX('menuClick')
const handlePaintApply = () => playSFX('paintApply')
const TERRAIN_LOOP_BY_VERB = {
  raise: 'terrainRaise',
  lower: 'terrainLower',
  flatten: 'terrainFlatten',
  smooth: 'terrainSmooth',
} as const satisfies Record<TerrainVerb, LoopSFXName>
const handleTerrainSculptStart = (verb: TerrainVerb) => startLoopSFX(TERRAIN_LOOP_BY_VERB[verb])
const handleTerrainSculptStop = () => stopLoopSFX()
let unsubscribeAudio: (() => void) | null = null

/**
 * Initialize SFX Bus - connects SFX events to actual sound playback.
 * Safe to call multiple times; re-registration is a no-op once initialized.
 */
export function initSFXBus() {
  if (sfxBusInitialized) return
  sfxBusInitialized = true
  sfxEmitter.on('sfx:item-delete', handleItemDelete)
  sfxEmitter.on('sfx:item-pick', handleItemPick)
  sfxEmitter.on('sfx:item-place', handleItemPlace)
  sfxEmitter.on('sfx:item-rotate', handleItemRotate)
  sfxEmitter.on('sfx:resize', handleResize)
  sfxEmitter.on('sfx:structure-build-start', handleStructureBuildStart)
  sfxEmitter.on('sfx:structure-build', handleStructureBuild)
  sfxEmitter.on('sfx:structure-delete', handleStructureDelete)
  sfxEmitter.on('sfx:snapshot-capture', handleSnapshotCapture)
  sfxEmitter.on('sfx:menu-hover', handleMenuHover)
  sfxEmitter.on('sfx:menu-click', handleMenuClick)
  sfxEmitter.on('sfx:paint-apply', handlePaintApply)
  sfxEmitter.on('sfx:terrain-sculpt-start', handleTerrainSculptStart)
  sfxEmitter.on('sfx:terrain-sculpt-stop', handleTerrainSculptStop)
  unsubscribeAudio = useAudio.subscribe(updateSFXVolumes)
}

export function disposeSFXBus() {
  if (sfxBusInitialized) {
    sfxEmitter.off('sfx:item-delete', handleItemDelete)
    sfxEmitter.off('sfx:item-pick', handleItemPick)
    sfxEmitter.off('sfx:item-place', handleItemPlace)
    sfxEmitter.off('sfx:item-rotate', handleItemRotate)
    sfxEmitter.off('sfx:resize', handleResize)
    sfxEmitter.off('sfx:structure-build-start', handleStructureBuildStart)
    sfxEmitter.off('sfx:structure-build', handleStructureBuild)
    sfxEmitter.off('sfx:structure-delete', handleStructureDelete)
    sfxEmitter.off('sfx:snapshot-capture', handleSnapshotCapture)
    sfxEmitter.off('sfx:menu-hover', handleMenuHover)
    sfxEmitter.off('sfx:menu-click', handleMenuClick)
    sfxEmitter.off('sfx:paint-apply', handlePaintApply)
    sfxEmitter.off('sfx:terrain-sculpt-start', handleTerrainSculptStart)
    sfxEmitter.off('sfx:terrain-sculpt-stop', handleTerrainSculptStop)
    unsubscribeAudio?.()
    unsubscribeAudio = null
    sfxBusInitialized = false
  }
  disposeSFX()
}

/**
 * Helper function to trigger SFX events from tools
 * @example
 * triggerSFX('sfx:item-place')
 */
export function triggerSFX(event: TriggerSFXEvent) {
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
