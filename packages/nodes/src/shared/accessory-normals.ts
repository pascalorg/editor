import type { BufferGeometry } from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Smooth shallow curved facets while preserving folded sheet edges and triangle topology. */
export function finishAccessoryNormals<T extends BufferGeometry | null>(geometry: T): T {
  if (!geometry || geometry.index) return geometry
  toCreasedNormals(geometry, Math.PI / 6)
  return geometry
}
