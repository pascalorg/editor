import * as THREE from 'three'
import { getAnalyticalNormal, getSurfaceY } from '../shared/roof-surface'

export { getAnalyticalNormal, getSurfaceY }

export function paneSize(value: number): number {
  return Math.max(0.02, value)
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function buildLanternGlassGeometry(
  width: number,
  depth: number,
  lanternHeight: number,
  topScale: number,
): THREE.BufferGeometry {
  const baseHalfW = paneSize(width) / 2
  const baseHalfD = paneSize(depth) / 2
  const resolvedTopScale = clamp01(topScale)
  const topHalfW = baseHalfW * resolvedTopScale
  const topHalfD = baseHalfD * resolvedTopScale
  const topY = Math.max(0.05, lanternHeight)

  const positions =
    resolvedTopScale <= 1e-4
      ? [
          -baseHalfW,
          0,
          baseHalfD,
          baseHalfW,
          0,
          baseHalfD,
          0,
          topY,
          0,
          baseHalfW,
          0,
          baseHalfD,
          baseHalfW,
          0,
          -baseHalfD,
          0,
          topY,
          0,
          baseHalfW,
          0,
          -baseHalfD,
          -baseHalfW,
          0,
          -baseHalfD,
          0,
          topY,
          0,
          -baseHalfW,
          0,
          -baseHalfD,
          -baseHalfW,
          0,
          baseHalfD,
          0,
          topY,
          0,
        ]
      : [
          -baseHalfW,
          0,
          baseHalfD,
          baseHalfW,
          0,
          baseHalfD,
          topHalfW,
          topY,
          topHalfD,
          -topHalfW,
          topY,
          topHalfD,
          baseHalfW,
          0,
          baseHalfD,
          baseHalfW,
          0,
          -baseHalfD,
          topHalfW,
          topY,
          -topHalfD,
          topHalfW,
          topY,
          topHalfD,
          baseHalfW,
          0,
          -baseHalfD,
          -baseHalfW,
          0,
          -baseHalfD,
          -topHalfW,
          topY,
          -topHalfD,
          topHalfW,
          topY,
          -topHalfD,
          -baseHalfW,
          0,
          -baseHalfD,
          -baseHalfW,
          0,
          baseHalfD,
          -topHalfW,
          topY,
          topHalfD,
          -topHalfW,
          topY,
          -topHalfD,
        ]
  const indices =
    resolvedTopScale <= 1e-4
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15]

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
