import {
  type BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { SteelFrameNode } from './schema'

const Y_AXIS = new Vector3(0, 1, 0)

function positions(count: number, span: number): number[] {
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, index) => -span / 2 + (span * index) / (count - 1))
}

function material(color: string, roughness = 0.46, metalness = 0.72) {
  return new MeshStandardMaterial({ color, roughness, metalness })
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

function addMember(
  group: Group,
  name: string,
  start: Vector3,
  end: Vector3,
  radius: number,
  mat: MeshStandardMaterial,
) {
  const direction = new Vector3().subVectors(end, start)
  const length = direction.length()
  if (length < 0.001) return
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 8), mat)
  mesh.name = name
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(Y_AXIS, direction.normalize()))
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function addDeck(
  group: Group,
  node: SteelFrameNode,
  y: number,
  deckMaterial: MeshStandardMaterial,
) {
  const railCount = Math.max(3, Math.ceil(node.width / 0.45))
  const railStep = node.width / (railCount - 1)
  for (let index = 0; index < railCount; index += 1) {
    const z = -node.width / 2 + index * railStep
    addBox(
      group,
      'steel-frame-deck-grating',
      [node.length, node.deckThickness, Math.max(0.035, node.memberSize * 0.24)],
      [0, y, z],
      deckMaterial,
    )
  }
}

function addFaceBrace(
  group: Group,
  style: SteelFrameNode['braceStyle'],
  lowA: Vector3,
  highB: Vector3,
  radius: number,
  mat: MeshStandardMaterial,
) {
  if (style === 'knee') {
    const span = new Vector3().subVectors(highB, lowA)
    const kneeA = new Vector3(
      lowA.x + span.x * 0.22,
      lowA.y + span.y * 0.22,
      lowA.z + span.z * 0.22,
    )
    const kneeB = new Vector3(
      highB.x - span.x * 0.22,
      highB.y - span.y * 0.22,
      highB.z - span.z * 0.22,
    )
    addMember(group, 'steel-frame-knee-brace', lowA, kneeA, radius, mat)
    addMember(group, 'steel-frame-knee-brace', highB, kneeB, radius, mat)
    return
  }
  addMember(group, 'steel-frame-diagonal-brace', lowA, highB, radius, mat)
}

function addPortalTop(group: Group, node: SteelFrameNode, steel: MeshStandardMaterial) {
  const eaveY = node.height * 0.78
  const ridgeY = node.height
  const halfLength = node.length / 2
  const halfWidth = node.width / 2
  const radius = node.memberSize * 0.42
  for (const x of [-halfLength, halfLength]) {
    addMember(
      group,
      'steel-frame-portal-rafter',
      new Vector3(x, eaveY, -halfWidth),
      new Vector3(0, ridgeY, 0),
      radius,
      steel,
    )
    addMember(
      group,
      'steel-frame-portal-rafter',
      new Vector3(0, ridgeY, 0),
      new Vector3(x, eaveY, halfWidth),
      radius,
      steel,
    )
  }
}

export function buildSteelFrameGeometry(node: SteelFrameNode): Group {
  const group = new Group()
  const steel = material(node.color)
  const deck = material(node.deckColor, 0.58, 0.56)
  const member = Math.max(0.04, node.memberSize)
  const brace = Math.max(0.02, node.braceSize / 2)
  const xPositions = positions(node.columns, node.length)
  const zPositions = positions(node.rows, node.width)
  const tiers = Array.from(
    { length: node.levels + 1 },
    (_, index) => (node.height * index) / node.levels,
  )

  for (const x of xPositions) {
    for (const z of zPositions) {
      addBox(
        group,
        'steel-frame-column',
        [member, node.height, member],
        [x, node.height / 2, z],
        steel,
      )
    }
  }

  for (const y of tiers) {
    const beamY = Math.max(member / 2, y)
    for (const z of zPositions) {
      addBox(
        group,
        'steel-frame-longitudinal-beam',
        [node.length + member, member, member],
        [0, beamY, z],
        steel,
      )
    }
    for (const x of xPositions) {
      addBox(
        group,
        'steel-frame-cross-beam',
        [member, member, node.width + member],
        [x, beamY, 0],
        steel,
      )
    }
  }

  if (node.style === 'equipment-platform' || node.style === 'tower-frame') {
    for (let i = 1; i <= node.levels; i += 1) addDeck(group, node, tiers[i] ?? node.height, deck)
  }

  if (node.style === 'pipe-rack') {
    const topY = node.height + member * 0.6
    for (const z of zPositions) {
      addBox(
        group,
        'steel-frame-pipe-support-rail',
        [node.length + member, member * 0.55, member * 0.55],
        [0, topY, z],
        steel,
      )
    }
  }

  if (node.style === 'portal-frame') {
    addPortalTop(group, node, steel)
  }

  if (node.braceStyle !== 'none') {
    for (let xi = 0; xi < xPositions.length - 1; xi += 1) {
      const x0 = xPositions[xi] ?? 0
      const x1 = xPositions[xi + 1] ?? 0
      for (let li = 0; li < tiers.length - 1; li += 1) {
        const y0 = tiers[li] ?? 0
        const y1 = tiers[li + 1] ?? node.height
        for (const z of [zPositions[0] ?? 0, zPositions.at(-1) ?? 0]) {
          addFaceBrace(
            group,
            node.braceStyle,
            new Vector3(x0, y0 + member, z),
            new Vector3(x1, y1 - member, z),
            brace,
            steel,
          )
        }
      }
    }
  }

  if (node.style === 'tower-frame' && node.braceStyle !== 'none') {
    for (let zi = 0; zi < zPositions.length - 1; zi += 1) {
      const z0 = zPositions[zi] ?? 0
      const z1 = zPositions[zi + 1] ?? 0
      for (let li = 0; li < tiers.length - 1; li += 1) {
        const y0 = tiers[li] ?? 0
        const y1 = tiers[li + 1] ?? node.height
        for (const x of [xPositions[0] ?? 0, xPositions.at(-1) ?? 0]) {
          addFaceBrace(
            group,
            node.braceStyle,
            new Vector3(x, y0 + member, z0),
            new Vector3(x, y1 - member, z1),
            brace,
            steel,
          )
        }
      }
    }
  }

  group.traverse((object) => {
    const mesh = object as Mesh<BufferGeometry, MeshStandardMaterial>
    if (mesh.geometry) mesh.geometry.computeBoundingBox()
  })
  return group
}
