import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WallNode } from '@pascal-app/core'
import { convertIfcToPascal } from '../src'

const fixture = fileURLToPath(new URL('./fixtures/wall-extents.ifc', import.meta.url))
const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`

// A wall without an extrusion body (a Brep, or a Brep through a mapped item)
// gets its height and thickness from its mesh, measured in the wall frame.
// web-ifc meshes are (X, Z, -Y) in IFC terms whatever the preset: the plan is
// (x, -z) and the vertical is y. Reading them as IFC (x, y, z) fails the
// length gate and silently falls back to the 0.1 m / 2.5 m defaults.
for (const [swapYZ, name] of [true, false].flatMap((swap) =>
  ['Brep wall', 'Mapped wall'].map((wall) => [swap, wall] as const),
)) {
  test(`${name} keeps its measured height and thickness (swapYZ: ${swapYZ})`, async () => {
    const scene = await convertIfcToPascal(await readFile(fixture), undefined, {
      simplify: false,
      swapYZ,
      wasmPath,
    })
    const wall = Object.values(scene.nodes).find(
      (node) => node.type === 'wall' && node.name === name,
    ) as WallNode | undefined
    expect(wall).toBeDefined()
    expect(Math.hypot(wall!.end[0] - wall!.start[0], wall!.end[1] - wall!.start[1])).toBeCloseTo(
      5,
      4,
    )
    expect(wall!.thickness!).toBeCloseTo(0.3, 3)
    expect(wall!.height!).toBeCloseTo(3, 3)
  })
}
