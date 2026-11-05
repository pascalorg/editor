import type { WindowNode } from '@pascal-app/core'
import { BoxGeometry, Group, type Material, Mesh, type Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { applyWorldScaleBoxUVs } from '../../lib/box-uv'

export function buildWindowRollerCurtain(
  node: WindowNode,
  material: Material | Material[],
  z: number,
  open: number,
): Group {
  const curtain = new Group()
  curtain.name = 'window-roller-curtain'
  const slatCount = Math.floor(((1 - open) * node.height) / 0.04)
  if (slatCount <= 0) return curtain
  const slats: BoxGeometry[] = []
  for (let i = 0; i < slatCount; i++) {
    const slat = new BoxGeometry(node.width, 0.036, 0.01)
    applyWorldScaleBoxUVs(slat, node.width, 0.036, 0.01)
    slat.translate(0, node.height / 2 - i * 0.04 - 0.018, 0)
    slats.push(slat)
  }
  const geometry = mergeGeometries(slats)!
  for (const slat of slats) slat.dispose()
  const panel = new Mesh(geometry, material)
  panel.position.z = z
  panel.userData.slotId = 'shutters'
  curtain.add(panel)
  return curtain
}

/** Export clones must use saved topology even when the live curtain is previewing another pose. */
export function restoreWindowRollerShutter(node: WindowNode, mesh: Object3D): void {
  if (node.rollerShutter !== 'box') return
  const curtain = mesh.getObjectByName('window-roller-curtain')
  const guide = mesh.getObjectByName('window-roller-guide') as Mesh | undefined
  if (!curtain?.parent || !guide) return
  const restored = buildWindowRollerCurtain(
    node,
    guide.material,
    guide.position.z,
    node.rollerShutterOpen ?? 1,
  )
  curtain.parent.add(restored)
  curtain.traverse((part) => {
    if (part instanceof Mesh) part.geometry.dispose()
  })
  curtain.removeFromParent()
}
