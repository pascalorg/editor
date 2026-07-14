import type { Plugin } from '@pascal-app/core'
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
import { asNodeDefinition } from './shared/register-node'
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
    asNodeDefinition(shelfDefinition),
    asNodeDefinition(spawnDefinition),
    asNodeDefinition(wallDefinition),
    asNodeDefinition(fenceDefinition),
    asNodeDefinition(slabDefinition),
    asNodeDefinition(ceilingDefinition),
    asNodeDefinition(doorDefinition),
    asNodeDefinition(windowDefinition),
    asNodeDefinition(itemDefinition),
    // Stage A — wrap-exports the legacy renderer + system. Legacy
    // panels / move tools / floorplan branches still serve these.
    asNodeDefinition(columnDefinition),
    asNodeDefinition(elevatorDefinition),
    asNodeDefinition(roofDefinition),
    asNodeDefinition(roofSegmentDefinition),
    asNodeDefinition(stairDefinition),
    asNodeDefinition(stairSegmentDefinition),
    asNodeDefinition(zoneDefinition),
    asNodeDefinition(siteDefinition),
    asNodeDefinition(buildingDefinition),
    asNodeDefinition(levelDefinition),
    asNodeDefinition(guideDefinition),
    asNodeDefinition(scanDefinition),
    // Roof-mounted accessories (custom renderer + bespoke roof-event tool).
    asNodeDefinition(boxVentDefinition),
    asNodeDefinition(ridgeVentDefinition),
    asNodeDefinition(chimneyDefinition),
    asNodeDefinition(solarPanelDefinition),
    asNodeDefinition(skylightDefinition),
    asNodeDefinition(dormerDefinition),
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
