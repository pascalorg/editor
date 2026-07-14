import { emitter, type EventSuffix, type GridEvent, type NodeEvent } from '@pascal-app/core'

/**
 * Typed wrappers over the core `emitter` for node-kind events whose key is
 * built at runtime (e.g. `` `${kind}:click` ``). The event map keys every
 * `${kind}:${suffix}` pair to a `NodeEvent` variant, but TypeScript cannot
 * prove a runtime-built template literal is one of those keys. The single
 * boundary narrowing is isolated here so no `as any` leaks into call sites.
 */

type NodeEventHandler = (event: NodeEvent) => void

type NodeEmitter = {
  on(key: string, handler: NodeEventHandler): void
  off(key: string, handler: NodeEventHandler): void
  emit(key: string, event: NodeEvent): void
}

const nodeEmitter = emitter as unknown as NodeEmitter

/** Subscribe to a `${kind}:${suffix}` node event with a runtime-built key. */
export function onNodeEvent(kind: string, suffix: EventSuffix, handler: NodeEventHandler): void {
  nodeEmitter.on(`${kind}:${suffix}`, handler)
}

/** Unsubscribe a handler registered via {@link onNodeEvent}. */
export function offNodeEvent(kind: string, suffix: EventSuffix, handler: NodeEventHandler): void {
  nodeEmitter.off(`${kind}:${suffix}`, handler)
}

/** Emit a `${kind}:${suffix}` node event with a runtime-built key. */
export function emitNodeEvent(kind: string, suffix: EventSuffix, event: NodeEvent): void {
  nodeEmitter.emit(`${kind}:${suffix}`, event)
}

/**
 * The subset of {@link NodeEvent} that a floorplan (2D) hover interaction can
 * genuinely produce. The 3D-only fields (`object`, `nativeEvent`) have no
 * equivalent in the SVG floorplan, and the node hover listeners never read
 * them, so they are intentionally absent here rather than fabricated.
 */
export type SyntheticNodeEvent = Omit<NodeEvent, 'object' | 'nativeEvent'>

/**
 * A `grid` event synthesized by the floorplan (2D). It carries the same
 * spatial fields as {@link GridEvent}, but its `nativeEvent` is the underlying
 * DOM pointer/mouse event from the SVG surface rather than a Three.js
 * `ThreeEvent` — grid listeners only ever call `nativeEvent?.stopPropagation()`.
 */
export type SyntheticGridEvent = Omit<GridEvent, 'nativeEvent'> & {
  nativeEvent: MouseEvent | PointerEvent
}

type GridEmitter = {
  emit(key: string, event: SyntheticGridEvent): void
}

type SyntheticNodeEmitter = {
  emit(key: string, event: SyntheticNodeEvent): void
}

const gridEmitter = emitter as unknown as GridEmitter
const syntheticNodeEmitter = emitter as unknown as SyntheticNodeEmitter

/** Emit a `grid:${suffix}` event whose key is built from a runtime suffix. */
export function emitGridEvent(suffix: EventSuffix, event: SyntheticGridEvent): void {
  gridEmitter.emit(`grid:${suffix}`, event)
}

/**
 * Emit a `${kind}:${suffix}` node event synthesized by the floorplan, which
 * cannot supply the 3D-only `object`/`nativeEvent` fields. The boundary
 * narrowing is isolated here so no cast leaks into call sites.
 */
export function emitSyntheticNodeEvent(
  kind: string,
  suffix: EventSuffix,
  event: SyntheticNodeEvent,
): void {
  syntheticNodeEmitter.emit(`${kind}:${suffix}`, event)
}

/**
 * The `zone:edit-label` event asks the 3D zone-label editor to enter inline
 * rename for a given zone. It is editor-local and not part of the core
 * `EditorEvents` map, so its typed on/off wrappers live here.
 */
export type ZoneEditLabelEvent = { zoneId: string }

type ZoneEditLabelHandler = (event: ZoneEditLabelEvent) => void

type ZoneEditLabelEmitter = {
  on(key: 'zone:edit-label', handler: ZoneEditLabelHandler): void
  off(key: 'zone:edit-label', handler: ZoneEditLabelHandler): void
}

const zoneEditLabelEmitter = emitter as unknown as ZoneEditLabelEmitter

/** Subscribe to the editor-local `zone:edit-label` event. */
export function onZoneEditLabel(handler: ZoneEditLabelHandler): void {
  zoneEditLabelEmitter.on('zone:edit-label', handler)
}

/** Unsubscribe a handler registered via {@link onZoneEditLabel}. */
export function offZoneEditLabel(handler: ZoneEditLabelHandler): void {
  zoneEditLabelEmitter.off('zone:edit-label', handler)
}
