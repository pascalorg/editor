import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { LadderNode } from './schema'

const Y_AXIS = new Vector3(0, 1, 0)

function material(color: string) {
  return new MeshStandardMaterial({ color, metalness: 0.32, roughness: 0.52 })
}

function cylinderBetween(
  group: Group,
  start: Vector3,
  end: Vector3,
  radius: number,
  mat: MeshStandardMaterial,
  name: string,
) {
  const direction = new Vector3().subVectors(end, start)
  const length = direction.length()
  if (length < 0.001) return
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 16), mat)
  mesh.name = name
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize()))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

export function buildLadderGeometry(node: LadderNode): Group {
  const group = new Group()
  const mat = material(node.color)
  const halfWidth = node.width / 2
  const backZ = -node.standoffDepth

  for (const x of [-halfWidth, halfWidth]) {
    cylinderBetween(
      group,
      new Vector3(x, 0, 0),
      new Vector3(x, node.height, 0),
      node.railDiameter / 2,
      mat,
      'rail',
    )
  }

  const rungCount = Math.max(1, Math.floor(node.height / Math.max(node.rungSpacing, 0.05)))
  for (let index = 1; index <= rungCount; index += 1) {
    const y = Math.min(node.height - node.rungDiameter, index * node.rungSpacing)
    cylinderBetween(
      group,
      new Vector3(-halfWidth, y, 0),
      new Vector3(halfWidth, y, 0),
      node.rungDiameter / 2,
      mat,
      'rung',
    )
  }

  if (node.standoffDepth > 0.01) {
    for (const y of [Math.min(0.35, node.height), Math.max(0.35, node.height - 0.35)]) {
      for (const x of [-halfWidth, halfWidth]) {
        cylinderBetween(
          group,
          new Vector3(x, y, backZ),
          new Vector3(x, y, 0),
          Math.max(node.rungDiameter, node.railDiameter) / 2,
          mat,
          'standoff',
        )
      }
    }
  }

  if (node.cageEnabled) {
    const cageStart = Math.min(node.height, Math.max(0, node.cageStartHeight))
    const ringStep = 0.55
    const ringCount = Math.max(1, Math.floor((node.height - cageStart) / ringStep))
    const cageMat = material('#d1d5db')
    for (let index = 0; index <= ringCount; index += 1) {
      const y = cageStart + ((node.height - cageStart) * index) / ringCount
      cylinderBetween(
        group,
        new Vector3(-node.cageRadius, y, -node.cageRadius),
        new Vector3(node.cageRadius, y, -node.cageRadius),
        node.rungDiameter / 2,
        cageMat,
        'cage-ring',
      )
    }
    for (const x of [-node.cageRadius, node.cageRadius]) {
      cylinderBetween(
        group,
        new Vector3(x, cageStart, -node.cageRadius),
        new Vector3(x, node.height, -node.cageRadius),
        node.rungDiameter / 2,
        cageMat,
        'cage-rail',
      )
    }
  }

  return group
}

