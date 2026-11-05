import { describe, expect, test } from 'bun:test'
import { DoorNode, useScene, WallNode } from '@pascal-app/core'
import { DOOR_STYLES, doorStyleLook } from '@pascal-app/core/building'
import * as THREE from 'three'
import { buildDoorPreviewMesh } from './door-system'

/**
 * A front door, style "modern" ("flat slab"), rendered its frame and no leaf, so
 * the porch read as an open passage. A door style is a leaf look: whatever the style, the closed
 * leaf covers its opening.
 */
/** The boxes of a door's leaf meshes (its panels and glass), as the preview builds them. */
function leafBoxes(style: (typeof DOOR_STYLES)[number], slots = ['panel', 'glass']) {
  const wall = WallNode.parse({
    id: 'wall_style_test',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.25,
  })
  const door = DoorNode.parse({
    id: 'door_style_test',
    parentId: wall.id,
    wallId: wall.id,
    position: [2, 1.15, 0],
    width: 1,
    height: 2.3,
    ...doorStyleLook(style),
  })
  const previous = useScene.getState().nodes
  useScene.setState({ nodes: { ...previous, [wall.id]: wall } })
  const mesh = buildDoorPreviewMesh(door)
  useScene.setState({ nodes: previous })
  mesh.updateMatrixWorld(true)
  const leaves: THREE.Box3[] = []
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || child === mesh || !child.visible) return
    if (!slots.includes(child.userData.slotId)) return
    leaves.push(new THREE.Box3().setFromObject(child))
  })
  return { door, leaves }
}

function leafCoverage(style: (typeof DOOR_STYLES)[number]) {
  const { door, leaves } = leafBoxes(style)
  const [cx, cy] = [door.position[0], door.position[1]]
  const misses: string[] = []
  for (let i = 1; i < 10; i++)
    for (let j = 1; j < 10; j++) {
      const point = new THREE.Vector3(cx - 0.5 + (i / 10) * 1, cy - 1.15 + (j / 10) * 2.3, 0)
      const covered = leaves.some(
        (box) =>
          point.x >= box.min.x &&
          point.x <= box.max.x &&
          point.y >= box.min.y &&
          point.y <= box.max.y,
      )
      if (!covered) misses.push(`(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`)
    }
  return misses
}

describe('door styles', () => {
  for (const style of DOOR_STYLES)
    test(`a ${style} door's leaf covers its opening`, () => {
      expect(leafCoverage(style)).toEqual([])
    })

  for (const style of DOOR_STYLES)
    test(`${style}: panel segments stay inside both leaf faces with recessed fields`, () => {
      const look = doorStyleLook(style)
      // Preserve every cell's dimensions while excluding the proud beads of glazed segments.
      const node = DoorNode.parse({
        ...look,
        segments: look.segments.map((segment) =>
          segment.type === 'glass' ? { ...segment, type: 'empty' } : segment,
        ),
      })
      const mesh = buildDoorPreviewMesh(node)
      mesh.updateMatrixWorld(true)
      const leafDepth = 0.04
      let fields = 0
      mesh.traverse((part) => {
        if (!(part instanceof THREE.Mesh) || part.userData.slotId !== 'panel') return
        const leaf = part.parent!
        const positions = part.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          const point = leaf.worldToLocal(
            part.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)),
          )
          // Swing leaves pivot at one face; measure z from the leaf's mid-plane.
          point.z += leaf.position.z
          expect(Math.abs(point.z)).toBeLessThanOrEqual(leafDepth / 2 + 1e-6)
        }
        if (part.geometry.type !== 'BufferGeometry') return
        fields++
        const normals = part.geometry.getAttribute('normal')
        for (const face of [-1, 1]) {
          const fieldVertices = Array.from({ length: positions.count }, (_, i) => i).filter(
            (i) => face * normals.getZ(i) > 0.999,
          )
          expect(fieldVertices.length).toBeGreaterThan(0)
          for (const i of fieldVertices)
            expect(face * positions.getZ(i)).toBeLessThan(leafDepth / 2 - 1e-6)
        }
      })
      const expectedFields = node.segments.reduce(
        (sum, segment) =>
          sum +
          (segment.type === 'panel' && segment.panelDepth !== 0 ? segment.columnRatios.length : 0),
        0,
      )
      expect(fields).toBe(expectedFields)
    })
})

/**
 * The raised inner panels of a panelled leaf are on both of its faces: seen from the street or
 * from the hall, a six-panel door shows its six panels (the user, 2026-10-06, on :3102).
 */
function panelFaces(style: (typeof DOOR_STYLES)[number]) {
  const mesh = buildDoorPreviewMesh(DoorNode.parse(doorStyleLook(style)))
  let front = false
  let back = false
  mesh.traverse((part) => {
    if (
      !(part instanceof THREE.Mesh) ||
      part.userData.slotId !== 'panel' ||
      part.geometry.type !== 'BufferGeometry'
    )
      return
    const positions = part.geometry.getAttribute('position')
    const normals = part.geometry.getAttribute('normal')
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(Math.abs(positions.getZ(i)) - 0.02) < 1e-6) continue
      if (normals.getZ(i) > 0.999) front = true
      if (normals.getZ(i) < -0.999) back = true
    }
  })
  return { front, back }
}

describe('panelled door styles', () => {
  for (const style of ['six-panel', 'shaker', 'half-louvered'] as const)
    test(`a ${style} door shows its panels on both faces`, () => {
      expect(panelFaces(style)).toEqual({ front: true, back: true })
    })
})

test('barn braces cross diagonally in the leaf plane', () => {
  const mesh = buildDoorPreviewMesh(DoorNode.parse({ doorType: 'barn' }))
  const leaf = mesh.getObjectByName('door-barn-leaf')!
  const braces = leaf.children.filter(
    (part): part is THREE.Mesh =>
      part instanceof THREE.Mesh && part.geometry.type === 'BoxGeometry' && !part.userData.slotId,
  )
  expect(braces).toHaveLength(2)
  const directions = braces.map((brace) => {
    const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(brace.quaternion)
    expect(Math.abs(direction.x)).toBeGreaterThan(0.4)
    expect(direction.y).toBeGreaterThan(0.8)
    expect(direction.z).toBeCloseTo(0)
    const bounds = new THREE.Box3().setFromObject(brace)
    expect(bounds.getSize(new THREE.Vector3()).z).toBeCloseTo(0.012)
    return direction
  })
  expect(directions[0]!.x * directions[1]!.x).toBeLessThan(0)
  expect(braces[0]!.position.equals(braces[1]!.position)).toBe(true)
})

function panelBounds(node: DoorNode) {
  const mesh = buildDoorPreviewMesh(node)
  mesh.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  mesh.traverse((part) => {
    if (part instanceof THREE.Mesh && part.userData.slotId === 'panel')
      bounds.union(new THREE.Box3().setFromObject(part))
  })
  return bounds
}

test('the leaf has 3 mm clearance at every edge while the frame and cutout retain their size', () => {
  const node = DoorNode.parse({ ...doorStyleLook('modern'), threshold: false })
  const bounds = panelBounds(node)
  expect(bounds.min.x).toBeCloseTo(-node.width / 2 + node.frameThickness + 0.003)
  expect(bounds.max.x).toBeCloseTo(node.width / 2 - node.frameThickness - 0.003)
  expect(bounds.min.y).toBeCloseTo(-node.height / 2 + 0.003)
  expect(bounds.max.y).toBeCloseTo(node.height / 2 - node.frameThickness - 0.003)
  const mesh = buildDoorPreviewMesh(node)
  expect((mesh.geometry as THREE.BoxGeometry).parameters.width).toBe(node.width)
  expect((mesh.geometry as THREE.BoxGeometry).parameters.height).toBe(node.height)
})

test('the exact saved default Panel leaf heals without mutating the node; a custom margin stays stored', () => {
  const legacy = DoorNode.parse({ ...doorStyleLook('panel'), contentPadding: [0.04, 0.04] })
  const saved = structuredClone(legacy)
  const panels = (node: DoorNode) => {
    const positions: number[][] = []
    buildDoorPreviewMesh(node).traverse((part) => {
      if (part instanceof THREE.Mesh && part.userData.slotId === 'panel')
        positions.push([...part.geometry.getAttribute('position').array])
    })
    return positions
  }
  expect(panels(legacy)).toEqual(panels(DoorNode.parse(doorStyleLook('panel'))))
  expect(legacy).toEqual(saved)
  expect(panels({ ...legacy, contentPadding: [0.04000001, 0.04] })).not.toEqual(panels(legacy))
})

for (const [panelDepth, fieldDepth, centreDepth] of [
  [0.001, 0.006, 0.002],
  [0.01, 0.01, 0.002],
  [0.035, 0.012, 0.002],
  [-0.005, 0.005, 0.005],
  [-0.01, 0.01, 0.01],
  [-0.02, 0.012, 0.012],
] as const) {
  test(`${panelDepth}: sticking, field and centre are carved into both leaf faces`, () => {
    const node = DoorNode.parse({ segments: [{ type: 'panel', heightRatio: 1, panelDepth }] })
    const mesh = buildDoorPreviewMesh(node)
    mesh.updateMatrixWorld(true)
    const fields: THREE.Mesh[] = []
    const panels: THREE.Mesh[] = []
    mesh.traverse((part) => {
      if (part instanceof THREE.Mesh && part.userData.slotId === 'panel') panels.push(part)
      if (
        part instanceof THREE.Mesh &&
        part.userData.slotId === 'panel' &&
        part.geometry.type === 'BufferGeometry'
      )
        fields.push(part)
    })
    expect(fields).toHaveLength(1)
    const geometry = fields[0]!.geometry
    geometry.computeBoundingBox()
    const left = geometry.boundingBox!.min.x
    for (const face of [-1, 1]) {
      for (const [x, depth] of [
        [left + 0.005, fieldDepth * 0.175],
        [left + 0.015, fieldDepth * 0.675],
        [left + 0.02, fieldDepth],
        [0, centreDepth],
      ]) {
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, -0.025, face),
          new THREE.Vector3(0, 0, -face),
        )
        // Include the stile/rail meshes so a backing slab cannot hide a correctly shaped field.
        const hit = ray.intersectObjects(panels)[0]!
        expect(hit.point.z).toBeCloseTo(face * (0.02 - depth!), 6)
      }
    }
    const normals = geometry.getAttribute('normal')
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i += 3) {
      const edge = new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .distanceTo(new THREE.Vector3().fromBufferAttribute(position, i + 1))
      const uvEdge = Math.hypot(uv.getX(i) - uv.getX(i + 1), uv.getY(i) - uv.getY(i + 1))
      expect(uvEdge).toBeCloseTo(edge, 6)
    }
    for (let i = 0; i < position.count; i++) {
      expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(0.02 + 1e-6)
      if (Math.abs(normals.getZ(i)) > 0)
        expect(2 * Math.abs(position.getZ(i))).toBeGreaterThanOrEqual(0.002 - 1e-6)
    }
    for (const attribute of Object.values(geometry.attributes))
      expect([...attribute.array].every(Number.isFinite)).toBe(true)
  })
}

for (const swingDirection of ['inward', 'outward'] as const) {
  test(`${swingDirection}: rectangular swing doors have only head and leg stops on the closing side`, () => {
    const mesh = buildDoorPreviewMesh(DoorNode.parse({ swingDirection, swingAngle: 0.7 }))
    const stops = mesh.children.filter(
      (part) => part.name === 'door-jamb-stop',
    ) as THREE.Mesh<THREE.BoxGeometry>[]
    expect(stops).toHaveLength(3)
    for (const stop of stops) {
      expect(stop.userData.slotId).toBe('frame')
      expect(stop.geometry.parameters.depth).toBe(0.032)
      expect(stop.position.z).toBeCloseTo(swingDirection === 'inward' ? -0.036 : 0.036)
      expect(Math.min(stop.geometry.parameters.width, stop.geometry.parameters.height)).toBe(0.012)
    }
  })
}
for (const patch of [
  { openingShape: 'arch' },
  { openingShape: 'rounded' },
  ...[
    'folding',
    'pocket',
    'sliding',
    'barn',
    'garage-sectional',
    'garage-tiltup',
    'garage-rollup',
  ].map((doorType) => ({ doorType })),
]) {
  test(`no jamb stop on ${JSON.stringify(patch)}`, () => {
    expect(
      buildDoorPreviewMesh(DoorNode.parse(patch)).children.some(
        (part) => part.name === 'door-jamb-stop',
      ),
    ).toBe(false)
  })
}

test('glass keeps a 12 mm bead standing 6 mm proud on each face', () => {
  const node = DoorNode.parse(doorStyleLook('glass'))
  const bounds = panelBounds(node)
  expect(bounds.min.z).toBeCloseTo(-0.026)
  expect(bounds.max.z).toBeCloseTo(0.026)
  const mesh = buildDoorPreviewMesh(node)
  mesh.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(
    new THREE.Vector3(-0.4 + 0.003 + 0.07 + 0.006, -0.025, 1),
    new THREE.Vector3(0, 0, -1),
  )
  const panels: THREE.Mesh[] = []
  mesh.traverse((part) => {
    if (part instanceof THREE.Mesh && part.userData.slotId === 'panel') panels.push(part)
  })
  expect(ray.intersectObjects(panels)[0]!.point.z).toBeCloseTo(0.026)
})

test('paneled-glass sidelight has a 0.3 m bottom panel and glass above its mid rail', () => {
  const node = DoorNode.parse({
    width: 1,
    height: 2.1,
    sidelightLeft: 0.4,
    ...doorStyleLook('paneled-glass'),
  })
  const mesh = buildDoorPreviewMesh(node)
  const fixed = mesh.getObjectByName('door-fixed-lights')!
  const panels: THREE.Box3[] = []
  let glass = 0
  fixed.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return
    if (part.userData.slotId === 'glass') glass++
    if (part.userData.slotId === 'panel') {
      part.geometry.computeBoundingBox()
      panels.push(part.geometry.boundingBox!.clone().translate(part.position))
    }
  })
  expect(panels).toHaveLength(1)
  expect(panels[0]!.max.y - panels[0]!.min.y).toBeCloseTo(0.3)
  expect(panels[0]!.min.y).toBeCloseTo(-1.05)
  expect(glass).toBe(2)
})
