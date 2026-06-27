import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import type { PipeFittingNode } from './schema'

function createPipeMaterial(color: string, opacity = 1) {
  return new MeshStandardMaterial({
    color,
    metalness: 0.45,
    roughness: 0.42,
    transparent: opacity < 1,
    opacity,
  })
}

function createInsulationMaterial(color: string) {
  return new MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.85,
    transparent: true,
    opacity: 0.72,
  })
}

function addTube(
  group: Group,
  points: Vector3[],
  radius: number,
  material: MeshStandardMaterial,
  tubularSegments = 24,
) {
  const curve = new CatmullRomCurve3(points)
  const mesh = new Mesh(new TubeGeometry(curve, tubularSegments, radius, 16, false), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addCenterHub(group: Group, radius: number, material: MeshStandardMaterial) {
  const hub = new Mesh(new SphereGeometry(radius, 24, 12), material)
  hub.castShadow = true
  hub.receiveShadow = true
  group.add(hub)
}

function addCylinderX(
  group: Group,
  length: number,
  radius: number,
  material: MeshStandardMaterial,
  name?: string,
  radialSegments = 32,
) {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, radialSegments), material)
  mesh.rotation.z = Math.PI / 2
  mesh.name = name ?? ''
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function addBox(
  group: Group,
  size: [number, number, number],
  position: [number, number, number],
  material: MeshStandardMaterial,
  name?: string,
) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.name = name ?? ''
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

function buildElbow(group: Group, node: PipeFittingNode, radius: number, material: MeshStandardMaterial) {
  const legLength = Math.max(node.diameter * 3, node.diameter * node.bendRadiusMultiplier)
  const angle = (Math.min(180, Math.max(15, node.angleDegrees)) * Math.PI) / 180
  const first = new Vector3(-legLength, 0, 0)
  const center = new Vector3(0, 0, 0)
  const second = new Vector3(Math.cos(angle) * legLength, 0, Math.sin(angle) * legLength)

  addTube(group, [first, center], radius, material, 12)
  addTube(group, [center, second], radius, material, 12)
  addCenterHub(group, radius * 1.15, material)
}

function buildBranchFitting(
  group: Group,
  node: PipeFittingNode,
  radius: number,
  material: MeshStandardMaterial,
) {
  const len = Math.max(node.branchLength, node.diameter * 3)
  addTube(group, [new Vector3(-len, 0, 0), new Vector3(len, 0, 0)], radius, material, 24)
  addTube(group, [new Vector3(0, 0, 0), new Vector3(0, 0, len)], radius, material, 16)
  if (node.fittingKind === 'cross') {
    addTube(group, [new Vector3(0, 0, 0), new Vector3(0, 0, -len)], radius, material, 16)
  }
  addCenterHub(group, radius * 1.15, material)
}

function resolvedFlangeOuterRadius(node: PipeFittingNode) {
  return Math.max(node.flangeOuterDiameter ?? node.diameter * 1.9, node.diameter * 1.25) / 2
}

function buildFlange(
  group: Group,
  node: PipeFittingNode,
  radius: number,
  material: MeshStandardMaterial,
) {
  const thickness = Math.max(node.flangeThickness, node.diameter * 0.18)
  const outerRadius = resolvedFlangeOuterRadius(node)
  addCylinderX(group, Math.max(node.length, thickness), radius, material, 'flange pipe stub', 24)
  addCylinderX(group, thickness, outerRadius, material, 'flange plate', 40)

  const boltRadius = Math.max(node.boltDiameter / 2, node.diameter * 0.035)
  const boltCircleRadius = Math.max((outerRadius + radius) / 2, radius + boltRadius * 2)
  for (let index = 0; index < node.boltCount; index += 1) {
    const angle = (index / node.boltCount) * Math.PI * 2
    const bolt = addCylinderX(
      group,
      thickness * 1.18,
      boltRadius,
      material,
      `flange bolt ${index + 1}`,
      10,
    )
    bolt.position.set(0, Math.sin(angle) * boltCircleRadius, Math.cos(angle) * boltCircleRadius)
  }
}

function buildValve(
  group: Group,
  node: PipeFittingNode,
  radius: number,
  material: MeshStandardMaterial,
) {
  const length = Math.max(node.length, node.diameter * 2.8)
  const bodyLength = length * 0.42
  addCylinderX(group, length, radius, material, 'valve pipe stub', 24)
  addBox(
    group,
    [bodyLength, node.diameter * 1.45, node.diameter * 1.45],
    [0, 0, 0],
    material,
    'valve body',
  )

  const flangeThickness = Math.max(node.flangeThickness, node.diameter * 0.16)
  const flangeRadius = resolvedFlangeOuterRadius(node)
  for (const x of [-(length / 2 - flangeThickness / 2), length / 2 - flangeThickness / 2]) {
    const flange = addCylinderX(group, flangeThickness, flangeRadius, material, 'valve flange', 32)
    flange.position.x = x
  }

  if (node.valveStyle !== 'placeholder') {
    addBox(
      group,
      [node.diameter * 0.22, node.diameter * 0.85, node.diameter * 0.22],
      [0, node.diameter * 0.95, 0],
      material,
      'valve stem',
    )
    const wheel = new Mesh(
      new TorusGeometry(node.diameter * 0.48, node.diameter * 0.04, 8, 28),
      material,
    )
    wheel.name = 'valve handwheel'
    wheel.position.set(0, node.diameter * 1.42, 0)
    wheel.rotation.x = Math.PI / 2
    wheel.castShadow = true
    wheel.receiveShadow = true
    group.add(wheel)
  }
}

function addFittingLayer(group: Group, node: PipeFittingNode, radius: number, material: MeshStandardMaterial) {
  if (node.fittingKind === 'elbow') buildElbow(group, node, radius, material)
  else if (node.fittingKind === 'tee' || node.fittingKind === 'cross') {
    buildBranchFitting(group, node, radius, material)
  } else if (node.fittingKind === 'flange') {
    buildFlange(group, node, radius, material)
  } else {
    buildValve(group, node, radius, material)
  }
}

export function buildPipeFittingGeometry(node: PipeFittingNode): Group {
  const group = new Group()
  const innerRadius = node.diameter / 2

  if (node.insulated && node.insulationThickness > 0) {
    addFittingLayer(
      group,
      node,
      innerRadius + node.insulationThickness,
      createInsulationMaterial(node.color),
    )
  }

  addFittingLayer(group, node, innerRadius, createPipeMaterial(node.color, node.opacity))
  return group
}
