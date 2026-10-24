export { buildDormerRoofCut, generateDormerGeometry } from './csg-geometry'
export { dormerDefinition } from './definition'
export { buildDormerGhostGeometry } from './geometry'
export { resolveDormerPlacement } from './placement'
export type {
  DormerSurfaceMaterialRole,
  DormerSurfaceMaterialSpec,
} from './schema'
export { DormerNode, getEffectiveDormerSurfaceMaterial } from './schema'
