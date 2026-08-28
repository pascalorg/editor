import { describe, expect, test } from 'bun:test'
import { type AnyNode, LevelNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { type BoxGeometry, Matrix4, Mesh, Raycaster, Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { buildLeanToExtensionGeometry } from './geometry'
import { resolveLeanToFreestandingRunPlacement } from './placement'

function exposedCornerFraming(canopyForm: 'mono' | 'gable' | 'butterfly', turnZ: -4 | 4): string[] {
  const level = LevelNode.parse({ id: `level_${canopyForm}_${turnZ}`, level: 0 })
  const first = resolveLeanToFreestandingRunPlacement(level.id, [0, 0], [4, 0], false, canopyForm)!
  const second = resolveLeanToFreestandingRunPlacement(
    level.id,
    [4, 0],
    [4, turnZ],
    false,
    canopyForm,
  )!
  const runs = [first, second]
  const nodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  const assemblies = runs.map((run) => createLeanToAssembly(run, undefined, nodes))
  const roofMeshes = assemblies.flatMap((assembly, index) => {
    const run = runs[index]!
    return [assembly.segment, assembly.oppositeSegment]
      .filter((segment) => segment !== undefined)
      .map((segment) => {
        const matrix = new Matrix4()
          .makeTranslation(...run.position)
          .multiply(new Matrix4().makeRotationY(run.rotation[1]))
          .multiply(new Matrix4().makeTranslation(...segment.position))
          .multiply(new Matrix4().makeRotationY(segment.rotation))
        return new Mesh(generateRoofSegmentGeometry(segment).applyMatrix4(matrix))
      })
  })
  const raycaster = new Raycaster()
  raycaster.ray.direction.set(0, -1, 0)
  const exposed: string[] = []

  for (const [index, assembly] of assemblies.entries()) {
    const run = runs[index]!
    const framing = buildLeanToExtensionGeometry(assembly.extension, {} as never)
    framing.applyMatrix4(
      new Matrix4()
        .makeTranslation(...run.position)
        .multiply(new Matrix4().makeRotationY(run.rotation[1])),
    )
    framing.updateMatrixWorld(true)

    for (const member of framing.children.filter(
      (child): child is Mesh<BoxGeometry> =>
        /^lean-to-(?:opposite-)?rafter-\d+$/.test(child.name) || /corner-rafter$/.test(child.name),
    )) {
      const { depth } = member.geometry.parameters as { depth: number }
      for (const z of [-depth * 0.35, 0, depth * 0.35]) {
        const point = member.localToWorld(new Vector3(0, 0, z))
        raycaster.ray.origin.set(point.x, 10, point.z)
        const coverY = Math.max(
          ...roofMeshes.flatMap((roof) =>
            raycaster.intersectObject(roof, false).map((hit) => hit.point.y),
          ),
        )
        if (!Number.isFinite(coverY) || coverY <= point.y) {
          exposed.push(`${index}:${member.name}:${point.x.toFixed(3)}:${point.z.toFixed(3)}`)
        }
      }
    }
  }

  for (const roof of roofMeshes) roof.geometry.dispose()
  return exposed
}

describe('freestanding canopy joint framing', () => {
  test('keeps mono corner framing below an internal turn', () => {
    expect(exposedCornerFraming('mono', -4)).toEqual([])
  })

  test.each([
    'gable',
    'butterfly',
  ] as const)('keeps both %s roof-half framings below either internal turn', (canopyForm) => {
    expect(exposedCornerFraming(canopyForm, -4)).toEqual([])
    expect(exposedCornerFraming(canopyForm, 4)).toEqual([])
  })
})
