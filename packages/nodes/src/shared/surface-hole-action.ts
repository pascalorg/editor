import type { SurfaceHoleMetadata } from '@pascal-app/core'

type SurfaceWithHoles = {
  polygon: Array<[number, number]>
  holes?: Array<Array<[number, number]>>
  holeMetadata?: SurfaceHoleMetadata[]
}

export function buildDefaultSurfaceHolePatch<N extends SurfaceWithHoles>(
  node: N,
): Pick<N, 'holes' | 'holeMetadata'> | null {
  if (node.polygon.length < 3) return null

  let cx = 0
  let cz = 0
  for (const [x, z] of node.polygon) {
    cx += x
    cz += z
  }
  cx /= node.polygon.length
  cz /= node.polygon.length

  const holeSize = 0.5
  const newHole: Array<[number, number]> = [
    [cx - holeSize, cz - holeSize],
    [cx + holeSize, cz - holeSize],
    [cx + holeSize, cz + holeSize],
    [cx - holeSize, cz + holeSize],
  ]
  const currentHoles = node.holes ?? []
  const currentMetadata = currentHoles.map(
    (_, index) => node.holeMetadata?.[index] ?? { source: 'manual' as const },
  )

  return {
    holes: [...currentHoles, newHole],
    holeMetadata: [...currentMetadata, { source: 'manual' as const }],
  } as Pick<N, 'holes' | 'holeMetadata'>
}
