import type { GeometryContext, LawnBuild, LawnNode } from '@pascal-app/core'
import { Group } from 'three'
import { buildLawnBladeBakeColors } from './bake-blade-colors'
import { addLawnBakeFlowers } from './bake-flowers'
import { addLawnBakeGround } from './bake-ground'
import { addLawnBakeMesh } from './bake-mesh'
import { lawnBladePoint } from './blade-shape'
import { buildVisibleLawn } from './render-build'
import { NEAR_ORDER, NEAR_TUFT } from './tuft-shape'

const TUFTS_PER_MESH = 6000

function expandTufts(
  population: LawnBuild['blades'],
  atlas: ReturnType<typeof buildLawnBladeBakeColors>,
  tufts: number[],
) {
  const count = tufts.length
  const vertices = NEAR_TUFT.length / 3
  const positions = new Float32Array(count * vertices * 3),
    normals = new Float32Array(positions.length),
    uv = new Float32Array(count * vertices * 2),
    indices = new Uint16Array(count * NEAR_ORDER.length * 2)
  const normalLength = Math.hypot(0.26, 1)
  for (let tuft = 0; tuft < count; tuft++) {
    const blade = tufts[tuft] ?? 0,
      input = blade * 4
    const [x = 0, y = 0, z = 0, height = 0] = population.rootHeight.subarray(input, input + 4)
    const [yaw = 0, lean = 0, , width = 0] = population.traits.subarray(input, input + 4)
    for (let vertex = 0; vertex < vertices; vertex++) {
      const side = NEAR_TUFT[vertex * 3] ?? 0,
        progress = NEAR_TUFT[vertex * 3 + 1] ?? 0,
        plane = NEAR_TUFT[vertex * 3 + 2] ?? 0
      const angle = yaw + plane * 1.83
      const point = lawnBladePoint(
        side * width * population.tuftWidthScale,
        progress,
        height,
        angle,
        lean,
        0,
        0,
        x,
        z,
      )
      const output = tuft * vertices + vertex
      positions.set([x + point[0], y + point[1] * (1 - plane * 0.11), z + point[2]], output * 3)
      normals.set(
        [
          (Math.sin(angle) * 0.26) / normalLength,
          1 / normalLength,
          (Math.cos(angle) * 0.26) / normalLength,
        ],
        output * 3,
      )
      uv.set(atlas.uv(blade, plane, side, progress), output * 2)
    }
    // The live normalNode points up on either face. Ordinary DoubleSide export
    // negates back-face normals, so author both windings with the SAME canopy normal.
    for (let index = 0; index < NEAR_ORDER.length; index += 3) {
      const a = tuft * vertices + (NEAR_ORDER[index] ?? 0),
        b = tuft * vertices + (NEAR_ORDER[index + 1] ?? 0),
        c = tuft * vertices + (NEAR_ORDER[index + 2] ?? 0)
      indices.set([a, b, c, c, b, a], tuft * NEAR_ORDER.length * 2 + index * 2)
    }
  }
  return { positions, normals, uv, indices }
}

/** A camera-independent snapshot of the chosen tuft, sward and flower appearance. */
export function buildLawnBakeGeometry(node: LawnNode, ctx?: Partial<GeometryContext>): Group {
  const group = new Group()
  group.name = 'lawn-geometry'
  const built = buildVisibleLawn(node, ctx)
  if (!built) return group
  addLawnBakeGround(group, node, built.base)
  if (built.blades.count) {
    const atlas = buildLawnBladeBakeColors(node, built.blades.traits)
    for (const [page, material] of atlas.materials.entries()) {
      const tufts: number[] = []
      for (let blade = 0; blade < built.blades.count; blade++)
        if (atlas.pageFor(blade) === page) tufts.push(blade)
      for (let start = 0; start < tufts.length; start += TUFTS_PER_MESH)
        addLawnBakeMesh(
          group,
          expandTufts(built.blades, atlas, tufts.slice(start, start + TUFTS_PER_MESH)),
          material,
          `lawn-blades-static-${page}-${start}`,
        )
    }
  }
  addLawnBakeFlowers(group, built.flowers)
  group.userData.lawn = built.facts
  return group
}
