import type { DuctFittingNode } from '@pascal-app/core'
import { Group, type Material } from 'three'
import { addBox, addProfile, hardwareMaterial } from '../shared/accessory-geometry'

export function buildDuctAccessory(node: DuctFittingNode, material: Material): Group | null {
  if (!['end-cap', 'damper', 'access-panel', 'coupling'].includes(node.fittingType)) return null
  const group = new Group()
  const hardware =
    node.fittingType === 'damper' || node.fittingType === 'access-panel'
      ? hardwareMaterial()
      : material
  if (node.fittingType === 'access-panel') {
    const w = node.panelWidth
    const h = node.panelHeight
    addBox(group, 'access-gasket', [w + 0.012, h + 0.012, 0.004], [0, 0, 0.002], hardware)
    addBox(group, 'access-door', [w, h, 0.012], [0, 0, 0.01], material)
    for (const side of [-1, 1]) {
      addBox(
        group,
        `access-frame-side-${side}`,
        [0.016, h + 0.04, 0.012],
        [side * (w / 2 + 0.012), 0, 0.006],
        material,
      )
      addBox(
        group,
        `access-frame-rail-${side}`,
        [w + 0.04, 0.016, 0.012],
        [0, side * (h / 2 + 0.012), 0.006],
        material,
      )
      addBox(
        group,
        `access-hinge-${side}`,
        [0.028, 0.03, 0.018],
        [-w / 2, side * h * 0.28, 0.018],
        hardware,
      )
      addBox(
        group,
        `access-latch-${side}`,
        [0.025, 0.012, 0.015],
        [w * 0.36, side * h * 0.28, 0.024],
        hardware,
      )
    }
    return group
  }
  const width = (node.shape === 'round' ? node.diameter : node.width) * 0.0254
  const height = (node.shape === 'round' ? node.diameter : node.height) * 0.0254
  const cap = node.fittingType === 'end-cap'
  const half = cap ? 0.025 : 0.1
  addProfile(group, 'accessory-sleeve', node.shape, width, height, -half, half, material, 0.0015)
  for (const x of cap ? [-half] : [-half, half - 0.008]) {
    addProfile(
      group,
      `accessory-flange-${x}`,
      node.shape,
      width + 0.02,
      height + 0.02,
      x,
      x + 0.008,
      material,
      0.011,
    )
  }
  if (cap) {
    addProfile(group, 'end-cap-closure', node.shape, width, height, half - 0.002, half, material)
    addProfile(
      group,
      'end-cap-folded-rim',
      node.shape,
      width + 0.008,
      height + 0.008,
      half - 0.008,
      half,
      material,
      0.006,
    )
  }
  if (node.fittingType === 'damper') {
    const blade = addProfile(
      group,
      'damper-blade',
      node.shape,
      width - 0.006,
      height - 0.006,
      -0.001,
      0.001,
      hardware,
    )
    blade.rotation.z = (-node.damperAngle * Math.PI) / 180
    addBox(group, 'damper-spindle', [0.008, 0.008, width + 0.06], [0, 0, 0], hardware)
    addBox(group, 'damper-bearing', [0.04, 0.04, 0.012], [0, 0, width / 2 + 0.01], material)
    const handle = addBox(
      group,
      'damper-handle',
      [0.015, 0.09, 0.01],
      [0, 0, width / 2 + 0.035],
      hardware,
    )
    handle.geometry.translate(0, 0.035, 0)
    handle.rotation.z = (-node.damperAngle * Math.PI) / 180
  }
  if (node.fittingType === 'coupling')
    addProfile(
      group,
      'coupling-center-seam',
      node.shape,
      width + 0.008,
      height + 0.008,
      -0.004,
      0.004,
      material,
      0.005,
    )
  return group
}
