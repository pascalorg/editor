import type { WindowNode } from '@pascal-app/core'
import { BoxGeometry, Group, type Material, Matrix4, Mesh, type Object3D, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'

/** Measure the closed unit in its own coordinates, including a surface-mounted roller box. */
export function getWindowRollerCurtainZ(mesh: Object3D, exterior: number): number {
  mesh.updateWorldMatrix(true, true)
  const toWindow = mesh.matrixWorld.clone().invert()
  const transform = new Matrix4()
  const vertex = new Vector3()
  let extent = 0
  mesh.traverse((part) => {
    if (
      !(part instanceof Mesh) ||
      part === mesh ||
      (!['frame', 'glass', 'hardware'].includes(part.userData.slotId) &&
        part.name !== 'window-roller-box')
    )
      return
    transform.multiplyMatrices(toWindow, part.matrixWorld)
    const position = part.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(transform)
      extent = Math.max(extent, vertex.z * exterior)
    }
  })
  return exterior * (extent + 0.015)
}

export function buildWindowRollerCurtain(
  node: WindowNode,
  material: Material | Material[],
  z: number,
  open: number,
): Group {
  const curtain = new Group()
  curtain.name = 'window-roller-curtain'
  curtain.position.z = z
  const width = node.width - (node.rollerShutter === 'concealed' ? 2 * 0.025 : 0)
  const slatCount = Math.floor(((1 - open) * node.height) / 0.04)
  if (slatCount <= 0) return curtain
  const slats: BoxGeometry[] = []
  for (let i = 0; i < slatCount; i++) {
    const slat = new BoxGeometry(width, 0.036, 0.01)
    applyWorldScaleBoxUVs(slat, width, 0.036, 0.01)
    slat.translate(0, node.height / 2 - i * 0.04 - 0.018, 0)
    slats.push(slat)
  }
  const geometry = mergeGeometries(slats)!
  for (const slat of slats) slat.dispose()
  const panel = new Mesh(geometry, material)
  panel.userData.slotId = 'shutters'
  curtain.add(panel)
  return curtain
}

/** Export clones must use saved topology even when the live curtain is previewing another pose. */
export function restoreWindowRollerShutter(node: WindowNode, mesh: Object3D): void {
  if (node.rollerShutter !== 'box' && node.rollerShutter !== 'concealed') return
  const curtain = mesh.getObjectByName('window-roller-curtain')
  const guide = mesh.getObjectByName('window-roller-guide') as Mesh | undefined
  if (!curtain?.parent || !guide) return
  const restored = buildWindowRollerCurtain(
    node,
    guide.material,
    curtain.position.z,
    node.rollerShutterOpen ?? 1,
  )
  curtain.parent.add(restored)
  curtain.traverse((part) => {
    if (part instanceof Mesh) part.geometry.dispose()
  })
  curtain.removeFromParent()
}
