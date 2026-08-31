import type { AnyNode, AnyNodeId, GeometryContext } from '@pascal-app/core'
import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  type Group,
  Mesh,
  Shape,
} from 'three'
import {
  type CabinetHoodCompartmentType,
  DEFAULT_CEILING_HEIGHT,
  HOOD_CANOPY_DEPTH,
  HOOD_CURVED_BODY_HEIGHT,
  HOOD_DUCT_SIZE,
} from '../stack'
import { addBox, type CabinetGeometryNode, type CabinetSlotMaterials, stampSlot } from './shared'

function buildFrustumGeometry(
  bottomWidth: number,
  bottomDepth: number,
  topWidth: number,
  topDepth: number,
  height: number,
  topOffsetZ: number,
): BufferGeometry {
  const bx = bottomWidth / 2
  const bz = bottomDepth / 2
  const tx = topWidth / 2
  const tz = topDepth / 2
  const b0 = [-bx, 0, -bz]
  const b1 = [bx, 0, -bz]
  const b2 = [bx, 0, bz]
  const b3 = [-bx, 0, bz]
  const t0 = [-tx, height, topOffsetZ - tz]
  const t1 = [tx, height, topOffsetZ - tz]
  const t2 = [tx, height, topOffsetZ + tz]
  const t3 = [-tx, height, topOffsetZ + tz]
  const quads: number[][][] = [
    [b3, b2, t2, t3],
    [b1, b0, t0, t1],
    [b0, b3, t3, t0],
    [b2, b1, t1, t2],
    [t0, t3, t2, t1],
    [b0, b1, b2, b3],
  ]
  const positions: number[] = []
  for (const [a, b, c, d] of quads) {
    positions.push(...a!, ...b!, ...c!, ...a!, ...c!, ...d!)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function resolveHoodDuctTopY(node: CabinetGeometryNode, ctx: GeometryContext | undefined): number {
  let baseY = node.position?.[1] ?? 0
  let cursor: AnyNode | null = ctx?.parent ?? null
  let guard = 0
  while (cursor && (cursor.type === 'cabinet' || cursor.type === 'cabinet-module') && guard < 8) {
    const position = (cursor as { position?: unknown }).position
    if (Array.isArray(position) && typeof position[1] === 'number') baseY += position[1]
    cursor = cursor.parentId ? (ctx?.resolve<AnyNode>(cursor.parentId as AnyNodeId) ?? null) : null
    guard += 1
  }
  let ceiling = DEFAULT_CEILING_HEIGHT
  const levelChildren = (cursor as { children?: unknown } | null)?.children
  if (Array.isArray(levelChildren)) {
    const wallHeights = levelChildren
      .map((id) => ctx?.resolve<AnyNode>(id as AnyNodeId))
      .filter((child): child is AnyNode => child?.type === 'wall')
      .map((wall) => (wall as { height?: number }).height ?? DEFAULT_CEILING_HEIGHT)
    if (wallHeights.length > 0) ceiling = Math.max(...wallHeights)
  }
  return ceiling - baseY
}

export function addRangeHoodCompartment(
  group: Group,
  node: CabinetGeometryNode,
  materials: CabinetSlotMaterials,
  kind: CabinetHoodCompartmentType,
  bottomY: number,
  height: number,
  ctx: GeometryContext | undefined,
  index: number,
) {
  const width = node.width
  const backZ = -node.depth / 2
  const canopyCenterZ = backZ + HOOD_CANOPY_DEPTH / 2
  const ductCenterZ = backZ + HOOD_DUCT_SIZE / 2 + 0.02
  const name = `cabinet-${kind}-${index}`

  let ductBottomY: number
  if (kind === 'hood-pyramid') {
    const frustum = buildFrustumGeometry(
      width,
      HOOD_CANOPY_DEPTH,
      HOOD_DUCT_SIZE + 0.04,
      HOOD_DUCT_SIZE + 0.04,
      height,
      ductCenterZ - canopyCenterZ,
    )
    const canopy = stampSlot(new Mesh(frustum, materials.appliance), 'appliance')
    canopy.name = `${name}-canopy`
    canopy.position.set(0, bottomY, canopyCenterZ)
    canopy.castShadow = true
    canopy.receiveShadow = true
    group.add(canopy)

    addBox(
      group,
      [width, 0.02, HOOD_CANOPY_DEPTH],
      [0, bottomY + 0.01, canopyCenterZ],
      materials.appliance,
      `${name}-rim`,
      'appliance',
    )
    ductBottomY = bottomY + height
  } else {
    const bodyDepth = Math.min(0.3, HOOD_CANOPY_DEPTH)
    const bodyCenterZ = backZ + bodyDepth / 2
    addBox(
      group,
      [width, HOOD_CURVED_BODY_HEIGHT, bodyDepth],
      [0, bottomY + HOOD_CURVED_BODY_HEIGHT / 2, bodyCenterZ],
      materials.appliance,
      `${name}-body`,
      'appliance',
    )

    const glassThickness = 0.008
    const zFront = backZ + bodyDepth
    const zBack = backZ + 0.04
    const yBottom = bottomY + HOOD_CURVED_BODY_HEIGHT
    const yTop = bottomY + height
    const profile = new Shape()
    profile.moveTo(zFront, yBottom)
    profile.quadraticCurveTo(zFront, yTop, zBack, yTop)
    profile.lineTo(zBack, yTop - glassThickness)
    profile.quadraticCurveTo(
      zFront - glassThickness,
      yTop - glassThickness,
      zFront - glassThickness,
      yBottom,
    )
    profile.lineTo(zFront, yBottom)
    const visorGeometry = new ExtrudeGeometry(profile, {
      depth: width,
      bevelEnabled: false,
      curveSegments: 24,
      steps: 1,
    })
    visorGeometry.rotateY(-Math.PI / 2)
    visorGeometry.translate(width / 2, 0, 0)
    visorGeometry.computeVertexNormals()
    const visor = stampSlot(new Mesh(visorGeometry, materials.glass), 'glass')
    visor.name = `${name}-glass-visor`
    visor.castShadow = true
    group.add(visor)
    ductBottomY = bottomY + HOOD_CURVED_BODY_HEIGHT
  }

  const ductTopY = Math.max(ductBottomY + 0.05, resolveHoodDuctTopY(node, ctx))
  const ductHeight = ductTopY - ductBottomY
  addBox(
    group,
    [HOOD_DUCT_SIZE, ductHeight, HOOD_DUCT_SIZE],
    [0, ductBottomY + ductHeight / 2, ductCenterZ],
    materials.appliance,
    `${name}-duct`,
    'appliance',
  )
}
