import { BufferAttribute, type BufferGeometry, Mesh, type Object3D } from 'three'

type UVChannel = { original: BufferAttribute; drawn: BufferAttribute; vertical: Float32Array }
type DrawnGeometry = { original: BufferGeometry; drawn: BufferGeometry; channels: UVChannel[] }
const geometryByRoot = new WeakMap<Object3D, Map<Mesh, DrawnGeometry>>()

function verticalDerivatives(geometry: BufferGeometry, uv: BufferAttribute): Float32Array {
  const positions = geometry.getAttribute('position')
  const vertical = new Float32Array(uv.count * 2)
  if (!positions) return vertical
  const count = geometry.index?.count ?? positions.count
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const first = geometry.index?.getX(offset) ?? offset
    const second = geometry.index?.getX(offset + 1) ?? offset + 1
    const third = geometry.index?.getX(offset + 2) ?? offset + 2
    const dy1 = positions.getY(second) - positions.getY(first)
    const dy2 = positions.getY(third) - positions.getY(first)
    const dx1 = positions.getX(second) - positions.getX(first)
    const dx2 = positions.getX(third) - positions.getX(first)
    const dz1 = positions.getZ(second) - positions.getZ(first)
    const dz2 = positions.getZ(third) - positions.getZ(first)
    const useX = Math.abs(dy1 * dx2 - dy2 * dx1) > Math.abs(dy1 * dz2 - dy2 * dz1)
    const horizontal1 = useX ? dx1 : dz1
    const horizontal2 = useX ? dx2 : dz2
    const determinant = dy1 * horizontal2 - dy2 * horizontal1
    if (Math.abs(determinant) < 1e-10) continue
    const du =
      ((uv.getX(second) - uv.getX(first)) * horizontal2 -
        (uv.getX(third) - uv.getX(first)) * horizontal1) /
      determinant
    const dv =
      ((uv.getY(second) - uv.getY(first)) * horizontal2 -
        (uv.getY(third) - uv.getY(first)) * horizontal1) /
      determinant
    for (const vertex of [first, second, third]) {
      vertical[vertex * 2] = du
      vertical[vertex * 2 + 1] = dv
    }
  }
  return vertical
}

function cloneDrawnGeometry(mesh: Mesh): DrawnGeometry | null {
  const original = mesh.geometry
  const channels: UVChannel[] = []
  for (const name of ['uv', 'uv1', 'uv2', 'uv3']) {
    const attribute = original.getAttribute(name)
    if (attribute instanceof BufferAttribute) {
      const uv = attribute
      channels.push({
        original: uv,
        drawn: uv.clone(),
        vertical: verticalDerivatives(original, uv),
      })
    }
  }
  if (channels.length === 0) return null
  const drawn = original.clone()
  let channel = 0
  for (const name of ['uv', 'uv1', 'uv2', 'uv3']) {
    const attribute = original.getAttribute(name)
    if (attribute instanceof BufferAttribute) {
      const entry = channels[channel++]
      if (entry) drawn.setAttribute(name, entry.drawn)
    }
  }
  mesh.geometry = drawn
  return { original, drawn, channels }
}

/** Keep tiles per metre while a wall rises, without changing shared materials or cached geometry. */
export function setRiseTextureScale(root: Object3D, scaleY: number, pivotY: number): void {
  let geometries = geometryByRoot.get(root)
  if (!geometries) {
    geometries = new Map()
    geometryByRoot.set(root, geometries)
  }
  const owned = geometries
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    let entry = owned.get(object)
    if (entry && object.geometry !== entry.drawn) {
      entry.drawn.dispose()
      owned.delete(object)
      entry = undefined
    }
    if (!entry) {
      const cloned = cloneDrawnGeometry(object)
      if (!cloned) return
      entry = cloned
      owned.set(object, entry)
    }
    const positions = entry.original.getAttribute('position')
    if (!positions) return
    for (const channel of entry.channels) {
      for (let vertex = 0; vertex < channel.original.count; vertex += 1) {
        const shift = (scaleY - 1) * (positions.getY(vertex) - pivotY)
        channel.drawn.setXY(
          vertex,
          channel.original.getX(vertex) + shift * (channel.vertical[vertex * 2] ?? 0),
          channel.original.getY(vertex) + shift * (channel.vertical[vertex * 2 + 1] ?? 0),
        )
      }
      channel.drawn.needsUpdate = true
    }
  })
}

export function clearRiseTextureScale(root: Object3D): void {
  const geometries = geometryByRoot.get(root)
  if (!geometries) return
  for (const [mesh, entry] of geometries) {
    if (mesh.geometry === entry.drawn) mesh.geometry = entry.original
    entry.drawn.dispose()
  }
  geometryByRoot.delete(root)
}
