// lib/scenegraph/schema/nodes/site.ts

import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { TerrainData } from '../terrain'

// 2D Polygon
const PropertyLineData = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([z.number(), z.number()])),
})

/**
 * Where the parcel boundary came from. Absent on a lot line somebody drew.
 *
 * Kept alongside the polygon rather than folded into it because provenance
 * outlives the geometry: the user may nudge a vertex, and the drawing has to
 * keep saying which registry record it started from and that it has since been
 * touched.
 */
export const ParcelRecord = z.object({
  source: z.enum(['tkgm', 'manual']),
  il: z.string(),
  ilce: z.string(),
  mahalle: z.string(),
  mahalleId: z.number().int(),
  ada: z.string(),
  parsel: z.string(),
  /**
   * The registry's own recorded area, m². It can disagree with the area of the
   * polygon — which of the two to believe is the user's call, not ours.
   */
  registeredArea: z.number().positive().optional(),
  nitelik: z.string().optional(),
  pafta: z.string().optional(),
  fetchedAt: z.string(),
  /** Set once the user edits the imported polygon by hand. */
  edited: z.boolean().default(false),
})

export type ParcelRecord = z.infer<typeof ParcelRecord>

/** A per-edge setback. Edge `i` runs `polygon.points[i] → points[i + 1]`. */
export const SetbackRule = z.object({
  role: z.enum(['road', 'side', 'rear']).default('side'),
  distance: z.number().finite().min(0).default(3),
})

export type SetbackRule = z.infer<typeof SetbackRule>

/** Zoning allowances, entered by hand — no registry publishes them. */
export const ZoningLimits = z.object({
  /** Taban alanı kat sayısı: footprint as a fraction of the parcel. */
  taks: z.number().finite().min(0).max(1).optional(),
  /** Emsal: total floor area as a multiple of the parcel. */
  kaks: z.number().finite().min(0).optional(),
  /** Hmax, metres. */
  maxHeight: z.number().finite().positive().optional(),
  maxFloors: z.number().int().positive().optional(),
  /** Ayrık / bitişik / blok nizam. */
  order: z.enum(['detached', 'adjacent', 'block']).optional(),
})

export type ZoningLimits = z.infer<typeof ZoningLimits>

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
  /**
   * True compass bearing that plan-up (-Z) points at, in degrees. Zero — the
   * default every existing scene loads with — means the model is drawn north-up.
   *
   * Without this a sun angle is a decoration rather than an analysis: an
   * azimuth means nothing until the model's own bearing is known.
   */
  northOffset: z.number().finite().min(0).max(360).default(0),
  /**
   * Where on earth the site is, for solar geometry. Absent means unplaced, and
   * a sun study has to ask before it can say anything — which is honest, where
   * defaulting to a made-up city would silently produce wrong shadows.
   */
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  /** Which registry parcel this boundary is. Absent on a hand-drawn site. */
  parcel: ParcelRecord.optional(),
  /**
   * Edge index → setback, sparse: an edge nobody has touched uses
   * `defaultSetback`. Sparse rather than an array because most edges of most
   * parcels share one number, and because an array would have to be resized in
   * lockstep with every vertex the user adds.
   */
  setbacks: z.record(z.string(), SetbackRule).default({}),
  defaultSetback: z.number().finite().min(0).default(0),
  zoning: ZoningLimits.optional(),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data
  - terrain: optional sculpted heightfield; absent means flat ground
  - northOffset: true bearing of plan-up in degrees; 0 means drawn north-up
  - latitude/longitude: site location in degrees, for solar position; absent means unplaced
  - parcel: cadastral record the boundary was imported from; absent if drawn by hand
  - setbacks: edge index -> {role, distance}; edges not listed use defaultSetback
  - defaultSetback: fallback setback distance in metres for unlisted edges
  - zoning: TAKS/KAKS/Hmax allowances, entered by hand
  - children: array of child node ids (buildings, items)
  `,
)

export type SiteNode = z.infer<typeof SiteNode>
