// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { SitePresentation } from '../site-presentation'
import { TerrainData } from '../terrain'
import { SiteAddress, SiteParcel, SiteSetbacks } from './site-facts'

// 2D Polygon
const PropertyLineData = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])),
})

/**
 * What the site keeps of a Pascal Map location dossier
 * (https://map.pascal.app/api/docs): when it was assembled, the point and
 * address it was evaluated at, every section's status / summary / source,
 * and the geometry-free data of the sections the plan set acts on. Loose
 * records on purpose — the platform adds fields without a version bump and
 * the plan set ignores what it does not know. A section that did not answer
 * (`not_covered` / `not_available`) is recorded as such: never a negative
 * finding.
 */
const DossierSectionRecord = z
  .object({
    status: z.string(),
    summary: z.string().optional(),
    reason: z.string().optional(),
    source: z
      .object({
        name: z.string().optional(),
        kind: z.string().optional(),
        vintage: z.string().optional(),
        attribution: z.string().optional(),
      })
      .optional(),
  })
  .passthrough()
const Facts = z.record(z.string(), z.unknown())
export const SiteDossier = z
  .object({
    provider: z.string(),
    asOf: z.string(),
    point: z
      .object({
        lat: z.number().optional(),
        lng: z.number().optional(),
        source: z.string().optional(),
      })
      .optional(),
    address: z
      .object({ formatted: z.string().optional(), precision: z.string().optional() })
      .optional(),
    sections: z.record(z.string(), DossierSectionRecord),
    parcel: Facts.optional(),
    flood: Facts.optional(),
    codeBasis: Facts.optional(),
    zoning: Facts.optional(),
    utilities: Facts.optional(),
    soils: Facts.optional(),
    wetlands: Facts.optional(),
    structures: Facts.optional(),
    elevation: Facts.optional(),
    boundaries: Facts.optional(),
  })
  .passthrough()
export type SiteDossier = z.infer<typeof SiteDossier>

export const SiteNode = BaseNode.extend({
  id: objectId('site'),
  type: nodeType('site'),
  // Specific props
  polygon: PropertyLineData.optional().default({
    type: 'polygon',
    // Default 30x30 square centered at origin
    points: [
      [-15, -15],
      [15, -15],
      [15, 15],
      [-15, 15],
    ],
  }),
  /**
   * Sculpted ground. Absent means flat ground at the datum — the state every
   * scene that predates terrain is in, and the state an untouched site stays in
   * so ~11 KB of base64 zeroes does not land in every saved scene.
   */
  terrain: TerrainData.optional(),
  /** Hide site ground, including sculpted terrain, and the horizon when other geometry supplies them. */
  showGround: z.boolean().optional(),
  presentation: SitePresentation.optional(),
  /**
   * Address + parcel provenance. All optional so every scene that predates
   * the parcel service keeps loading unchanged.
   */
  address: SiteAddress.optional(),
  parcel: SiteParcel.optional(),
  /** Required yards in METRES (the UI takes feet and converts). */
  setbacks: SiteSetbacks.optional(),
  /** Where the setback numbers came from — 'zoning-code', 'manual', a citation. */
  setbacksSource: z.string().optional(),
  /** Zoning district label, e.g. 'RS-60'. */
  zone: z.string().optional(),
  /**
   * Index into `polygon.points` of the edge that faces the street — the edge
   * that takes the FRONT setback. The edge runs from point[frontEdge] to
   * point[(frontEdge + 1) % n]. Undefined = derive the most north-facing edge.
   */
  frontEdge: z.number().int().nonnegative().optional(),
  /** Every edge that fronts a street per the parcel fabric (a corner lot has two or more); the front is one of them. */
  streetEdges: z.array(z.number().int().nonnegative()).optional(),
  /** The corner sight (clear-vision) triangle's leg along each right-of-way line, FEET; absent = none drawn. */
  sightTriangleFt: z.number().nonnegative().optional(),
  /** Rotation of true north relative to plan −z (up), RADIANS, clockwise. */
  northRotation: z.number().optional(),
  /** The Pascal Map dossier the lot was dropped in with — see SiteDossier. */
  dossier: SiteDossier.optional(),
  /**
   * Contour interval for the site plan's terrain lines, INCHES (6, 12, 24…).
   * Absent = 12 in; 0 = no contours. The generate panel's terrain setting.
   */
  contourIntervalIn: z.number().nonnegative().optional(),
  /** Draw the contour lines on the 3D ground too (thin, translucent black). Default off. */
  contours3d: z.boolean().optional(),
  /**
   * Surveyed contour lines in the site frame (metres, x east, z south) —
   * the Pascal Map dossier's USGS 3DEP bare-earth 1-ft lines, NAVD88 feet.
   * The site plan draws these when present (at the chosen interval) instead
   * of contouring the heightfield.
   */
  terrainContours: z
    .object({
      datum: z.string(),
      intervalFt: z.number().positive(),
      source: z.string().optional(),
      lines: z.array(
        z.object({
          elevationFt: z.number(),
          points: z.array(z.tuple([z.number(), z.number()])),
        }),
      ),
    })
    .optional(),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data (metres, x east, z south, origin = geocoded point)
  - terrain: optional sculpted heightfield; absent means flat ground
  - showGround: false hides site ground (including sculpted terrain) and horizon in 3D; buildings and parcel lines remain
  - presentation: optional project rendering defaults (theme, lighting, exposure, shading, edges and postprocessing); local viewer choices override them
  - address / parcel: civic address + GIS parcel provenance (optional)
  - setbacks: required yards in metres; setbacksSource / zone cite them
  - frontEdge: index of the street-facing polygon edge
  - northRotation: true north offset from plan up, radians
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
