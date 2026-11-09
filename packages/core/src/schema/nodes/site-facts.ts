// The site's facts — its address, parcel and setbacks — and their read-side lift from legacy
// metadata, apart from the node schema so pure readers (the site brief) take no id minting.

import { z } from 'zod'

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
 * from the host's parcel service. `originLngLat` is the geocoded point the polygon
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
  /** A corner lot's second street side, metres; absent = the front setback. */
  streetSide: z.number().optional(),
})
export type SiteSetbacks = z.infer<typeof SiteSetbacks>

/** The fields `migrateSiteMetadata` lifts onto a site node. */
export type SiteMetadataPatch = {
  setbacks?: SiteSetbacks
  setbacksSource?: string
  zone?: string
  parcel?: SiteParcel
}

/**
 * Read-side migration for scenes written before these fields existed, where
 * the plan tooling parked the same values under `metadata`. Returns a patch
 * (empty when there is nothing to lift) — callers merge it onto the node.
 *
 * Only cheap, unambiguous lifts are done here: `metadata.setbacks` (already
 * metres), `metadata.setbacksSource`, `metadata.zone`, `metadata.apn` and
 * `metadata.source`. Anything richer (full imported project records) is
 * left in `metadata` for the workstream that owns it.
 */
export function migrateSiteMetadata(node: {
  metadata?: unknown
  setbacks?: SiteSetbacks | undefined
  setbacksSource?: string | undefined
  zone?: string | undefined
  parcel?: SiteParcel | undefined
}): SiteMetadataPatch {
  const meta = node.metadata as Record<string, unknown> | null | undefined
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {}
  const patch: SiteMetadataPatch = {}

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
