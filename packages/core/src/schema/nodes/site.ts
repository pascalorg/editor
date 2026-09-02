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
 * Mailing / civic address the lot was resolved from. Every field is optional —
 * a hand-drawn site has no address and must still parse.
 */
export const SiteAddress = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
})
export type SiteAddress = z.infer<typeof SiteAddress>

/**
 * Provenance of the lot ring. Written by the site panel's "Find parcel" action
 * from `/api/parcel/resolve`. `originLngLat` is the geocoded point the polygon
 * origin sits on (polygon points are metres, x east, z south).
 */
export const SiteParcel = z.object({
  apn: z.string().optional(),
  source: z.string().optional(),
  county: z.string().optional(),
  state: z.string().optional(),
  lotAreaSqFt: z.number().optional(),
  originLngLat: z.tuple([z.number(), z.number()]).optional(),
  resolvedAt: z.string().optional(),
  /** GIS layer / registry the polygon came from, e.g. `arcgis-fl`. */
  layer: z.string().optional(),
  notes: z.array(z.string()).optional(),
})
export type SiteParcel = z.infer<typeof SiteParcel>

/** Required yards, METRES. `left` / `right` override `side` per-edge when set. */
export const SiteSetbacks = z.object({
  front: z.number(),
  side: z.number(),
  rear: z.number(),
  left: z.number().optional(),
  right: z.number().optional(),
})
export type SiteSetbacks = z.infer<typeof SiteSetbacks>

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
  /** Rotation of true north relative to plan −z (up), RADIANS, clockwise. */
  northRotation: z.number().optional(),
  children: z.array(z.string()).default([]),
}).describe(
  dedent`
  Site node - used to represent a site
  - polygon: polygon data (metres, x east, z south, origin = geocoded point)
  - terrain: optional sculpted heightfield; absent means flat ground
  - address / parcel: civic address + GIS parcel provenance (optional)
  - setbacks: required yards in metres; setbacksSource / zone cite them
  - frontEdge: index of the street-facing polygon edge
  - northRotation: true north offset from plan up, radians
  - children: array of child node ids (buildings, items)
  `,
)

/**
 * Read-side migration for scenes written before these fields existed, where
 * the plan tooling parked the same values under `metadata`. Returns a patch
 * (empty when there is nothing to lift) — callers merge it onto the node.
 *
 * Only cheap, unambiguous lifts are done here: `metadata.setbacks` (already
 * metres), `metadata.setbacksSource`, `metadata.zone`, `metadata.apn` and
 * `metadata.source`. Anything richer (full PlanCrafters project records) is
 * left in `metadata` for the workstream that owns it.
 */
export function migrateSiteMetadata(node: {
  metadata?: unknown
  setbacks?: SiteSetbacks | undefined
  setbacksSource?: string | undefined
  zone?: string | undefined
  parcel?: SiteParcel | undefined
}): Partial<SiteNode> {
  const meta = node.metadata as Record<string, unknown> | null | undefined
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const patch: Partial<SiteNode> = {}

  if (!node.setbacks) {
    const parsed = SiteSetbacks.safeParse(meta.setbacks)
    if (parsed.success) patch.setbacks = parsed.data
  }
  if (!node.setbacksSource && typeof meta.setbacksSource === 'string') {
    patch.setbacksSource = meta.setbacksSource
  }
  if (!node.zone && typeof meta.zone === 'string') patch.zone = meta.zone

  if (!node.parcel && (typeof meta.apn === 'string' || typeof meta.source === 'string')) {
    patch.parcel = {
      ...(typeof meta.apn === 'string' ? { apn: meta.apn } : {}),
      ...(typeof meta.source === 'string' ? { source: meta.source } : {}),
    }
  }

  return patch
}

export type SiteNode = z.infer<typeof SiteNode>
