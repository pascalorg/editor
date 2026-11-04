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
          expect(board.getSize(new THREE.Vector3()).x).toBeCloseTo(1.5)
          expect(board.getSize(new THREE.Vector3()).y).toBeCloseTo(0.03)
          // This room is always on world +Z of its south wall, regardless of wall direction or unit facing.
          expect(board.min.z).toBeCloseTo(0.15)
          expect(board.max.z).toBeCloseTo(0.21)
          const shutters = mesh.children.filter((part) => part.name === 'window-shutter')
          expect(shutters).toHaveLength(2)
          for (const shutter of shutters) {
            const box = new THREE.Box3().setFromObject(shutter)
            expect(box.min.z).toBeCloseTo(-0.2)
            expect(box.max.z).toBeCloseTo(-0.17)
            expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(0.6)
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
    expect(buildWindowPreviewMesh(node).getObjectByName('window-shutter')).toBeUndefined()
    const mesh = buildWindowPreviewMesh({ ...node, shutters: 'louvered', shutterWidth: 0.4 })
    const shutter = mesh.getObjectByName('window-shutter')!
    const slats = shutter.children.slice(4)
    expect(slats.length).toBeGreaterThan(10)
    expect(slats[1]!.position.y - slats[0]!.position.y).toBeCloseTo(0.04)
    expect(new THREE.Box3().setFromObject(shutter).getSize(new THREE.Vector3()).x).toBeCloseTo(0.4)
    const material = (slats[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(material.color.getHexString()).toBe('4e5257')
  })
})
