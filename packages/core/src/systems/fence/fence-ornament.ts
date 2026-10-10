import { z } from 'zod'

/**
 * Ironwork drawn as a fence's infill: bands of a repeated motif, stacked bottom
 * to top between the fence's own base and top rail. A design is plain data an
 * author or a model composes from a few words (motif, height share, pitch), so
 * one grammar covers a Parisian balcony, a garden fence and an industrial rail.
 */
export const FenceOrnamentMotifSchema = z.enum([
  'bars',
  'circles',
  'lozenges',
  'crosses',
  'arches',
  'scrolls',
  'waves',
])
export type FenceOrnamentMotif = z.infer<typeof FenceOrnamentMotifSchema>

export const FenceOrnamentBandSchema = z.object({
  motif: FenceOrnamentMotifSchema,
  /** Share of the ironwork's height; the bands' shares are scaled to fill it. */
  height: z.number().positive().max(10).default(1),
  /** Metres per motif along the fence, stretched so whole motifs fill each panel. */
  pitch: z.number().min(0.04).max(1.5).default(0.12),
})
export type FenceOrnamentBand = z.infer<typeof FenceOrnamentBandSchema>

export const FenceOrnamentSchema = z.object({
  /** Bottom to top; a rail runs between neighbouring bands. */
  bands: z.array(FenceOrnamentBandSchema).min(1).max(6),
  /** Square bar section, in metres. */
  bar: z.number().min(0.006).max(0.06).default(0.014),
  /** Uprights about this far apart, the motifs refitted between them; 0 runs the motifs end to end. */
  panel: z.number().min(0).max(6).default(0),
})
export type FenceOrnament = z.infer<typeof FenceOrnamentSchema>

/** A polyline of the ironwork in the fence's plane: u along the fence, v up from the infill's bottom. */
export type FenceOrnamentStroke = {
  points: [number, number][]
  closed?: boolean
  role: 'motif' | 'rail' | 'upright'
  /** The band a motif belongs to. */
  band?: number
}

const TURN = 16

function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
): [number, number][] {
  const steps = Math.max(2, Math.ceil((Math.abs(to - from) / (2 * Math.PI)) * TURN))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = from + ((to - from) * i) / steps
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as [number, number]
  })
}

/** One motif in the cell [u, u + w] × [v, v + h]; `last` closes the panel where a motif needs it. */
function motif(
  kind: FenceOrnamentMotif,
  u: number,
  v: number,
  w: number,
  h: number,
  last: boolean,
): Omit<FenceOrnamentStroke, 'role'>[] {
  const cx = u + w / 2
  const cy = v + h / 2
  switch (kind) {
    case 'bars':
      return [
        {
          points: [
            [cx, v],
            [cx, v + h],
          ],
        },
      ]
    case 'circles': {
      const r = Math.min(w, h) / 2
      const ring = arc(cx, cy, r, r, 0, 2 * Math.PI).slice(0, -1)
      const ties: Omit<FenceOrnamentStroke, 'role'>[] =
        h - 2 * r > 1e-9
          ? [
              {
                points: [
                  [cx, v],
                  [cx, cy - r],
                ],
              },
              {
                points: [
                  [cx, cy + r],
                  [cx, v + h],
                ],
              },
            ]
          : []
      return [{ points: ring, closed: true }, ...ties]
    }
    case 'lozenges':
      return [
        {
          points: [
            [u, cy],
            [cx, v + h],
            [u + w, cy],
            [cx, v],
          ],
          closed: true,
        },
      ]
    case 'crosses':
      return [
        {
          points: [
            [u, v],
            [u + w, v + h],
          ],
        },
        {
          points: [
            [u, v + h],
            [u + w, v],
          ],
        },
      ]
    case 'arches': {
      const r = Math.min(w / 2, h)
      const spring = v + h - r
      const legs: Omit<FenceOrnamentStroke, 'role'>[] = [
        {
          points: [
            [u, v],
            [u, spring],
          ],
        },
      ]
      if (last)
        legs.push({
          points: [
            [u + w, v],
            [u + w, spring],
          ],
        })
      return [...legs, { points: arc(cx, spring, w / 2, r, Math.PI, 0) }]
    }
    case 'scrolls': {
      // An S: a lower curl opening left and an upper one opening right, meeting at the cell's centre.
      const rx = Math.min(w / 2, h / 4)
      const ry = h / 4
      return [
        {
          points: [
            ...arc(cx, v + ry, rx, ry, Math.PI, 2.5 * Math.PI),
            ...arc(cx, v + 3 * ry, rx, ry, -Math.PI / 2, -2 * Math.PI).slice(1),
          ],
        },
      ]
    }
    case 'waves':
      return [
        {
          points: Array.from({ length: 9 }, (_, i) => {
            const t = i / 8
            return [u + w * t, cy + (h / 2) * Math.sin(2 * Math.PI * t)] as [number, number]
          }),
        },
      ]
  }
}

/**
 * The ironwork as polylines for a run `length` long and `height` tall (the
 * infill between the fence's base and top rail). Uprights split the run into
 * equal panels; each band fits a whole number of motifs into every panel.
 */
export function fenceOrnamentStrokes(
  ornament: FenceOrnament,
  { length, height }: { length: number; height: number },
): FenceOrnamentStroke[] {
  if (!(length > 1e-6) || !(height > 1e-6)) return []
  const strokes: FenceOrnamentStroke[] = []
  const panels = ornament.panel > 0 ? Math.max(1, Math.round(length / ornament.panel)) : 1
  const panelWidth = length / panels
  for (let p = 1; p < panels; p++)
    strokes.push({
      role: 'upright',
      points: [
        [p * panelWidth, 0],
        [p * panelWidth, height],
      ],
    })
  const total = ornament.bands.reduce((sum, band) => sum + band.height, 0)
  let below = 0
  ornament.bands.forEach((band, index) => {
    const v = (height * below) / total
    below += band.height
    const top = (height * below) / total
    const count = Math.max(1, Math.round(panelWidth / band.pitch))
    const w = panelWidth / count
    for (let p = 0; p < panels; p++)
      for (let k = 0; k < count; k++)
        for (const stroke of motif(
          band.motif,
          p * panelWidth + k * w,
          v,
          w,
          top - v,
          k === count - 1,
        ))
          strokes.push({ ...stroke, role: 'motif', band: index })
    if (index < ornament.bands.length - 1)
      strokes.push({
        role: 'rail',
        points: [
          [0, top],
          [length, top],
        ],
      })
  })
  return strokes
}

const preset = (value: z.input<typeof FenceOrnamentSchema>) => FenceOrnamentSchema.parse(value)

/** Named designs to start from; a copy is edited, never referenced by name. */
export const FENCE_ORNAMENT_PRESETS: Record<string, FenceOrnament> = {
  /** Tall bars over a lozenge frieze, a ring frieze under the rail: the long Haussmann balcony. */
  'paris-balcony': preset({
    bands: [
      { motif: 'lozenges', height: 0.8, pitch: 0.16 },
      { motif: 'bars', height: 3.2, pitch: 0.11 },
      { motif: 'circles', height: 0.8, pitch: 0.16 },
    ],
  }),
  /** S-scrolls between rings and bars: the window guard of a Haussmann body storey. */
  'paris-balconette': preset({
    bands: [
      { motif: 'scrolls', height: 1.6, pitch: 0.3 },
      { motif: 'bars', height: 1, pitch: 0.1 },
      { motif: 'circles', height: 0.7, pitch: 0.15 },
    ],
  }),
  /** Arcades under a wave: the softer line of 1900. */
  'art-nouveau': preset({
    bands: [
      { motif: 'arches', height: 2.2, pitch: 0.24 },
      { motif: 'waves', height: 0.6, pitch: 0.24 },
    ],
  }),
  /** Crossed panels at the foot, plain bars above. */
  regency: preset({
    bands: [
      { motif: 'crosses', height: 1, pitch: 0.3 },
      { motif: 'bars', height: 3, pitch: 0.12 },
    ],
  }),
  /** Flat bars between uprights: a plain steel guard. */
  industrial: preset({ bar: 0.02, panel: 1.5, bands: [{ motif: 'bars', pitch: 0.1 }] }),
  /** A lattice of crosses, as on a grille. */
  lattice: preset({ bar: 0.012, bands: [{ motif: 'crosses', pitch: 0.18 }] }),
}
