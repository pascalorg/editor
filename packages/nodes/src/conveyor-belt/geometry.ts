import {
  type GeometryContext,
  getConveyorPortPoint,
  getTransferConnections,
  type TransferPort,
} from '@pascal-app/core'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { ConveyorBeltNode } from './schema'

type Point3 = [number, number, number]

function makeMaterial(color: string, metalness = 0.08) {
  return new MeshStandardMaterial({ color, metalness, roughness: 0.62 })
}

function normalizeLegacyColor(color: string, legacyColors: readonly string[], replacement: string) {
  return legacyColors.includes(color.toLowerCase()) ? replacement : color
}

function segmentLength(a: Point3, b: Point3) {
  return Math.hypot(b[0] - a[0], b[2] - a[2])
}

function segmentAngle(a: Point3, b: Point3) {
  return Math.atan2(b[2] - a[2], b[0] - a[0])
}

function addSegmentBox(
  group: Group,
  args: {
    name?: string
    a: Point3
    b: Point3
    y: number
    width: number
    height: number
    offset: number
    material: MeshStandardMaterial
    lengthPad?: number
  },
) {
  const length = segmentLength(args.a, args.b) + (args.lengthPad ?? 0)
  if (length < 0.01) return
  const angle = segmentAngle(args.a, args.b)
  const normalX = -Math.sin(angle)
  const normalZ = Math.cos(angle)
  const mesh = new Mesh(new BoxGeometry(length, args.height, args.width), args.material)
  if (args.name) mesh.name = args.name
  mesh.position.set(
    (args.a[0] + args.b[0]) / 2 + normalX * args.offset,
    args.y + (args.a[1] + args.b[1]) / 2,
    (args.a[2] + args.b[2]) / 2 + normalZ * args.offset,
  )
  mesh.rotation.y = -angle
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addCrossCylinder(
  group: Group,
  args: {
    name?: string
    point: Point3
    angle: number
    y: number
    radius: number
    width: number
    material: MeshStandardMaterial
  },
) {
  const normal = new Vector3(-Math.sin(args.angle), 0, Math.cos(args.angle)).normalize()
  const mesh = new Mesh(
    new CylinderGeometry(args.radius, args.radius, args.width, 20),
    args.material,
  )
  if (args.name) mesh.name = args.name
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), normal)
  mesh.position.set(args.point[0], args.y + args.point[1], args.point[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function samplePolyline(points: Point3[], distance: number) {
  let remaining = distance
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const length = segmentLength(a, b)
    if (length < 0.001) continue
    if (remaining <= length || index === points.length - 1) {
      const t = Math.max(0, Math.min(1, remaining / length))
      return {
        point: [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ] as Point3,
        angle: segmentAngle(a, b),
      }
    }
    remaining -= length
  }
  const last = points[points.length - 1] ?? [0, 0, 0]
  const prev = points[points.length - 2] ?? last
  return { point: last, angle: segmentAngle(prev, last) }
}

function polylineLength(points: Point3[]) {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    length += segmentLength(points[index - 1]!, points[index]!)
  }
  return length
}

function connectedPorts(node: ConveyorBeltNode) {
  const ports = new Set<TransferPort>()
  for (const connection of getTransferConnections(node)) {
    if (connection.fromNodeId === node.id) ports.add(connection.fromPort)
    if (connection.toNodeId === node.id) ports.add(connection.toPort)
  }
  return ports
}

function addConnectionMarker(group: Group, node: ConveyorBeltNode, port: TransferPort) {
  const point = getConveyorPortPoint(node, port)
  if (!point) return
  const markerMaterial = makeMaterial('#22c55e', 0.05)
  markerMaterial.emissive.set('#14532d')
  markerMaterial.emissiveIntensity = 0.25
  const ringMaterial = makeMaterial('#bbf7d0', 0.02)
  ringMaterial.emissive.set('#22c55e')
  ringMaterial.emissiveIntensity = 0.18

  const y = node.elevation + node.thickness + 0.18 + point[1]
  const marker = new Mesh(new SphereGeometry(0.075, 18, 12), markerMaterial)
  marker.position.set(point[0], y, point[2])
  marker.castShadow = true
  marker.receiveShadow = true
  group.add(marker)

  const ring = new Mesh(new TorusGeometry(0.13, 0.012, 8, 28), ringMaterial)
  ring.position.set(point[0], y, point[2])
  ring.rotation.x = Math.PI / 2
  ring.castShadow = true
  ring.receiveShadow = true
  group.add(ring)
}

export function buildConveyorBeltGeometry(node: ConveyorBeltNode, _ctx?: GeometryContext): Group {
  const group = new Group()
  const points = node.points.filter(
    (point): point is Point3 => Array.isArray(point) && point.length === 3,
  )
  if (points.length < 2) return group

  const beltColor = normalizeLegacyColor(node.color, ['#1f2937', '#f8fafc'], '#111827')
  const edgeColor = normalizeLegacyColor(node.edgeColor, ['#64748b', '#f8fafc'], '#94a3b8')
  const rollerColor = normalizeLegacyColor(node.rollerColor, ['#94a3b8', '#f8fafc'], '#cbd5e1')
  const beltMaterial = makeMaterial(beltColor, 0.04)
  const edgeMaterial = makeMaterial(edgeColor, 0.18)
  const rollerMaterial = makeMaterial(rollerColor, 0.22)
  const supportMaterial = makeMaterial(edgeColor, 0.24)
  const shadowMaterial = makeMaterial('#e5e7eb', 0.02)
  const beltY = node.elevation + node.thickness / 2
  const edgeY = node.elevation + node.thickness + 0.055
  const undersideY = Math.max(0.04, node.elevation - node.thickness * 0.55)
  const edgeWidth = Math.max(0.035, node.thickness * 0.55)
  const edgeOffset = Math.max(0, node.width / 2 - edgeWidth / 2)
  const frameHeight = Math.max(0.045, node.thickness * 0.8)
  const legHeight = Math.max(0.08, node.elevation)
  const legWidth = Math.max(0.035, node.thickness * 0.55)

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!
    const b = points[index]!
    const length = segmentLength(a, b)
    const angle = segmentAngle(a, b)
    const normalX = -Math.sin(angle)
    const normalZ = Math.cos(angle)
    addSegmentBox(group, {
      name: 'conveyor-belt-surface',
      a,
      b,
      y: beltY,
      width: node.width,
      height: node.thickness,
      offset: 0,
      material: beltMaterial,
      lengthPad: 0.02,
    })
    addSegmentBox(group, {
      name: 'conveyor-belt-underside-shadow',
      a,
      b,
      y: undersideY,
      width: node.width * 0.88,
      height: Math.max(0.025, node.thickness * 0.35),
      offset: 0,
      material: shadowMaterial,
      lengthPad: -Math.min(0.08, length * 0.2),
    })
    if (node.showFrame) {
      for (const side of [-1, 1] as const) {
        addSegmentBox(group, {
          name: 'conveyor-belt-side-rail',
          a,
          b,
          y: edgeY,
          width: edgeWidth,
          height: frameHeight,
          offset: side * edgeOffset,
          material: edgeMaterial,
          lengthPad: 0.04,
        })
        addSegmentBox(group, {
          name: 'conveyor-belt-lower-frame',
          a,
          b,
          y: Math.max(0.04, node.elevation - frameHeight * 0.8),
          width: edgeWidth * 0.85,
          height: edgeWidth * 0.85,
          offset: side * edgeOffset,
          material: supportMaterial,
          lengthPad: -Math.min(0.08, length * 0.2),
        })
      }

      const supportCount = Math.max(2, Math.ceil(length / 2.4) + 1)
      for (let supportIndex = 0; supportIndex < supportCount; supportIndex += 1) {
        const t = supportCount === 1 ? 0.5 : supportIndex / (supportCount - 1)
        const x = a[0] + (b[0] - a[0]) * t
        const z = a[2] + (b[2] - a[2]) * t
        for (const side of [-1, 1] as const) {
          const leg = new Mesh(new BoxGeometry(legWidth, legHeight, legWidth), supportMaterial)
          leg.name = 'conveyor-belt-support-leg'
          leg.position.set(
            x + normalX * side * edgeOffset,
            legHeight / 2,
            z + normalZ * side * edgeOffset,
          )
          leg.rotation.y = -angle
          leg.castShadow = true
          leg.receiveShadow = true
          group.add(leg)
        }
        addSegmentBox(group, {
          name: 'conveyor-belt-cross-brace',
          a: [x + normalX * -edgeOffset, 0, z + normalZ * -edgeOffset],
          b: [x + normalX * edgeOffset, 0, z + normalZ * edgeOffset],
          y: Math.max(0.08, legHeight * 0.42),
          width: legWidth,
          height: legWidth,
          offset: 0,
          material: supportMaterial,
        })
      }
    }

    addCrossCylinder(group, {
      name: 'conveyor-belt-end-drum',
      point: a,
      angle,
      y: node.elevation + node.thickness / 2,
      radius: Math.max(0.045, Math.min(node.thickness * 0.85, 0.12)),
      width: node.width * 1.04,
      material: rollerMaterial,
    })
    if (index === points.length - 1) {
      addCrossCylinder(group, {
        name: 'conveyor-belt-end-drum',
        point: b,
        angle,
        y: node.elevation + node.thickness / 2,
        radius: Math.max(0.045, Math.min(node.thickness * 0.85, 0.12)),
        width: node.width * 1.04,
        material: rollerMaterial,
      })
    }
  }

  if (node.showRollers && node.rollerSpacing > 0.05) {
    const length = polylineLength(points)
    const count = Math.max(1, Math.floor(length / node.rollerSpacing))
    const radius = Math.max(0.04, Math.min(node.thickness * 0.75, 0.1))
    for (let index = 0; index <= count; index += 1) {
      const sample = samplePolyline(points, (length * index) / count)
      const roller = new Mesh(
        new CylinderGeometry(radius, radius, node.width * 1.08, 16),
        rollerMaterial,
      )
      roller.name = 'conveyor-belt-under-roller'
      roller.position.set(
        sample.point[0],
        node.elevation - radius * 0.15 + sample.point[1],
        sample.point[2],
      )
      roller.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3(-Math.sin(sample.angle), 0, Math.cos(sample.angle)).normalize(),
      )
      roller.castShadow = true
      roller.receiveShadow = true
      group.add(roller)
    }
  }

  for (const port of connectedPorts(node)) {
    addConnectionMarker(group, node, port)
  }

  return group
}
