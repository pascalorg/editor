/**
 * @pascal-app/plugin-sections — TRUE VECTOR sections and elevations.
 *
 * Two node kinds (`section-marker`, `elevation-marker`) and two pure
 * geometry builders that turn Pascal's own scene into drawing primitives:
 *
 *   buildSectionDrawing(scene, marker | spec) -> { primitives, bounds, ... }
 *   buildElevationDrawing(scene, direction)   -> { primitives, bounds, ... }
 *
 * Both return the core `FloorplanGeometry` union in drawing metres, per the
 * WS-wide drawing-output contract in docs/construction-documents.md. No
 * raster capture, no remote engine — every line comes from the walls, roofs,
 * slabs and openings already in the scene.
 */
import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import type { EditorHostPanel } from '@pascal-app/editor'
import { elevationMarkerDefinition } from './elevation-marker/definition'
import { sectionMarkerDefinition } from './section-marker/definition'

const SECTIONS_ICON = {
  kind: 'url',
  // a building cut through — inline so the package needs no asset pipeline
  src:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M10 52V26l22-14 22 14v26" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/><path d="M6 40h52" fill="none" stroke="currentColor" stroke-width="3.5" stroke-dasharray="7 5" stroke-linecap="round"/><path d="M24 52V40M40 52V40" fill="none" stroke="currentColor" stroke-width="3"/></svg>`,
    ),
} as const

export const sectionsPlugin = {
  id: 'pascal:sections',
  apiVersion: 1,
  nodes: [
    sectionMarkerDefinition as unknown as AnyNodeDefinition,
    elevationMarkerDefinition as unknown as AnyNodeDefinition,
  ],
} satisfies Plugin

export const sectionsHostPanel = {
  id: 'pascal:sections:panel',
  label: 'Sections',
  icon: SECTIONS_ICON,
  component: () => import('./panel'),
  pluginId: sectionsPlugin.id,
  description:
    'Vector building sections and exterior elevations computed from the scene geometry — place markers and preview the drawings.',
  creator: { name: 'Pascal' },
  defaultInstalled: true,
} satisfies EditorHostPanel

export { elevationMarkerDefinition } from './elevation-marker/definition'
export {
  buildElevationDrawing,
  type ElevationDirectionArg,
  elevationAngle,
} from './geometry/elevation'
export {
  type BuildingModel,
  buildBuildingModel,
  type LevelInfo,
  type Opening,
  type PrismSolid,
  type RoofSolid,
  resolveWallLayers,
  type WallLayer,
  type WallSolid,
} from './geometry/scene-model'
export { buildSectionDrawing, type SectionSpec } from './geometry/section'
export type { DrawingBounds, DrawingResult, DrawingScene } from './geometry/types'
export { SectionPreview } from './preview'
export {
  DEFAULT_SECTION_DEPTH,
  ElevationDirection,
  ElevationMarkerNode,
  elevationMarkerAngle,
  SectionMarkerNode,
} from './schema'
export { sectionMarkerDefinition } from './section-marker/definition'
