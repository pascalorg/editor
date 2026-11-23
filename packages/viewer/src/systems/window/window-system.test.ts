import { describe, expect, test } from 'bun:test'
import { useScene, WallNode, WindowNode, WindowType } from '@pascal-app/core'
import * as THREE from 'three'
import { poseWindowMovingParts } from './window-animation-system'
import { buildWindowPreviewMesh } from './window-system'

/**
 * The wall's reveal and a face finish's cut both close the opening in its edge planes, facing into
 * it. A window face in one of those planes, facing the same way, flickers with them (z-fighting):
 * the sill's top level with the opening's bottom did.
 */
describe("a window's faces at the edges of its opening", () => {
  const shapes = ['rectangle', 'rounded', 'arch'] as const
  const cases = WindowType.options.flatMap((windowType) =>
    shapes.map((openingShape) => ({ windowType, openingShape })),
  )

  test.each(cases)('$windowType $openingShape: none lies in an edge plane facing in', (shape) => {
    const width = 1.2
    const height = 1
    const mesh = buildWindowPreviewMesh(
      WindowNode.parse({ width, height, sill: true, position: [0, 1.5, 0], ...shape }),
    )
    mesh.updateWorldMatrix(true, true)
    // In the window's own frame: the opening's centre at the origin.
    const toWindow = mesh.matrixWorld.clone().invert()
    const planes = [
      { axis: 'y', at: -height / 2, inward: 1 },
      { axis: 'y', at: height / 2, inward: -1 },
      { axis: 'x', at: -width / 2, inward: 1 },
      { axis: 'x', at: width / 2, inward: -1 },
    ] as const
    const inPlane: string[] = []
    mesh.traverse((object) => {
      const part = object as THREE.Mesh
      if (!part.isMesh || !part.visible || part === mesh) return
      const position = part.geometry.getAttribute('position')
      const index = part.geometry.getIndex()
      const corner = (i: number) =>
        new THREE.Vector3()
          .fromBufferAttribute(position, index ? index.getX(i) : i)
          .applyMatrix4(part.matrixWorld)
          .applyMatrix4(toWindow)
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const [a, b, c] = [corner(i), corner(i + 1), corner(i + 2)]
        const normal = new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a))
        if (normal.lengthSq() < 1e-16) continue
        normal.normalize()
        for (const { axis, at, inward } of planes) {
          if (normal[axis] * inward < 0.999) continue
          if ([a, b, c].every((p) => Math.abs(p[axis] - at) < 1e-5)) inPlane.push(`${axis} ${at}`)
        }
      }
    })
    expect(inPlane).toEqual([])
  })
})

/**
 * A window's frame used to be 0.07 m deep whatever its wall, so a thicker wall showed its cut faces
 * around the frame. Left unset, the depth follows the host wall: its thickness exactly,
 * and the sill still starts at the frame's front face.
 */
describe("a window's frame depth follows its wall", () => {
  function windowOn(wallThickness: number, patch: Partial<WindowNode> = {}) {
    const wall = WallNode.parse({
      id: `wall_window_frame_${wallThickness}`,
      start: [0, 0],
      end: [4, 0],
      thickness: wallThickness,
    })
    const node = WindowNode.parse({
      id: 'window_frame_test',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1.5, 0],
      width: 1.2,
      height: 1,
      sill: true,
      ...patch,
    })
    const previous = useScene.getState().nodes
    useScene.setState({ nodes: { ...previous, [wall.id]: wall } })
    const mesh = buildWindowPreviewMesh(node)
    useScene.setState({ nodes: previous })
    mesh.updateWorldMatrix(true, true)
    return { node, mesh }
  }

  function hitboxDepth(mesh: THREE.Mesh): number {
    return (mesh.geometry as THREE.BoxGeometry).parameters.depth
  }

  /** The sill: the box under the opening, wider than the window, in the window's own frame. */
  function sillBox(mesh: THREE.Mesh, node: WindowNode): THREE.Box3 | undefined {
    const toWindow = mesh.matrixWorld.clone().invert()
    let found: THREE.Box3 | undefined
    mesh.traverse((object) => {
      const part = object as THREE.Mesh
      if (!part.isMesh || part === mesh) return
      const box = new THREE.Box3().setFromObject(part).applyMatrix4(toWindow)
      if (box.max.y <= -node.height / 2 + 0.002 && box.max.x - box.min.x > node.width) found = box
    })
    return found
  }

  test('a window with no frame depth in a 0.2 m wall gets a 0.2 m frame', () => {
    const { mesh } = windowOn(0.2)
    expect(hitboxDepth(mesh)).toBeCloseTo(0.2, 9)
  })

  test('an explicit 0.07 m frame stays 0.07 m in a 0.2 m wall', () => {
    expect(hitboxDepth(windowOn(0.2, { frameDepth: 0.07 }).mesh)).toBeCloseTo(0.07, 9)
  })

  test('the sill stands out from the resolved frame front', () => {
    const { mesh, node } = windowOn(0.2)
    const sill = sillBox(mesh, node)
    expect(sill).toBeDefined()
    // The frame's front face is at +0.1; the sill starts there and runs outward.
    expect(sill!.min.z).toBeCloseTo(0.1, 6)
    expect(sill!.max.z).toBeCloseTo(0.1 + node.sillDepth, 6)
  })
})

describe('window sash sections, hardware and pane grids', () => {
  const casements = [
    { windowType: 'casement', hingesSide: 'left' },
    { windowType: 'casement', hingesSide: 'right' },
    { windowType: 'casement', casementStyle: 'french' },
    { windowType: 'awning' },
    { windowType: 'hopper' },
  ] as const
  const operable = [
    ...casements,
    { windowType: 'single-hung' },
    { windowType: 'double-hung' },
    { windowType: 'sliding' },
  ] as const
  const parts = (root: THREE.Object3D, predicate: (part: THREE.Object3D) => boolean) => {
    const found: THREE.Object3D[] = []
    root.traverse((part) => {
      if (predicate(part)) found.push(part)
    })
    return found
  }
  const named = (root: THREE.Object3D, name: string) => parts(root, (part) => part.name === name)
  const meshes = (root: THREE.Object3D, slot: string) =>
    parts(
      root,
      (part) => part instanceof THREE.Mesh && part.userData.slotId === slot,
    ) as THREE.Mesh[]

  test.each(casements)(
    '$windowType stays within its measured triangle budget with 10 percent headroom',
    (fields) => {
      const mesh = buildWindowPreviewMesh(WindowNode.parse(fields))
      let triangles = 0
      mesh.traverse((part) => {
        if (!(part instanceof THREE.Mesh) || part.material === mesh.material) return
        triangles +=
          (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3
      })
      const measured = 'casementStyle' in fields && fields.casementStyle === 'french' ? 2264 : 1168
      expect(triangles).toBeGreaterThan(0)
      expect(triangles).toBeLessThanOrEqual(Math.ceil(measured * 1.1))
    },
  )

  test.each(operable)('a thick wall keeps $windowType sash and glass sections small', (fields) => {
    const node = WindowNode.parse({ ...fields, frameDepth: 0.6, sill: false })
    const mesh = buildWindowPreviewMesh(node)
    const sashes = parts(
      mesh,
      (part) =>
        part instanceof THREE.Group &&
        /sash|active-panel/.test(part.name) &&
        !/hardware/.test(part.name),
    )
    expect(sashes.length).toBeGreaterThan(0)
    for (const sash of sashes) {
      for (const part of meshes(sash, 'frame')) {
        const box = new THREE.Box3().setFromBufferAttribute(part.geometry.getAttribute('position'))
        expect(box.max.z - box.min.z).toBeLessThanOrEqual(0.068001)
      }
    }
    for (const part of meshes(mesh, 'glass')) {
      part.geometry.computeBoundingBox()
      expect(part.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(
        0.024001,
      )
    }
  })

  test.each(casements)('a closed $windowType fits between 0.3 m wall faces', (fields) => {
    const mesh = buildWindowPreviewMesh(
      WindowNode.parse({ ...fields, frameDepth: 0.3, sill: false }),
    )
    mesh.updateWorldMatrix(true, true)
    for (const part of parts(mesh, (p) => p instanceof THREE.Mesh && p.visible && p !== mesh)) {
      const box = new THREE.Box3().setFromObject(part)
      expect(box.min.z).toBeGreaterThanOrEqual(-0.150001)
      expect(box.max.z).toBeLessThanOrEqual(0.150001)
    }
    const sash = mesh.children.find((part) => /sash$/.test(part.name))!
    expect(sash.position.z).toBeCloseTo(0.3 * 0.06)
  })

  test.each(casements)('$windowType hardware follows its sash at 0, 0.5 and 1', (fields) => {
    const node = WindowNode.parse({ ...fields, frameDepth: 0.3, sill: false })
    const mesh = buildWindowPreviewMesh(node)
    const count = 'casementStyle' in fields ? 2 : 1
    expect(named(mesh, 'window-handle')).toHaveLength(count)
    expect(named(mesh, 'window-hinge')).toHaveLength(count * 2)
    for (const hinge of named(mesh, 'window-hinge')) {
      expect(hinge.children).toHaveLength(2)
      expect(
        new THREE.Box3().setFromObject(hinge).getSize(new THREE.Vector3()).length(),
      ).toBeGreaterThan(0)
    }
    for (const value of [0, 0.5, 1]) {
      expect(poseWindowMovingParts(node, mesh, value)).toBe(true)
      const authored = buildWindowPreviewMesh({ ...node, operationState: value })
      mesh.updateWorldMatrix(true, true)
      authored.updateWorldMatrix(true, true)
      const actualParts = meshes(mesh, 'hardware')
      const authoredParts = meshes(authored, 'hardware')
      expect(actualParts).toHaveLength(authoredParts.length)
      for (const [i, part] of actualParts.entries()) {
        expect(part.matrixWorld.elements).toEqual(authoredParts[i]!.matrixWorld.elements)
      }
    }
  })

  test('hardware follows the painted frame unless painted itself; handles can be omitted', () => {
    const node = WindowNode.parse({ windowType: 'casement', slots: { frame: '#bc8844' } })
    const mesh = buildWindowPreviewMesh(node)
    const frame = meshes(mesh, 'frame')[0]!
    expect(meshes(mesh, 'hardware').every((part) => part.material === frame.material)).toBe(true)
    const painted = buildWindowPreviewMesh({
      ...node,
      slots: { ...node.slots, hardware: '#335577' },
    })
    for (const part of meshes(painted, 'hardware')) {
      expect((part.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('335577')
      expect(part.geometry.userData.shared).toBe(true)
      expect(part.scale.toArray()).toEqual([1, 1, 1])
    }
    const noHandle = buildWindowPreviewMesh({ ...node, windowHandle: false })
    expect(named(noHandle, 'window-handle')).toHaveLength(0)
    expect(named(noHandle, 'window-hinge')).toHaveLength(2)
  })

  test.each(['fixed', 'single-hung', 'double-hung', 'sliding', 'bay', 'bow', 'louvered'] as const)(
    '%s has no sash hardware',
    (windowType) => {
      expect(
        meshes(buildWindowPreviewMesh(WindowNode.parse({ windowType })), 'hardware'),
      ).toHaveLength(0)
    },
  )

  test.each(operable)('$windowType gets a 3 by 2 grid in each sash only when enabled', (fields) => {
    const node = WindowNode.parse({
      ...fields,
      frameDepth: 0.3,
      columnRatios: [1, 2, 1],
      rowRatios: [1, 1],
      sill: false,
    })
    expect(named(buildWindowPreviewMesh(node), 'window-sash-grid')).toHaveLength(0)
    const mesh = buildWindowPreviewMesh({ ...node, sashGrid: true })
    const count =
      fields.windowType.includes('hung') ||
      fields.windowType === 'sliding' ||
      'casementStyle' in fields
        ? 2
        : 1
    const grids = named(mesh, 'window-sash-grid')
    expect(grids).toHaveLength(count)
    for (const grid of grids) {
      expect(grid.children).toHaveLength(5)
      for (const bar of grid.children as THREE.Mesh[]) {
        expect(bar.userData.slotId).toBe('frame')
        bar.geometry.computeBoundingBox()
        expect(bar.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(0.05)
      }
      const glass = (grid.parent!.children as THREE.Mesh[]).find(
        (part) => part.userData.slotId === 'glass',
      )!
      glass.geometry.computeBoundingBox()
      expect(grid.position.z).toBeCloseTo(
        glass.position.z + glass.geometry.boundingBox!.getCenter(new THREE.Vector3()).z,
      )
    }
  })

  test.each(['rounded', 'arch'] as const)(
    'shaped %s sashes retain hardware and skip unclipped grids',
    (openingShape) => {
      for (const fields of casements) {
        const mesh = buildWindowPreviewMesh(
          WindowNode.parse({
            ...fields,
            openingShape,
            sashGrid: true,
            columnRatios: [1, 1, 1],
            rowRatios: [1, 1],
          }),
        )
        expect(named(mesh, 'window-handle')).toHaveLength('casementStyle' in fields ? 2 : 1)
        expect(named(mesh, 'window-sash-grid')).toHaveLength(0)
      }
    },
  )

  test.each(['rectangle', 'rounded', 'arch'] as const)(
    'fixed %s mullions are at most 50 mm deep',
    (openingShape) => {
      const mesh = buildWindowPreviewMesh(
        WindowNode.parse({
          frameDepth: 0.3,
          openingShape,
          columnRatios: [1, 1, 1],
          rowRatios: [1, 1],
          sill: false,
        }),
      )
      const bars = meshes(mesh, 'frame').filter((part) => {
        part.geometry.computeBoundingBox()
        const size = part.geometry.boundingBox!.getSize(new THREE.Vector3())
        return size.z < 0.29
      })
      expect(bars.length).toBeGreaterThan(0)
      for (const part of bars)
        expect(part.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(
          0.050001,
        )
    },
  )
})

describe('window stool and decorative shutters', () => {
  test.each([false, true])(
    'finds the room and exterior even with the wall reversed: %s',
    (reversed) => {
      const points = [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ] as [number, number][]
      const walls = points.map((start, i) =>
        WallNode.parse({
          id: `wall_details_${i}`,
          start: reversed ? points[(i + 1) % 4] : start,
          end: reversed ? start : points[(i + 1) % 4],
          thickness: 0.3,
        }),
      )
      const nodes = Object.fromEntries(walls.map((wall) => [wall.id, wall]))
      const wall = walls[0]!
      const previous = useScene.getState().nodes
      useScene.setState({ nodes })
      try {
        for (const rotation of [0, Math.PI]) {
          const node = WindowNode.parse({
            parentId: wall.id,
            position: [2, 1.5, 0.02],
            rotation: [0, rotation, 0],
            width: 1.4,
            height: 1,
            sill: false,
            sillInterior: true,
            shutters: 'panel',
            casingFaceA: true,
            casingFaceB: true,
          })
          const mesh = buildWindowPreviewMesh(node)
          const host = new THREE.Group()
          host.position.set(wall.start[0], 0, wall.start[1])
          host.rotation.y = -Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
          host.add(mesh)
          mesh.updateWorldMatrix(true, true)
          const stool = mesh.getObjectByName('window-interior-stool') as THREE.Mesh
          const board = new THREE.Box3().setFromObject(stool)
          expect(board.getSize(new THREE.Vector3()).x).toBeCloseTo(1.4 + 2 * (0.0508 + 0.015))
          expect(board.getSize(new THREE.Vector3()).y).toBeCloseTo(0.03)
          // This room is always on world +Z of its south wall, regardless of wall direction or unit facing.
          expect(board.min.z).toBeCloseTo(0.15)
          expect(board.max.z).toBeCloseTo(0.21)
          const shutters = mesh.children.filter(
            (part) => part.name === 'shutter-left' || part.name === 'shutter-right',
          )
          expect(shutters).toHaveLength(2)
          for (const shutter of shutters) {
            const box = new THREE.Box3().setFromObject(shutter)
            expect(box.min.z).toBeCloseTo(-0.2)
            expect(box.max.z).toBeCloseTo(shutter.name === 'shutter-left' ? -0.16 : -0.17)
            expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(
              shutter.name === 'shutter-left' ? 0.71 : 0.7,
            )
            expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(1)
            expect(shutter.children.every((part) => part.userData.slotId === 'shutters')).toBe(true)
          }
        }
      } finally {
        useScene.setState({ nodes: previous })
      }
    },
  )

  test('absent details add no stool or shutters; louvered shutters use 40 mm slat pitch', () => {
    const node = WindowNode.parse({ width: 1.2, height: 1, sill: false })
    expect(buildWindowPreviewMesh(node).getObjectByName('window-interior-stool')).toBeUndefined()
    expect(buildWindowPreviewMesh(node).getObjectByName('shutter-left')).toBeUndefined()
    const mesh = buildWindowPreviewMesh({ ...node, shutters: 'louvered', shutterWidth: 0.4 })
    const shutter = mesh.getObjectByName('shutter-left')!
    const slats = shutter.children.slice(4)
    expect(slats.length).toBeGreaterThan(10)
    expect(slats[1]!.position.y - slats[0]!.position.y).toBeCloseTo(0.04)
    expect(new THREE.Box3().setFromObject(shutter).getSize(new THREE.Vector3()).x).toBeCloseTo(0.41)
    const material = (slats[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(material.color.getHexString()).toBe('4e5257')
  })
})

describe('room-aware window motion and exterior accessories', () => {
  function inRoom(run: (wall: WallNode) => void) {
    const points: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ]
    const walls = points.map((start, i) =>
      WallNode.parse({ start, end: points[(i + 1) % 4], thickness: 0.3 }),
    )
    const previous = useScene.getState().nodes
    useScene.setState({ nodes: Object.fromEntries(walls.map((wall) => [wall.id, wall])) })
    try {
      run(walls[0]!)
    } finally {
      useScene.setState({ nodes: previous })
    }
  }
  const collect = (root: THREE.Object3D, name: string) => {
    const found: THREE.Object3D[] = []
    root.traverse((part) => {
      if (part.name === name) found.push(part)
    })
    return found
  }
  const localPoint = (root: THREE.Object3D, part: THREE.Object3D, point: THREE.Vector3) => {
    root.updateWorldMatrix(true, true)
    return point.applyMatrix4(part.matrixWorld).applyMatrix4(root.matrixWorld.clone().invert())
  }

  test.each(['casement', 'awning', 'hopper', 'tilt-turn'] as const)(
    '%s poses its sash on the chosen side at 0, 0.5 and 1',
    (windowType) => {
      inRoom((wall) => {
        for (const side of ['front', 'back'] as const) {
          for (const openingDirection of ['outward', 'inward'] as const) {
            for (const hingesSide of ['left', 'right'] as const) {
              for (const mode of windowType === 'tilt-turn'
                ? (['tilt', 'turn'] as const)
                : (['tilt'] as const)) {
                const node = WindowNode.parse({
                  parentId: wall.id,
                  position: [2, 1.5, 0],
                  side,
                  rotation: [0, side === 'front' ? 0 : Math.PI, 0],
                  windowType,
                  openingDirection,
                  hingesSide,
                  tiltTurnMode: mode,
                  sill: false,
                  sashGrid: true,
                  columnRatios: [1, 1],
                  rowRatios: [1, 1],
                })
                const mesh = buildWindowPreviewMesh(node)
                const sash = mesh.children.find((part) => /sash$/.test(part.name))!
                const handle = mesh.getObjectByName('window-handle')!
                expect(handle).toBeDefined()
                expect(collect(mesh, 'window-sash-grid')).toHaveLength(1)
                const interior = side === 'front' ? 1 : -1
                expect(handle.position.z * interior).toBeGreaterThan(0)
                const maxAngle =
                  windowType === 'tilt-turn'
                    ? mode === 'tilt'
                      ? Math.PI / 12
                      : Math.PI / 2
                    : windowType === 'casement'
                      ? Math.PI / 2
                      : Math.PI / 3
                for (const value of [0, 0.5, 1]) {
                  expect(poseWindowMovingParts(node, mesh, value)).toBe(true)
                  const authored = buildWindowPreviewMesh({ ...node, operationState: value })
                  expect(sash.quaternion.toArray()).toEqual(
                    authored.getObjectByName(sash.name)!.quaternion.toArray(),
                  )
                  expect(
                    Math.max(Math.abs(sash.rotation.x), Math.abs(sash.rotation.y)),
                  ).toBeCloseTo(maxAngle * value)
                  const point = new THREE.Vector3()
                  if (windowType === 'casement' || (windowType === 'tilt-turn' && mode === 'turn'))
                    point.x =
                      (hingesSide === 'left' ? 1 : -1) * (node.width - 2 * node.frameThickness)
                  else
                    point.y =
                      (windowType === 'awning' ? -1 : 1) * (node.height - 2 * node.frameThickness)
                  const moved = localPoint(mesh, sash, point).z - sash.position.z
                  const opensInward =
                    windowType === 'hopper' ||
                    windowType === 'tilt-turn' ||
                    openingDirection === 'inward'
                  if (value > 0)
                    expect(moved * interior * (opensInward ? 1 : -1)).toBeGreaterThan(0)
                }
                if (windowType === 'tilt-turn') {
                  expect(collect(mesh, 'window-hinge')).toHaveLength(3)
                  expect(handle.rotation.z).toBeCloseTo(Math.PI / 2)
                }
                // A detached export clone retains the room side after the live scene goes away.
                const clone = mesh.clone(true)
                expect(poseWindowMovingParts(node, clone, 0.5)).toBe(true)
                expect(clone.userData.windowExteriorSign).toBe(mesh.userData.windowExteriorSign)
              }
            }
          }
        }
      })
    },
  )

  test.each(['rectangle', 'rounded', 'arch'] as const)(
    'French casement %s uses opposite leaf pivots for inward and outward',
    (openingShape) => {
      inRoom((wall) => {
        for (const openingDirection of ['inward', 'outward'] as const) {
          const node = WindowNode.parse({
            parentId: wall.id,
            windowType: 'casement',
            casementStyle: 'french',
            openingShape,
            openingDirection,
          })
          const mesh = buildWindowPreviewMesh(node)
          for (const value of [0, 0.5, 1]) {
            poseWindowMovingParts(node, mesh, value)
            const expected = ((openingDirection === 'outward' ? 1 : -1) * value * Math.PI) / 2
            expect(mesh.getObjectByName('french-casement-left-sash')!.rotation.y).toBeCloseTo(
              expected,
            )
            expect(mesh.getObjectByName('french-casement-right-sash')!.rotation.y).toBeCloseTo(
              -expected,
            )
          }
        }
      })
    },
  )

  test('legacy casement and awning retain placement-face motion without a direction', () => {
    inRoom((wall) => {
      for (const windowType of ['casement', 'awning'] as const) {
        for (const side of ['front', 'back'] as const) {
          const node = WindowNode.parse({
            parentId: wall.id,
            windowType,
            side,
            rotation: [0, side === 'front' ? 0 : Math.PI, 0],
          })
          const mesh = buildWindowPreviewMesh(node)
          const sash = mesh.children.find((part) => /sash$/.test(part.name))!
          for (const value of [0, 0.5, 1]) {
            poseWindowMovingParts(node, mesh, value)
            expect(windowType === 'casement' ? sash.rotation.y : sash.rotation.x).toBeCloseTo(
              -value * (windowType === 'casement' ? Math.PI / 2 : Math.PI / 3),
            )
          }
        }
      }
    })
  })

  test('inside placement puts the sill and roller outside, and both sills use the paintable sill slot', () => {
    inRoom((wall) => {
      const node = WindowNode.parse({
        parentId: wall.id,
        position: [2, 1.5, 0.02],
        side: 'front',
        sillInterior: true,
        sillOverhang: 0.12,
        sillInteriorDepth: 0.15,
        sillInteriorThickness: 0.05,
        sillInteriorOverhang: 0.02,
        casingFaceA: true,
        casingWidth: 0.08,
        rollerShutter: 'box',
        rollerShutterOpen: 0.5,
        slots: { frame: '#884422', sill: '#aabbcc' },
      })
      const mesh = buildWindowPreviewMesh(node)
      mesh.updateWorldMatrix(true, true)
      const outside = mesh.getObjectByName('window-exterior-sill') as THREE.Mesh
      const inside = mesh.getObjectByName('window-interior-stool') as THREE.Mesh
      const extBox = new THREE.Box3().setFromObject(outside)
      expect(extBox.max.z).toBeCloseTo(-0.15)
      expect(extBox.getSize(new THREE.Vector3()).x).toBeCloseTo(node.width + 0.24)
      const intBox = new THREE.Box3().setFromObject(inside)
      expect(intBox.min.z).toBeCloseTo(0.15)
      expect(intBox.max.z).toBeCloseTo(0.3)
      expect(intBox.getSize(new THREE.Vector3()).x).toBeCloseTo(node.width + 0.2)
      expect(intBox.getSize(new THREE.Vector3()).y).toBeCloseTo(0.05)
      for (const sill of [inside, outside]) {
        expect(sill.userData.slotId).toBe('sill')
        expect((sill.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('aabbcc')
      }
      const roller = mesh.getObjectByName('window-roller-box') as THREE.Mesh
      const boxSize = new THREE.Box3().setFromObject(roller).getSize(new THREE.Vector3())
      expect(boxSize.x).toBeCloseTo(node.width + 0.08)
      expect(boxSize.y).toBeCloseTo(0.18)
      expect(boxSize.z).toBeCloseTo(0.18)
      expect(new THREE.Box3().setFromObject(roller).max.z).toBeLessThan(-0.15)
      const curtain = mesh.getObjectByName('window-roller-curtain')!
      const curtainBox = new THREE.Box3().setFromObject(curtain)
      const slatCount = Math.floor(((1 - node.rollerShutterOpen!) * node.height) / 0.04)
      expect(curtainBox.getSize(new THREE.Vector3()).y).toBeCloseTo(slatCount * 0.04 - 0.004)
      expect(curtainBox.getSize(new THREE.Vector3()).z).toBeCloseTo(0.01)
      expect(collect(mesh, 'window-roller-guide')).toHaveLength(2)
      expect(curtain.children).toHaveLength(1)
      expect(curtain.children[0]!.userData.slotId).toBe('shutters')
      poseWindowMovingParts(node, mesh, 1)
      expect(new THREE.Box3().setFromObject(curtain).equals(curtainBox)).toBe(true)
      expect(
        buildWindowPreviewMesh({ ...node, rollerShutterOpen: undefined }).getObjectByName(
          'window-roller-curtain',
        )!.children,
      ).toHaveLength(0)
    })
  })

  test.each(
    (['box', 'concealed'] as const).flatMap((rollerShutter) =>
      [0, 0.5, 0.63, 0.99, 1, undefined].map((rollerShutterOpen) => ({
        rollerShutter,
        rollerShutterOpen,
      })),
    ),
  )(
    '$rollerShutter roller curtain at open=$rollerShutterOpen merges whole slats with gaps and at most 12 triangles each',
    ({ rollerShutterOpen, rollerShutter }) => {
      const node = WindowNode.parse({
        width: 1.2,
        height: 1.03,
        rollerShutter,
        rollerShutterOpen,
      })
      const mesh = buildWindowPreviewMesh(node)
      const curtain = mesh.getObjectByName('window-roller-curtain')!
      const slatCount = Math.floor(((1 - (rollerShutterOpen ?? 1)) * node.height) / 0.04)
      expect(curtain.children).toHaveLength(slatCount > 0 ? 1 : 0)
      if (slatCount === 0) return

      const panel = curtain.children[0] as THREE.Mesh
      expect(panel.userData.slotId).toBe('shutters')
      const position = panel.geometry.getAttribute('position')
      const uv = panel.geometry.getAttribute('uv')
      const index = panel.geometry.getIndex()
      const slatBounds = new Map<number, THREE.Box3>()
      const slatAt = (vertex: number) =>
        Math.floor((node.height / 2 - position.getY(vertex) + 1e-6) / 0.04)
      for (let i = 0; i < position.count; i++) {
        const slat = slatAt(i)
        const bounds = slatBounds.get(slat) ?? new THREE.Box3()
        bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(position, i))
        slatBounds.set(slat, bounds)
      }
      expect(slatBounds.size).toBe(slatCount)
      for (let i = 0; i < slatCount; i++) {
        const bounds = slatBounds.get(i)!
        const size = bounds.getSize(new THREE.Vector3())
        expect(size.x).toBeCloseTo(node.width - (rollerShutter === 'concealed' ? 0.05 : 0))
        expect(size.y).toBeCloseTo(0.036)
        expect(size.z).toBeCloseTo(0.01)
        expect(bounds.max.y).toBeCloseTo(node.height / 2 - i * 0.04)
        if (i > 0) expect(slatBounds.get(i - 1)!.min.y - bounds.max.y).toBeCloseTo(0.004)
      }
      const triangles = Array<number>(slatCount).fill(0)
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const vertices = [0, 1, 2].map((offset) => (index ? index.getX(i + offset) : i + offset))
        const slat = slatAt(vertices[0]!)
        for (const vertex of vertices) expect(slatAt(vertex)).toBe(slat)
        triangles[slat]!++
        // Every box face maps metres in its plane to metres in UV space.
        const [a, b] = vertices as [number, number, number]
        const edgeLength = new THREE.Vector3()
          .fromBufferAttribute(position, a)
          .distanceTo(new THREE.Vector3().fromBufferAttribute(position, b))
        const uvLength = new THREE.Vector2()
          .fromBufferAttribute(uv, a)
          .distanceTo(new THREE.Vector2().fromBufferAttribute(uv, b))
        expect(uvLength).toBeCloseTo(edgeLength, 6)
      }
      for (const count of triangles) {
        expect(count).toBeGreaterThan(0)
        expect(count).toBeLessThanOrEqual(12)
      }
    },
  )

  test.each(['panel', 'louvered', 'board-batten'] as const)(
    '%s shutters cover the opening beside casing, with selectable sides and explicit widths',
    (shutters) => {
      inRoom((wall) => {
        const node = WindowNode.parse({
          parentId: wall.id,
          width: 1.4,
          height: 1.4,
          shutters,
          shutterWidth: 0.7,
          shutterSides: 'left',
          casingFaceB: true,
          casingWidth: 0.09,
          sill: false,
        })
        for (const open of [0, 0.5, 1]) {
          const mesh = buildWindowPreviewMesh({ ...node, shutterOpen: open })
          const leaves = collect(mesh, 'shutter-left')
          expect(leaves).toHaveLength(1)
          const leaf = leaves[0]!
          expect(leaf.position.x).toBeCloseTo(-0.7)
          expect(leaf.position.z).toBeCloseTo(-0.185)
          expect(leaf.rotation.y).toBeCloseTo(-Math.PI * (1 - open))
          if (open === 1)
            expect(new THREE.Box3().setFromObject(leaf).getSize(new THREE.Vector3()).x).toBeCloseTo(
              0.7,
            )
          for (const part of leaf.children) expect(part.userData.slotId).toBe('shutters')
        }
        const plain = buildWindowPreviewMesh({ ...node, casingFaceB: false, shutterSides: 'right' })
        expect(collect(plain, 'shutter-right')[0]!.position.x).toBeCloseTo(0.7)
      })
    },
  )
  test.each(['both', 'left', 'right'] as const)(
    'default %s shutters cover the entire opening without a width cap, including with casing',
    (shutterSides) => {
      inRoom((wall) => {
        for (const width of [1.4, 2]) {
          const node = WindowNode.parse({
            parentId: wall.id,
            width,
            shutters: 'panel',
            shutterSides,
            shutterOpen: 0,
            casingFaceB: true,
            casingWidth: 0.09,
            sill: false,
          })
          const mesh = buildWindowPreviewMesh(node)
          mesh.updateWorldMatrix(true, true)
          const leaves = ['shutter-left', 'shutter-right']
            .map((name) => mesh.getObjectByName(name))
            .filter((leaf) => leaf !== undefined)
          expect(leaves).toHaveLength(shutterSides === 'both' ? 2 : 1)
          const bounds = leaves.map((leaf) => new THREE.Box3().setFromObject(leaf!))
          const all = bounds.reduce((box, leaf) => box.union(leaf), new THREE.Box3())
          expect(all.min.x).toBeCloseTo(-width / 2)
          expect(all.max.x).toBeCloseTo(width / 2)
          if (shutterSides === 'both') {
            expect(bounds[0]!.max.x - bounds[1]!.min.x).toBeCloseTo(0.01)
            expect(mesh.getObjectByName('window-shutter-overlap')).toBeDefined()
          } else expect(mesh.getObjectByName('window-shutter-overlap')).toBeUndefined()
        }
      })
    },
  )

  test.each(['panel', 'louvered', 'board-batten'] as const)(
    '%s shutters split only above 0.75 m and fold two equal halves without changing the wall hinge',
    (shutters) => {
      for (const side of [-1, 1]) {
        for (const width of [0.75, 0.7501, 1]) {
          const node = WindowNode.parse({
            width: 2,
            height: 1.5,
            shutters,
            shutterWidth: width,
            shutterSides: side === -1 ? 'left' : 'right',
            shutterOpen: 0,
            sill: false,
          })
          const mesh = buildWindowPreviewMesh(node)
          const inner = mesh.getObjectByName(side === -1 ? 'shutter-left' : 'shutter-right')!
          const outer = inner.getObjectByName('shutter-outer')
          const closed = new THREE.Box3().setFromObject(inner)
          expect(closed.getSize(new THREE.Vector3()).x).toBeCloseTo(width)
          expect(Boolean(outer)).toBe(width > 0.75)
          if (!outer) continue
          const hinge = inner.position.clone()
          // The shared hinge bisects the closed assembly in the opening plane.
          expect(Math.abs(outer.position.x)).toBeCloseTo(width / 2)
          for (const open of [0, 0.5, 1]) {
            poseWindowMovingParts(node, mesh, 0, open)
            mesh.updateWorldMatrix(true, true)
            expect(inner.position.equals(hinge)).toBe(true)
            const innerDirection = new THREE.Vector3(side, 0, 0).transformDirection(
              inner.matrixWorld,
            )
            const outerDirection = new THREE.Vector3(side, 0, 0).transformDirection(
              outer.matrixWorld,
            )
            expect(innerDirection.dot(outerDirection)).toBeCloseTo(
              open === 0 ? 1 : open === 0.5 ? 0 : -1,
            )
            if (open === 0) {
              expect(Math.abs(innerDirection.x)).toBeCloseTo(1)
              expect(Math.abs(outerDirection.x)).toBeCloseTo(1)
            } else if (open === 0.5) expect(Math.abs(innerDirection.x)).toBeCloseTo(Math.SQRT1_2)
            else {
              const stacked = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3())
              expect(stacked.x).toBeLessThan(0.09)
              expect(stacked.z).toBeCloseTo(width / 2)
            }
          }
        }
      }
    },
  )

  test.each(['casement', 'awning', 'tilt-turn', 'fixed'] as const)(
    'concealed roller clears every closed %s frame, sash, glass and hardware vertex',
    (windowType) => {
      inRoom((wall) => {
        for (const side of ['front', 'back'] as const) {
          for (const frameDepth of [0.07, 0.3]) {
            for (const operationState of [0, 1]) {
              const node = WindowNode.parse({
                parentId: wall.id,
                position: [2, 1.5, 0],
                rotation: [0, side === 'front' ? 0 : Math.PI, 0],
                side,
                windowType,
                frameDepth,
                operationState,
                rollerShutter: 'concealed',
                rollerShutterOpen: 0,
                sill: false,
                sashGrid: true,
                columnRatios: [1, 1],
              })
              const mesh = buildWindowPreviewMesh(node)
              const curtain = mesh.getObjectByName('window-roller-curtain')!
              const exterior = mesh.userData.windowExteriorSign as number
              poseWindowMovingParts(node, mesh, 0)
              mesh.updateWorldMatrix(true, true)
              const toWindow = mesh.matrixWorld.clone().invert()
              let extent = -Infinity
              let vertices = 0
              mesh.traverse((part) => {
                if (
                  !(part instanceof THREE.Mesh) ||
                  !['frame', 'glass', 'hardware'].includes(part.userData.slotId)
                )
                  return
                const position = part.geometry.getAttribute('position')
                for (let i = 0; i < position.count; i++) {
                  const z =
                    new THREE.Vector3()
                      .fromBufferAttribute(position, i)
                      .applyMatrix4(part.matrixWorld)
                      .applyMatrix4(toWindow).z * exterior
                  expect(curtain.position.z * exterior).toBeGreaterThan(z)
                  extent = Math.max(extent, z)
                  vertices++
                }
              })
              expect(vertices).toBeGreaterThan(0)
              expect(curtain.position.z * exterior - extent).toBeCloseTo(0.015, 6)
              for (const guide of collect(mesh, 'window-roller-guide'))
                expect(guide.position.z).toBeCloseTo(curtain.position.z, 6)
            }
          }
        }
      })
    },
  )

  test.each(['front', 'back'] as const)(
    'concealed roller stays within the reveal on the %s placement face; box height is configurable',
    (side) =>
      inRoom((wall) => {
        const node = WindowNode.parse({
          parentId: wall.id,
          position: [2, 1.5, 0.02],
          rotation: [0, side === 'front' ? 0 : Math.PI, 0],
          side,
          width: 1.2,
          height: 1.4,
          frameDepth: 0.07,
          rollerShutter: 'concealed',
          rollerShutterBoxHeight: 0.4,
          rollerShutterOpen: 0,
          sill: false,
        })
        const mesh = buildWindowPreviewMesh(node)
        mesh.updateWorldMatrix(true, true)
        expect(mesh.getObjectByName('window-roller-box')).toBeUndefined()
        const parts: THREE.Mesh[] = []
        mesh.traverse((part) => {
          if (part instanceof THREE.Mesh && part.userData.slotId === 'shutters') parts.push(part)
        })
        expect(parts).toHaveLength(4)
        for (const part of parts) {
          const bounds = new THREE.Box3().setFromObject(part)
          expect(bounds.min.x).toBeGreaterThanOrEqual(2 - node.width / 2 - 1e-6)
          expect(bounds.max.x).toBeLessThanOrEqual(2 + node.width / 2 + 1e-6)
          expect(bounds.min.y).toBeGreaterThanOrEqual(1.5 - node.height / 2 - 1e-6)
          expect(bounds.max.y).toBeLessThanOrEqual(1.5 + node.height / 2 + 1e-6)
          expect(bounds.min.z).toBeGreaterThanOrEqual(-0.15 - 1e-6)
          expect(bounds.max.z).toBeLessThanOrEqual(0.15 + 1e-6)
        }
        const lintel = new THREE.Box3().setFromObject(mesh.getObjectByName('window-roller-lintel')!)
        expect(lintel.getSize(new THREE.Vector3()).y).toBeCloseTo(0.03)
        expect(lintel.max.y).toBeCloseTo(1.5 + node.height / 2 - 0.001, 6)
        expect(lintel.min.x).toBeCloseTo(2 - node.width / 2 + 0.001, 6)
        expect(lintel.max.x).toBeCloseTo(2 + node.width / 2 - 0.001, 6)
        // The head strip shares the curtain plane, clear of the frame head's face.
        expect(mesh.getObjectByName('window-roller-lintel')!.position.z).toBeCloseTo(
          mesh.getObjectByName('window-roller-curtain')!.position.z,
        )
        for (const guide of collect(mesh, 'window-roller-guide')) {
          const size = new THREE.Box3().setFromObject(guide).getSize(new THREE.Vector3())
          expect(guide.position.z).toBeCloseTo(
            mesh.getObjectByName('window-roller-curtain')!.position.z,
          )
          expect(size.x).toBeCloseTo(0.025)
          expect(size.z).toBeCloseTo(0.03)
        }
        const curtain = mesh.getObjectByName('window-roller-curtain')!
        expect(Math.abs(curtain.position.z)).toBeCloseTo(0.07 / 2 + 0.015)
        expect(new THREE.Box3().setFromObject(curtain).getSize(new THREE.Vector3()).x).toBeCloseTo(
          1.15,
        )
        const boxed = buildWindowPreviewMesh({ ...node, rollerShutter: 'box' })
        boxed.updateWorldMatrix(true, true)
        expect(boxed.getObjectByName('window-roller-lintel')).toBeUndefined()
        const box = new THREE.Box3().setFromObject(boxed.getObjectByName('window-roller-box')!)
        expect(box.getSize(new THREE.Vector3()).y).toBeCloseTo(0.4)
        expect(box.min.y).toBeCloseTo(1.5 + node.height / 2)
        expect(box.max.z).toBeLessThan(-0.15)
        const boxedCurtain = boxed.getObjectByName('window-roller-curtain')!
        const curtainBounds = new THREE.Box3().setFromObject(boxedCurtain)
        expect(box.min.z - curtainBounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0.015)
        for (const guide of collect(boxed, 'window-roller-guide'))
          expect(guide.position.z).toBeCloseTo(boxedCurtain.position.z)
      }),
  )
})
