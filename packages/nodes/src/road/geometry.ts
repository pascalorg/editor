import { getWallCurveFrameAt, getWallCurveLength, sampleWallCenterline } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { RoadNode } from './schema'

function createRoadMaterial(color: string) {
  return new MeshStandardMaterial({
    color,
    metalness: 0.02,
    roughness: 0.88,
  })
}

function createMarkingMaterial(color: string) {
  return new MeshStandardMaterial({
    color,
    metalness: 0,
    roughness: 0.55,
  })
}

function addRoadSegment(
  group: Group,
  args: {
    x1: number
    z1: number
    x2: number
    z2: number
    width: number
    height: number
    y: number
    material: MeshStandardMaterial
  },
) {
  const dx = args.x2 - args.x1
  const dz = args.z2 - args.z1
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return

  const mesh = new Mesh(new BoxGeometry(length, args.height, args.width), args.material)
  mesh.position.set((args.x1 + args.x2) / 2, args.y, (args.z1 + args.z2) / 2)
  mesh.rotation.y = -Math.atan2(dz, dx)
  mesh.receiveShadow = true
  group.add(mesh)
}

function addRoadBody(group: Group, node: RoadNode) {
  const points = sampleWallCenterline(node, 32)
  const material = createRoadMaterial(node.asphaltColor)

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1]!
    const next = points[index]!
    addRoadSegment(group, {
      x1: prev.x,
      z1: prev.y,
      x2: next.x,
      z2: next.y,
      width: node.width,
      height: node.thickness,
      y: node.elevation + node.thickness / 2,
      material,
    })
  }
}

function addLaneMarkings(group: Group, node: RoadNode, length: number) {
  if (!node.showLaneMarkings || node.laneCount <= 1 || length <= 0.4) return

  const laneWidth = node.width / node.laneCount
  const stripeLength = Math.min(1.2, Math.max(0.35, length * 0.18))
  const stripeGap = stripeLength
  const step = stripeLength + stripeGap
  const stripeWidth = Math.min(0.12, Math.max(0.045, laneWidth * 0.04))
  const stripeHeight = 0.006
  const material = createMarkingMaterial(node.markingColor)
  const segmentCount = Math.max(1, Math.floor(length / step))

  for (let laneIndex = 1; laneIndex < node.laneCount; laneIndex += 1) {
    const laneOffset = -node.width / 2 + laneWidth * laneIndex
    for (let index = 0; index < segmentCount; index += 1) {
      const distance = stripeLength / 2 + index * step
      const t = Math.max(0, Math.min(1, distance / length))
      const frame = getWallCurveFrameAt(node, t)
      const dx = frame.tangent.x
      const dz = frame.tangent.y
      const cx = frame.point.x + frame.normal.x * laneOffset
      const cz = frame.point.y + frame.normal.y * laneOffset
      const geometry = new BoxGeometry(stripeLength, stripeHeight, stripeWidth)
      const stripe = new Mesh(geometry, material)
      stripe.position.set(cx, node.elevation + node.thickness + stripeHeight / 2, cz)
      stripe.rotation.y = -Math.atan2(dz, dx)
      stripe.receiveShadow = true
      group.add(stripe)
    }
  }
}

export function buildRoadGeometry(node: RoadNode): Group {
  const group = new Group()
  const length = getWallCurveLength(node)
  if (length < 0.01) return group

  addRoadBody(group, node)
  addLaneMarkings(group, node, length)

  return group
}
