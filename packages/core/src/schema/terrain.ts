import { z } from 'zod'

/** Current authoring and decoding ceiling. */
export const MAX_TERRAIN_SIDE = 257

/**
 * The persisted shape of a terrain heightfield.
 *
 * Kept in `schema/` rather than beside the codec because this is the contract
 * the scene graph validates on load, and `lib/terrain-codec.ts` imports the type
 * from here so there is exactly one definition of the wire format.
 *
 * `heights` is base64 of little-endian Int16 — see `lib/terrain-codec.ts` for why
 * that beats a JSON number array, and why it is not compressed. The schema is
 * intentionally loose about the *contents* of that string: validating base64
 * here would duplicate the decoder, and `decodeTerrainField` already returns
 * `null` for anything it cannot read, which is the behaviour a corrupt scene
 * needs (load flat, don't fail the project).
 */
export const TerrainData = z.object({
  type: z.literal('heightfield'),
  /** World XZ of sample [0,0]. */
  origin: z.tuple([z.number().finite(), z.number().finite()]),
  /** Metres between adjacent samples. */
  spacing: z.number().finite().positive(),
  cols: z.number().int().positive().max(MAX_TERRAIN_SIDE),
  rows: z.number().int().positive().max(MAX_TERRAIN_SIDE),
  /** Metres per height unit — the quantization ladder. */
  step: z.number().finite().positive(),
  /** Base64 of `cols * rows` little-endian Int16 samples, row-major. */
  heights: z.string(),
})

export type TerrainData = z.infer<typeof TerrainData>
