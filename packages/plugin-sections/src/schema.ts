import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

/**
 * Compass directions an exterior elevation can look FROM. `'north'` is the
 * *north elevation* in the architectural sense: the viewer stands north of
 * the building and looks south at its north face.
 *
 * World convention (WS1 contract, docs/construction-documents.md): x east,
 * z south. So the north viewer sits at -z looking toward +z.
 */
export const ElevationDirection = z.enum(['north', 'east', 'south', 'west', 'custom'])
export type ElevationDirection = z.infer<typeof ElevationDirection>

export const DEFAULT_SECTION_DEPTH = 12

export const SectionMarkerNode = BaseNode.extend({
  id: objectId('secmk'),
  type: nodeType('section-marker'),
  /** Sheet bubble letter — 'A', 'B', … Free text so 'A1' / '1' also work. */
  label: z.string().trim().max(8).default('A'),
  /** Level the marker is drawn on. The cut itself spans the whole building. */
  levelId: z.string().nullable().default(null),
  /** Cut-line start in building plan coords [x, z] metres. */
  start: z.tuple([z.number(), z.number()]).default([0, 0]),
  /** Cut-line end in building plan coords [x, z] metres. */
  end: z.tuple([z.number(), z.number()]).default([1, 0]),
  /**
   * Which side of start→end the section looks toward. `'left'` is the
   * screen-left side of the travel direction in plan (x right, z down).
   */
  lookDirection: z.enum(['left', 'right']).default('left'),
  /** How far past the cut plane the projected (background) geometry is drawn. */
  depth: z.number().positive().default(DEFAULT_SECTION_DEPTH),
  /** Optional back-reference to the sheet this section lands on (WS2 owns sheets). */
  sheetRef: z.string().nullable().default(null),
}).describe(
  `Section marker - a vertical cut plane through the building.
  - label: bubble letter shown at both ends of the cut line
  - start/end: cut line in building plan coords [x, z] metres
  - lookDirection: which side of start->end the section views
  - depth: how far past the cut plane background geometry is projected
  - sheetRef: optional sheet id the section is placed on`,
)

export type SectionMarkerNode = z.infer<typeof SectionMarkerNode>

export const ElevationMarkerNode = BaseNode.extend({
  id: objectId('elevmk'),
  type: nodeType('elevation-marker'),
  label: z.string().trim().max(8).default('1'),
  direction: ElevationDirection.default('north'),
  /**
   * Custom view azimuth in radians, measured in the XZ plane from +x toward
   * +z — only read when `direction === 'custom'`. north = +PI/2, east = PI,
   * south = -PI/2, west = 0.
   */
  angle: z.number().default(Math.PI / 2),
  /** Plan position of the marker glyph, [x, z] metres. */
  position: z.tuple([z.number(), z.number()]).default([0, 0]),
  sheetRef: z.string().nullable().default(null),
}).describe(
  `Elevation marker - names one exterior elevation of the building.
  - direction: north | east | south | west | custom
  - angle: view azimuth in radians (XZ plane, from +x toward +z) when direction is 'custom'
  - position: plan position of the marker glyph [x, z] metres`,
)

export type ElevationMarkerNode = z.infer<typeof ElevationMarkerNode>

/** Radians of view azimuth for a marker's direction. See `angle` above. */
export function elevationMarkerAngle(
  marker: Pick<ElevationMarkerNode, 'direction' | 'angle'>,
): number {
  switch (marker.direction) {
    case 'north':
      return Math.PI / 2
    case 'east':
      return Math.PI
    case 'south':
      return -Math.PI / 2
    case 'west':
      return 0
    default:
      return marker.angle
  }
}
