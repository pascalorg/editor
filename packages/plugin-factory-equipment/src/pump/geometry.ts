import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three'
import type { FactoryPumpNode } from './schema'

function material(color: string, metalness = 0.28, roughness = 0.42) {
  return new MeshStandardMaterial({ color, metalness, roughness })
}

function addBox(
  group: Group,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  mat: MeshStandardMaterial,
) {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), mat)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addCylinder(
  group: Group,
  name: string,
  radius: number,
  depth: number,
  position: [number, number, number],
  rotation: [number, number, number],
  mat: MeshStandardMaterial,
  segments = 32,
) {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, depth, segments), mat)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addFlange(
  group: Group,
  name: string,
  radius: number,
  tube: number,
  position: [number, number, number],
  mat: MeshStandardMaterial,
) {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 12, 36), mat)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.rotation.set(0, Math.PI / 2, 0)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

export function buildPumpGeometry(node: FactoryPumpNode): Group {
  const group = new Group()
  const casing = material(node.casingColor, 0.42, 0.34)
  const motor = material(node.motorColor, 0.24, 0.38)
  const skid = material(node.skidColor, 0.55, 0.36)
  const detail = material('#111827', 0.5, 0.28)

  const length = Math.max(0.4, node.length)
  const width = Math.max(0.3, node.width)
  const height = Math.max(0.3, node.height)
  const baseHeight = node.skidMounted
    ? Math.min(0.18, height * 0.14)
    : Math.min(0.08, height * 0.08)
  const shaftY = baseHeight + height * 0.42
  const casingRadius = Math.min(width * 0.34, height * 0.28)
  const casingX = -length * 0.18
  const motorLength = Math.max(0.34, length * 0.3)
  const motorRadius = Math.min(width * 0.23, height * 0.22)
  const motorX = length * 0.2
  const pipeRadius = Math.max(0.035, Math.min(node.inletDiameter, node.outletDiameter) / 2)

  if (node.skidMounted) {
    addBox(
      group,
      'factory-pump-skid-base',
      [length, baseHeight, width],
      [0, baseHeight / 2, 0],
      skid,
    )
    const railZ = width * 0.36
    addBox(
      group,
      'factory-pump-skid-rail',
      [length * 0.92, baseHeight * 0.45, Math.max(0.035, width * 0.08)],
      [0, baseHeight * 1.25, -railZ],
      skid,
    )
    addBox(
      group,
      'factory-pump-skid-rail',
      [length * 0.92, baseHeight * 0.45, Math.max(0.035, width * 0.08)],
      [0, baseHeight * 1.25, railZ],
      skid,
    )
  }

  addCylinder(
    group,
    'factory-pump-casing',
    casingRadius,
    Math.max(0.16, width * 0.42),
    [casingX, shaftY, 0],
    [Math.PI / 2, 0, 0],
    casing,
    node.pumpType === 'positive_displacement' ? 24 : 40,
  )
  addCylinder(
    group,
    'factory-pump-motor',
    motorRadius,
    motorLength,
    [motorX, shaftY, 0],
    [0, 0, Math.PI / 2],
    motor,
    32,
  )
  addBox(
    group,
    'factory-pump-coupling-guard',
    [length * 0.14, height * 0.16, width * 0.18],
    [(casingX + motorX) / 2, shaftY, 0],
    detail,
  )
  addBox(
    group,
    'factory-pump-motor-feet',
    [motorLength * 0.82, Math.max(0.04, height * 0.06), width * 0.36],
    [motorX, baseHeight + height * 0.12, 0],
    motor,
  )

  const inletX = -length / 2
  const outletX = length / 2
  addCylinder(
    group,
    'factory-pump-inlet-nozzle',
    Math.max(pipeRadius, node.inletDiameter / 2),
    Math.max(0.16, length * 0.22),
    [(inletX + casingX) / 2, shaftY, 0],
    [0, 0, Math.PI / 2],
    casing,
  )
  addCylinder(
    group,
    'factory-pump-outlet-nozzle',
    Math.max(pipeRadius, node.outletDiameter / 2),
    Math.max(0.16, length * 0.22),
    [(outletX + casingX) / 2, shaftY + casingRadius * 0.42, 0],
    [0, 0, Math.PI / 2],
    casing,
  )
  addFlange(
    group,
    'factory-pump-inlet-flange',
    node.inletDiameter * 0.7,
    0.018,
    [inletX, shaftY, 0],
    detail,
  )
  addFlange(
    group,
    'factory-pump-outlet-flange',
    node.outletDiameter * 0.78,
    0.018,
    [outletX, shaftY + casingRadius * 0.42, 0],
    detail,
  )

  if (node.pumpType === 'metering') {
    addBox(
      group,
      'factory-pump-metering-head',
      [length * 0.16, height * 0.2, width * 0.24],
      [casingX - casingRadius * 0.6, shaftY + casingRadius * 0.9, 0],
      casing,
    )
  }

  group.traverse((object) => {
    const mesh = object as Mesh
    if (mesh.geometry) mesh.geometry.computeBoundingBox()
  })
  return group
}
