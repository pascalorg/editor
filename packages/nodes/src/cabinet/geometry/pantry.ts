import { Group, Mesh } from 'three'
import {
  type CabinetCompartment,
  compartmentPullOutPantryRackStyle,
  compartmentShelfCount,
  type PullOutPantryRackStyle,
} from '../stack'
import { addBarHandle, buildFrontGeometry } from './fronts'
import { addBox, type CabinetGeometryNode, type CabinetSlotMaterials, stampSlot } from './shared'

function addPullOutPantryBasket(
  group: Group,
  materials: CabinetSlotMaterials,
  width: number,
  depth: number,
  y: number,
  zCenter: number,
  name: string,
  rackStyle: PullOutPantryRackStyle,
  toLocal: (position: [number, number, number]) => [number, number, number],
) {
  const rail = 0.008
  const basketHeight = 0.045
  const panelHeight = 0.07
  if (rackStyle !== 'wire') {
    const material = rackStyle === 'glass' ? materials.glass : materials.carcass
    const panelThickness = rackStyle === 'glass' ? 0.006 : 0.012
    addBox(
      group,
      [width, panelThickness, depth],
      toLocal([0, y, zCenter]),
      material,
      `${name}-${rackStyle}-tray-floor`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    addBox(
      group,
      [width, panelHeight, panelThickness],
      toLocal([0, y + panelHeight / 2, zCenter + depth / 2 - panelThickness / 2]),
      material,
      `${name}-${rackStyle}-front-panel`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    addBox(
      group,
      [width, panelHeight, panelThickness],
      toLocal([0, y + panelHeight / 2, zCenter - depth / 2 + panelThickness / 2]),
      material,
      `${name}-${rackStyle}-back-panel`,
      rackStyle === 'glass' ? 'glass' : 'carcass',
    )
    for (const side of [-1, 1]) {
      addBox(
        group,
        [panelThickness, panelHeight, depth],
        toLocal([side * (width / 2 - panelThickness / 2), y + panelHeight / 2, zCenter]),
        material,
        `${name}-${rackStyle}-${side < 0 ? 'left' : 'right'}-panel`,
        rackStyle === 'glass' ? 'glass' : 'carcass',
      )
    }
    return
  }

  addBox(
    group,
    [width, rail, depth],
    toLocal([0, y, zCenter]),
    materials.hardware,
    `${name}-floor`,
    'hardware',
  )
  addBox(
    group,
    [width, rail, rail],
    toLocal([0, y + basketHeight, zCenter + depth / 2 - rail / 2]),
    materials.hardware,
    `${name}-front-rail`,
    'hardware',
  )
  addBox(
    group,
    [width, rail, rail],
    toLocal([0, y + basketHeight, zCenter - depth / 2 + rail / 2]),
    materials.hardware,
    `${name}-back-rail`,
    'hardware',
  )
  for (const side of [-1, 1]) {
    addBox(
      group,
      [rail, basketHeight, depth],
      toLocal([side * (width / 2 - rail / 2), y + basketHeight / 2, zCenter]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-side-rail`,
      'hardware',
    )
  }
  for (let i = 1; i <= 3; i += 1) {
    addBox(
      group,
      [rail, basketHeight * 0.72, depth * 0.84],
      toLocal([-width / 2 + (width * i) / 4, y + basketHeight * 0.48, zCenter]),
      materials.hardware,
      `${name}-divider-${i}`,
      'hardware',
    )
  }
}

export function addPullOutPantryCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  faceWidth: number,
  faceHeight: number,
  faceCenterY: number,
  openingWidth: number,
  openingDepth: number,
  frontZ: number,
  compartment: CabinetCompartment,
  index: number,
) {
  const name = `cabinet-pull-out-pantry-${index}`
  const rackStyle = compartmentPullOutPantryRackStyle(compartment)
  const frontWidth = Math.max(0.01, faceWidth - node.frontGap * 2)
  const frontHeight = Math.max(0.01, faceHeight - node.frontGap * 2)
  const rackWidth = Math.max(0.04, Math.min(openingWidth - 0.05, frontWidth - 0.04))
  const rackDepth = Math.max(0.08, openingDepth - 0.08)
  const rackHeight = Math.max(0.12, frontHeight - 0.14)
  const rackCenterY = faceCenterY
  const rackCenterZ = frontZ - node.frontThickness / 2 - rackDepth / 2 - 0.025
  const openDistance = Math.min(rackDepth * 0.82, 0.48)
  const openScale = node.operationState ?? 0
  const motion = new Group()
  motion.name = `${name}-slide`
  motion.position.set(0, 0, openDistance * openScale)
  motion.userData.cabinetPose = { type: 'translate', axis: 'z', distance: openDistance }
  group.add(motion)
  const toLocal = (position: [number, number, number]): [number, number, number] => position

  const front = stampSlot(
    new Mesh(buildFrontGeometry(node, frontWidth, frontHeight, false, null), materials.front),
    'front',
  )
  front.name = `${name}-front`
  front.position.set(...toLocal([0, faceCenterY, frontZ]))
  front.castShadow = true
  front.receiveShadow = true
  motion.add(front)

  if (node.handleStyle !== 'cutout' && node.handleStyle !== 'hole') {
    const handleLength = Math.max(0.18, Math.min(frontHeight * 0.52, 0.72))
    addBarHandle(
      motion,
      toLocal([0, faceCenterY, frontZ + node.frontThickness / 2]),
      handleLength,
      true,
      `${name}-handle`,
      materials.hardware,
    )
  }

  const rail = 0.01
  for (const side of [-1, 1]) {
    addBox(
      motion,
      [rail, rackHeight, rail],
      toLocal([
        side * (rackWidth / 2 - rail / 2),
        rackCenterY,
        rackCenterZ - rackDepth / 2 + rail / 2,
      ]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-rear-upright`,
      'hardware',
    )
    addBox(
      motion,
      [rail, rackHeight, rail],
      toLocal([
        side * (rackWidth / 2 - rail / 2),
        rackCenterY,
        rackCenterZ + rackDepth / 2 - rail / 2,
      ]),
      materials.hardware,
      `${name}-${side < 0 ? 'left' : 'right'}-front-upright`,
      'hardware',
    )
  }

  const basketCount = Math.max(2, Math.min(8, Math.floor(compartmentShelfCount(compartment))))
  const bottomY = rackCenterY - rackHeight / 2 + 0.08
  const usableHeight = Math.max(0.1, rackHeight - 0.16)
  for (let i = 0; i < basketCount; i += 1) {
    const y = bottomY + (usableHeight * i) / Math.max(1, basketCount - 1)
    addPullOutPantryBasket(
      motion,
      materials,
      rackWidth,
      rackDepth,
      y,
      rackCenterZ,
      `${name}-basket-${i}`,
      rackStyle,
      toLocal,
    )
  }

  addBox(
    motion,
    [rackWidth * 0.72, 0.012, rackDepth],
    toLocal([0, rackCenterY + rackHeight / 2 - 0.018, rackCenterZ]),
    materials.hardware,
    `${name}-top-tie`,
    'hardware',
  )
  addBox(
    motion,
    [rackWidth * 0.72, 0.012, rackDepth],
    toLocal([0, rackCenterY - rackHeight / 2 + 0.018, rackCenterZ]),
    materials.hardware,
    `${name}-bottom-tie`,
    'hardware',
  )
}
