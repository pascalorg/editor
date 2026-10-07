import type { BufferGeometry } from 'three'

export const CURTAIN_WALL_SHADOW_NAME = 'curtain-wall-shadow'

export function buildCurtainWallShadowGeometry(
  source: BufferGeometry,
  opaqueGlass: boolean,
): BufferGeometry {
  const geometry = source.clone()
  const indices: number[] = []
  for (const group of source.groups) {
    if (group.materialIndex === 1 && !opaqueGlass) continue
    for (let i = group.start; i < group.start + group.count; i++)
      indices.push(source.index ? source.index.getX(i) : i)
  }
  geometry.clearGroups()
  geometry.setIndex(indices)
  geometry.setDrawRange(0, indices.length)
  return geometry
}
