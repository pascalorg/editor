import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { FactoryTankNode } from './schema'

function material(color: string, metalness = 0.22, roughness = 0.44) {
  return new MeshStandardMaterial({ color, metalness, roughness })
}

function addCylinder(
  group: Group,
  name: string,
  radius: number,
  depth: number,
  position: [number, number, number],
  rotation: [number, number, number],
  mat: MeshStandardMaterial,
  segments = 40,
) {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, depth, segments), mat)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.rotation.set(rotation[0], rotation[1], rotation[2])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
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

export function buildTankGeometry(node: FactoryTankNode): Group {
  const group = new Group()
  const shell = material(node.shellColor, 0.35, 0.36)
  const band = material(node.bandColor, 0.45, 0.32)
  const liquid = material(node.liquidColor, 0.05, 0.68)
  const length = Math.max(0.4, node.length)
  const width = Math.max(0.4, node.width)
  const height = Math.max(0.4, node.height)

  if (node.orientation === 'horizontal') {
    const radius = Math.min(width, height) / 2
    addCylinder(group, 'factory-tank-shell', radius, length, [0, radius, 0], [0, 0, Math.PI / 2], shell)
    addCylinder(group, 'factory-tank-left-head', radius * 0.98, 0.08, [-length / 2, radius, 0], [0, 0, Math.PI / 2], band)
    addCylinder(group, 'factory-tank-right-head', radius * 0.98, 0.08, [length / 2, radius, 0], [0, 0, Math.PI / 2], band)
    addBox(group, 'factory-tank-saddle', [length * 0.16, radius * 0.38, width * 0.68], [-length * 0.28, radius * 0.18, 0], band)
    addBox(group, 'factory-tank-saddle', [length * 0.16, radius * 0.38, width * 0.68], [length * 0.28, radius * 0.18, 0], band)
    addCylinder(group, 'factory-tank-inlet-nozzle', node.inletDiameter / 2, Math.max(0.12, length * 0.08), [-length / 2, radius, 0], [0, 0, Math.PI / 2], band)
    addCylinder(group, 'factory-tank-outlet-nozzle', node.outletDiameter / 2, Math.max(0.12, length * 0.08), [length / 2, radius * 0.62, 0], [0, 0, Math.PI / 2], band)
    return group
  }

  const radius = Math.min(length, width) / 2
  addCylinder(group, 'factory-tank-shell', radius, height, [0, height / 2, 0], [0, 0, 0], shell)
  addCylinder(group, 'factory-tank-top-band', radius * 1.02, 0.08, [0, height - 0.04, 0], [0, 0, 0], band)
  addCylinder(group, 'factory-tank-bottom-band', radius * 1.02, 0.08, [0, 0.04, 0], [0, 0, 0], band)
  addCylinder(group, 'factory-tank-liquid-level', radius * 0.94, Math.max(0.02, height * node.liquidLevel), [0, Math.max(0.01, (height * node.liquidLevel) / 2), 0], [0, 0, 0], liquid, 40)
  addCylinder(group, 'factory-tank-inlet-nozzle', node.inletDiameter / 2, Math.max(0.12, height * 0.08), [0, height, 0], [0, 0, 0], band)
  addCylinder(group, 'factory-tank-outlet-nozzle', node.outletDiameter / 2, Math.max(0.14, radius * 0.45), [0, height * 0.18, radius], [Math.PI / 2, 0, 0], band)
  addBox(group, 'factory-tank-nameplate', [radius * 0.68, height * 0.12, 0.02], [0, height * 0.58, radius + 0.015], band)
  return group
}
