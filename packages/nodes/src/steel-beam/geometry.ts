import { sampleWallCenterline } from '@pascal-app/core'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { SteelBeamNode } from './schema'

function isPoint2D(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  )
}

function hasCenterline(node: SteelBeamNode): boolean {
  const candidate = node as { start?: unknown; end?: unknown }
  return isPoint2D(candidate.start) && isPoint2D(candidate.end)
}

function material(color: string) {
  return new MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.48 })
}

function addBox(
  group: Group,
  args: {
    centerX: number
    centerZ: number
    y: number
    angle: number
    size: [number, number, number]
    material: MeshStandardMaterial
    name: string
    offsetY?: number
    offsetZ?: number
  },
) {
  const normalX = -Math.sin(args.angle)
  const normalZ = Math.cos(args.angle)
  const mesh = new Mesh(new BoxGeometry(args.size[0], args.size[1], args.size[2]), args.material)
  mesh.name = args.name
  mesh.position.set(
    args.centerX + normalX * (args.offsetZ ?? 0),
    args.y + (args.offsetY ?? 0),
    args.centerZ + normalZ * (args.offsetZ ?? 0),
  )
  mesh.rotation.y = -args.angle
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addProfileSegment(
  group: Group,
  node: SteelBeamNode,
  mat: MeshStandardMaterial,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
) {
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return
  const angle = Math.atan2(dz, dx)
  const centerX = (x1 + x2) / 2
  const centerZ = (z1 + z2) / 2
  const y = node.elevation
  const flange = Math.min(node.flangeThickness, node.height / 2)
  const web = Math.min(node.webThickness, node.width)
  const sideWeb = Math.min(node.webThickness, node.width / 2)
  const innerHeight = Math.max(0.01, node.height - flange * 2)

  if (node.profile === 'box') {
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, flange, node.width],
      offsetY: flange / 2,
      material: mat,
      name: 'box-bottom',
    })
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, flange, node.width],
      offsetY: node.height - flange / 2,
      material: mat,
      name: 'box-top',
    })
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, innerHeight, sideWeb],
      offsetY: flange + innerHeight / 2,
      offsetZ: -node.width / 2 + sideWeb / 2,
      material: mat,
      name: 'box-side-left',
    })
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, innerHeight, sideWeb],
      offsetY: flange + innerHeight / 2,
      offsetZ: node.width / 2 - sideWeb / 2,
      material: mat,
      name: 'box-side-right',
    })
    return
  }

  if (node.profile === 'concave') {
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, flange, node.width],
      offsetY: flange / 2,
      material: mat,
      name: 'concave-bottom',
    })
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, node.height - flange, sideWeb],
      offsetY: flange + (node.height - flange) / 2,
      offsetZ: -node.width / 2 + sideWeb / 2,
      material: mat,
      name: 'concave-side-left',
    })
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, node.height - flange, sideWeb],
      offsetY: flange + (node.height - flange) / 2,
      offsetZ: node.width / 2 - sideWeb / 2,
      material: mat,
      name: 'concave-side-right',
    })
    return
  }

  addBox(group, {
    centerX,
    centerZ,
    y,
    angle,
    size: [length, flange, node.width],
    offsetY: flange / 2,
    material: mat,
    name: 'bottom-flange',
  })
  addBox(group, {
    centerX,
    centerZ,
    y,
    angle,
    size: [length, flange, node.width],
    offsetY: node.height - flange / 2,
    material: mat,
    name: 'top-flange',
  })
  addBox(group, {
    centerX,
    centerZ,
    y,
    angle,
    size: [length, innerHeight, web],
    offsetY: flange + innerHeight / 2,
    material: mat,
    name: 'web',
  })

  if (node.profile === 'channel') {
    addBox(group, {
      centerX,
      centerZ,
      y,
      angle,
      size: [length, innerHeight, web],
      offsetY: flange + innerHeight / 2,
      offsetZ: node.width / 2 - web / 2,
      material: mat,
      name: 'channel-side',
    })
  }
}

export function buildSteelBeamGeometry(node: SteelBeamNode): Group {
  const group = new Group()
  const mat = material(node.color)
  const points = hasCenterline(node) ? sampleWallCenterline(node, 32) : []
  if (points.length >= 2) {
    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1]!
      const next = points[index]!
      addProfileSegment(group, node, mat, prev.x, prev.y, next.x, next.y)
    }
    return group
  }

  addProfileSegment(group, node, mat, -node.length / 2, 0, node.length / 2, 0)
  group.position.set(node.position[0], node.position[1], node.position[2])
  group.rotation.set(node.rotation[0] ?? 0, node.rotation[1] ?? 0, node.rotation[2] ?? 0)
  return group
}
