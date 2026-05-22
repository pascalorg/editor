import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { boxVentDefinition } from './box-vent'
import { buildingDefinition } from './building'
import { ceilingDefinition } from './ceiling'
import { chimneyDefinition } from './chimney'
import { columnDefinition } from './column'
import { doorDefinition } from './door'
import { dormerDefinition } from './dormer'
import { elevatorDefinition } from './elevator'
import { fenceDefinition } from './fence'
import { guideDefinition } from './guide'
import { itemDefinition } from './item'
import { levelDefinition } from './level'
import { ridgeVentDefinition } from './ridge-vent'
import { roofDefinition } from './roof'
import { roofSegmentDefinition } from './roof-segment'
import { scanDefinition } from './scan'
import { shelfDefinition } from './shelf'
import { siteDefinition } from './site'
import { skylightDefinition } from './skylight'
import { slabDefinition } from './slab'
import { solarPanelDefinition } from './solar-panel'
import { spawnDefinition } from './spawn'
import { stairDefinition } from './stair'
import { stairSegmentDefinition } from './stair-segment'
import { wallDefinition } from './wall'
import { windowDefinition } from './window'
import { zoneDefinition } from './zone'

/**
 * Built-in plugin bundling every node kind shipped with the Pascal editor.
 *
 * Apps load this once at bootstrap (`loadPlugin(builtinPlugin)`) before
 * mounting the viewer. New built-in nodes are added by creating a folder
 * here under `src/<kind>/` and appending its `NodeDefinition` below.
 *
 * External plugins follow the exact same shape — same `Plugin` type, same
 * `loadPlugin` call path. This is intentional: the API is stress-tested
 * by built-ins before any third-party plugin lands.
 *
 * All kinds are registered unconditionally. Parity is verified by
 * comparing against deployed production rather than an in-app env-var
 * flag toggle. As of Phase 6 the legacy mount points in `viewer/` are
 * gone — every kind dispatches through the registry.
 */
export const builtinPlugin: Plugin = {
  id: 'pascal:core',
  apiVersion: 1,
  nodes: [
    // Stage E-complete (full registry path)
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
    wallDefinition as unknown as AnyNodeDefinition,
    fenceDefinition as unknown as AnyNodeDefinition,
    slabDefinition as unknown as AnyNodeDefinition,
    ceilingDefinition as unknown as AnyNodeDefinition,
    doorDefinition as unknown as AnyNodeDefinition,
    windowDefinition as unknown as AnyNodeDefinition,
    itemDefinition as unknown as AnyNodeDefinition,
    // Stage A — wrap-exports the legacy renderer + system. Legacy
    // panels / move tools / floorplan branches still serve these.
    columnDefinition as unknown as AnyNodeDefinition,
    elevatorDefinition as unknown as AnyNodeDefinition,
    roofDefinition as unknown as AnyNodeDefinition,
    roofSegmentDefinition as unknown as AnyNodeDefinition,
    stairDefinition as unknown as AnyNodeDefinition,
    stairSegmentDefinition as unknown as AnyNodeDefinition,
    zoneDefinition as unknown as AnyNodeDefinition,
    siteDefinition as unknown as AnyNodeDefinition,
    buildingDefinition as unknown as AnyNodeDefinition,
    levelDefinition as unknown as AnyNodeDefinition,
    guideDefinition as unknown as AnyNodeDefinition,
    scanDefinition as unknown as AnyNodeDefinition,
    // Roof-mounted accessories (custom renderer + bespoke roof-event tool).
    boxVentDefinition as unknown as AnyNodeDefinition,
    ridgeVentDefinition as unknown as AnyNodeDefinition,
    chimneyDefinition as unknown as AnyNodeDefinition,
    solarPanelDefinition as unknown as AnyNodeDefinition,
    skylightDefinition as unknown as AnyNodeDefinition,
    dormerDefinition as unknown as AnyNodeDefinition,
  ],
}

export { boxVentDefinition } from './box-vent'
export { buildingDefinition } from './building'
export { ceilingDefinition } from './ceiling'
export { chimneyDefinition } from './chimney'
export { columnDefinition } from './column'
export { doorDefinition } from './door'
export { dormerDefinition } from './dormer'
export { elevatorDefinition } from './elevator'
export { fenceDefinition } from './fence'
export { guideDefinition } from './guide'
export { itemDefinition } from './item'
export { levelDefinition } from './level'
export { ridgeVentDefinition } from './ridge-vent'
export { roofDefinition } from './roof'
export { roofSegmentDefinition } from './roof-segment'
export { scanDefinition } from './scan'
export { shelfDefinition } from './shelf'
export { siteDefinition } from './site'
export { skylightDefinition } from './skylight'
export { slabDefinition } from './slab'
export { solarPanelDefinition } from './solar-panel'
export { spawnDefinition } from './spawn'
export { stairDefinition } from './stair'
export { stairSegmentDefinition } from './stair-segment'
export { wallDefinition } from './wall'
export { windowDefinition } from './window'
export { zoneDefinition } from './zone'
