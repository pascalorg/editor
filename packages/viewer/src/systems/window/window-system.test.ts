import { describe, expect, test } from 'bun:test'
import { WindowNode, WindowType } from '@pascal-app/core'
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
