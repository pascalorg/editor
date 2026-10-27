import { describe, expect, test } from 'bun:test'
import { OPENING_FRAME_LIP, useScene, WallNode, WindowNode, WindowType } from '@pascal-app/core'
import * as THREE from 'three'
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
 * around the frame. Left unset, the depth follows the host wall: its thickness plus a lip on each
 * face, and the sill still starts at the frame's front face.
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

  test('a window with no frame depth in a 0.2 m wall gets a 0.22 m frame', () => {
    const { mesh } = windowOn(0.2)
    expect(hitboxDepth(mesh)).toBeCloseTo(0.2 + OPENING_FRAME_LIP * 2, 9)
  })

  test('an explicit 0.07 m frame stays 0.07 m in a 0.2 m wall', () => {
    expect(hitboxDepth(windowOn(0.2, { frameDepth: 0.07 }).mesh)).toBeCloseTo(0.07, 9)
  })

  test('the sill stands out from the resolved frame front', () => {
    const { mesh, node } = windowOn(0.2)
    const sill = sillBox(mesh, node)
    expect(sill).toBeDefined()
    // The frame's front face is at +0.11; the sill starts there and runs outward.
    expect(sill!.min.z).toBeCloseTo(0.11, 6)
    expect(sill!.max.z).toBeCloseTo(0.11 + node.sillDepth, 6)
  })
})
