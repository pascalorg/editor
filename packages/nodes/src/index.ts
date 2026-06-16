import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { assemblyDefinition } from './assembly'
import { boxDefinition } from './box'
import { buildingDefinition } from './building'
import { cableTrayDefinition } from './cable-tray'
import { capsuleDefinition } from './capsule'
import { ceilingDefinition } from './ceiling'
import { columnDefinition } from './column'
import { coneDefinition } from './cone'
import { conformalStripDefinition } from './conformal-strip'
import { cylinderDefinition } from './cylinder'
import { dataWidgetDefinition } from './data-widget'
import { doorDefinition } from './door'
import { elevatorDefinition } from './elevator'
import { extrudeDefinition } from './extrude'
import { fenceDefinition } from './fence'
import { frustumDefinition } from './frustum'
import { guideDefinition } from './guide'
import { halfCylinderDefinition } from './half-cylinder'
import { hemisphereDefinition } from './hemisphere'
import { itemDefinition } from './item'
import { ladderDefinition } from './ladder'
import { latheDefinition } from './lathe'
import { levelDefinition } from './level'
import { pipeDefinition } from './pipe'
import { pipeFittingDefinition } from './pipe-fitting'
import { roadDefinition } from './road'
import { roofDefinition } from './roof'
import { roofSegmentDefinition } from './roof-segment'
import { roundedPanelDefinition } from './rounded-panel'
import { scanDefinition } from './scan'
import { shelfDefinition } from './shelf'
import { siteDefinition } from './site'
import { slabDefinition } from './slab'
import { spawnDefinition } from './spawn'
import { sphereDefinition } from './sphere'
import { stairDefinition } from './stair'
import { stairSegmentDefinition } from './stair-segment'
import { steelBeamDefinition } from './steel-beam'
import { sweepDefinition } from './sweep'
import { tankDefinition } from './tank'
import { torusDefinition } from './torus'
import { trapezoidPrismDefinition } from './trapezoid-prism'
import { wallDefinition } from './wall'
import { wedgeDefinition } from './wedge'
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
    assemblyDefinition as unknown as AnyNodeDefinition,
    dataWidgetDefinition as unknown as AnyNodeDefinition,
    shelfDefinition as unknown as AnyNodeDefinition,
    spawnDefinition as unknown as AnyNodeDefinition,
    wallDefinition as unknown as AnyNodeDefinition,
    fenceDefinition as unknown as AnyNodeDefinition,
    pipeFittingDefinition as unknown as AnyNodeDefinition,
    pipeDefinition as unknown as AnyNodeDefinition,
    cableTrayDefinition as unknown as AnyNodeDefinition,
    ladderDefinition as unknown as AnyNodeDefinition,
    steelBeamDefinition as unknown as AnyNodeDefinition,
    roadDefinition as unknown as AnyNodeDefinition,
    slabDefinition as unknown as AnyNodeDefinition,
    ceilingDefinition as unknown as AnyNodeDefinition,
    doorDefinition as unknown as AnyNodeDefinition,
    windowDefinition as unknown as AnyNodeDefinition,
    itemDefinition as unknown as AnyNodeDefinition,
    // Stage A — wrap-exports the legacy renderer + system. Legacy
    // panels / move tools / floorplan branches still serve these.
    boxDefinition as unknown as AnyNodeDefinition,
    cylinderDefinition as unknown as AnyNodeDefinition,
    coneDefinition as unknown as AnyNodeDefinition,
    conformalStripDefinition as unknown as AnyNodeDefinition,
    frustumDefinition as unknown as AnyNodeDefinition,
    hemisphereDefinition as unknown as AnyNodeDefinition,
    torusDefinition as unknown as AnyNodeDefinition,
    wedgeDefinition as unknown as AnyNodeDefinition,
    trapezoidPrismDefinition as unknown as AnyNodeDefinition,
    sphereDefinition as unknown as AnyNodeDefinition,
    latheDefinition as unknown as AnyNodeDefinition,
    capsuleDefinition as unknown as AnyNodeDefinition,
    halfCylinderDefinition as unknown as AnyNodeDefinition,
    roundedPanelDefinition as unknown as AnyNodeDefinition,
    extrudeDefinition as unknown as AnyNodeDefinition,
    sweepDefinition as unknown as AnyNodeDefinition,
    tankDefinition as unknown as AnyNodeDefinition,
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
  ],
}

export { assemblyDefinition } from './assembly'
export { boxDefinition } from './box'
export { buildingDefinition } from './building'
export { cableTrayDefinition } from './cable-tray'
export { capsuleDefinition } from './capsule'
export { ceilingDefinition } from './ceiling'
export { columnDefinition } from './column'
export { coneDefinition } from './cone'
export { conformalStripDefinition } from './conformal-strip'
export { cylinderDefinition } from './cylinder'
export { dataWidgetDefinition } from './data-widget'
export { doorDefinition } from './door'
export { elevatorDefinition } from './elevator'
export { extrudeDefinition } from './extrude'
export { fenceDefinition } from './fence'
export { frustumDefinition } from './frustum'
export { guideDefinition } from './guide'
export { halfCylinderDefinition } from './half-cylinder'
export { hemisphereDefinition } from './hemisphere'
export { itemDefinition } from './item'
export { ladderDefinition } from './ladder'
export { latheDefinition } from './lathe'
export { levelDefinition } from './level'
export { pipeDefinition } from './pipe'
export { pipeFittingDefinition } from './pipe-fitting'
export { roadDefinition } from './road'
export { roofDefinition } from './roof'
export { roofSegmentDefinition } from './roof-segment'
export { roundedPanelDefinition } from './rounded-panel'
export { scanDefinition } from './scan'
export { shelfDefinition } from './shelf'
export { siteDefinition } from './site'
export { slabDefinition } from './slab'
export { spawnDefinition } from './spawn'
export { sphereDefinition } from './sphere'
export { stairDefinition } from './stair'
export { stairSegmentDefinition } from './stair-segment'
export { steelBeamDefinition } from './steel-beam'
export { sweepDefinition } from './sweep'
export { tankDefinition } from './tank'
export { torusDefinition } from './torus'
export { trapezoidPrismDefinition } from './trapezoid-prism'
export { wallDefinition } from './wall'
export { wedgeDefinition } from './wedge'
export { windowDefinition } from './window'
export { zoneDefinition } from './zone'
