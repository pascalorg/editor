import { describe, expect, test } from 'bun:test'
import { type AnyNode, type LeanToExtensionNode, LevelNode } from '@pascal-app/core'
import { generateRoofSegmentGeometry } from '@pascal-app/viewer'
import { Matrix4, Mesh, Quaternion, Raycaster, Vector3 } from 'three'
import { createLeanToAssembly } from './assembly'
import { resolveFreestandingCanopyJoints } from './canopy-joint'
import { resolveLeanToFreestandingRunPlacement } from './placement'

type Point = readonly [number, number]
type CanopyForm = LeanToExtensionNode['canopyForm']

const Y_UP = new Vector3(0, 1, 0)

function segmentWorldMatrix(
  assembly: ReturnType<typeof createLeanToAssembly>,
  segment: ReturnType<typeof createLeanToAssembly>['segment'],
) {
  return new Matrix4()
    .compose(
      new Vector3(...assembly.extension.position),
      new Quaternion().setFromAxisAngle(Y_UP, assembly.extension.rotation[1]),
      new Vector3(1, 1, 1),
    )
    .multiply(
      new Matrix4().compose(
        new Vector3(...assembly.roof.position),
        new Quaternion().setFromAxisAngle(Y_UP, assembly.roof.rotation),
        new Vector3(1, 1, 1),
      ),
    )
    .multiply(
      new Matrix4().compose(
        new Vector3(...segment.position),
        new Quaternion().setFromAxisAngle(Y_UP, segment.rotation),
        new Vector3(1, 1, 1),
      ),
    )
}

function buildRuns(
  name: string,
  points: readonly Point[],
  form: CanopyForm,
  patch: Partial<LeanToExtensionNode> = {},
  flipProjection = false,
) {
  const level = LevelNode.parse({ id: `level_${name}`, level: 0 })
  const runs = points.slice(0, -1).map((start, index) => ({
    ...resolveLeanToFreestandingRunPlacement(
      level.id,
      start,
      points[index + 1]!,
      flipProjection,
      form,
    )!,
    ...patch,
    id: `leanto_${name}_${index}`,
  })) as LeanToExtensionNode[]
  const sourceNodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >
  const assemblies = runs.map((run) => {
    return createLeanToAssembly(run, undefined, sourceNodes)
  })
  const renderNodes = Object.fromEntries(
    [level, ...runs, ...assemblies.flatMap((assembly) => assembly.children)].map((node) => [
      node.id,
      node,
    ]),
  ) as Record<string, AnyNode>
  const geometries = assemblies.flatMap((assembly) =>
    [assembly.segment, assembly.oppositeSegment]
      .filter((segment) => segment !== undefined)
      .map((segment) => {
        const geometry = generateRoofSegmentGeometry(segment, renderNodes)
        geometry.applyMatrix4(segmentWorldMatrix(assembly, segment))
        return geometry
      }),
  )
  return { assemblies, geometries }
}

function separatedTopOverlapCount(geometries: ReturnType<typeof generateRoofSegmentGeometry>[]) {
  const meshes = geometries.map((geometry) => new Mesh(geometry))
  const raycaster = new Raycaster()
  const direction = new Vector3(0, -1, 0)
  const origin = new Vector3()
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
    maxY: -Infinity,
  }
  for (const geometry of geometries) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    bounds.minX = Math.min(bounds.minX, box.min.x)
    bounds.maxX = Math.max(bounds.maxX, box.max.x)
    bounds.minZ = Math.min(bounds.minZ, box.min.z)
    bounds.maxZ = Math.max(bounds.maxZ, box.max.z)
    bounds.maxY = Math.max(bounds.maxY, box.max.y)
  }

  let overlaps = 0
  for (let x = bounds.minX + 0.1; x < bounds.maxX - 0.1; x += 0.1) {
    for (let z = bounds.minZ + 0.1; z < bounds.maxZ - 0.1; z += 0.1) {
      origin.set(x, bounds.maxY + 5, z)
      raycaster.set(origin, direction)
      const topHits = meshes.flatMap((mesh, meshIndex) =>
        raycaster
          .intersectObject(mesh, false)
          .filter((hit) => (hit.face?.normal.y ?? 0) > 0.2)
          .map((hit) => ({ mesh: meshIndex, y: hit.point.y })),
      )
      if (topHits.length < 2 || new Set(topHits.map(({ mesh }) => Math.floor(mesh / 2))).size < 2) {
        continue
      }
      topHits.sort((left, right) => left.y - right.y)
      if (topHits.at(-1)!.y - topHits[0]!.y > 0.02) {
        overlaps++
      }
    }
  }
  return overlaps
}

describe('freestanding canopy rendered-joint regressions', () => {
  for (const form of ['gable', 'butterfly'] as const) {
    test(`${form} L corner has no separated roof overlap`, () => {
      const result = buildRuns(
        `${form}_right_angle`,
        [
          [0, 0],
          [8, 0],
          [8, 8],
        ],
        form,
      )
      expect(separatedTopOverlapCount(result.geometries)).toBe(0)
      for (const geometry of result.geometries) geometry.dispose()
    })
  }

  for (const form of ['mono', 'gable', 'butterfly'] as const) {
    test(`${form} minimum-span 45-degree corner creates finite geometry`, () => {
      const result = buildRuns(
        `${form}_minimum_span`,
        [
          [0, 0],
          [0.5, 0],
          [0.5 + Math.SQRT1_2 * 0.5, Math.SQRT1_2 * 0.5],
        ],
        form,
      )
      for (const geometry of result.geometries) {
        const positions = geometry.getAttribute('position')
        for (let index = 0; index < positions.count; index++) {
          expect(Number.isFinite(positions.getX(index))).toBe(true)
          expect(Number.isFinite(positions.getY(index))).toBe(true)
          expect(Number.isFinite(positions.getZ(index))).toBe(true)
        }
        geometry.dispose()
      }
    })
  }

  test('near-linear mono corner keeps one connected footprint per run', () => {
    const radians = Math.PI / 180
    const result = buildRuns(
      'mono_near_linear',
      [
        [0, 0],
        [8, 0],
        [8 + 8 * Math.cos(radians), 8 * Math.sin(radians)],
      ],
      'mono',
    )
    expect(
      result.assemblies.map((assembly) => assembly.segment.shedFootprintPieces?.length),
    ).toEqual([1, 1])
    for (const geometry of result.geometries) geometry.dispose()
  })

  test('all canopy forms keep finite, non-overlapping roofs across turns and orientations', () => {
    const failures: string[] = []
    for (const form of ['mono', 'gable', 'butterfly'] as const) {
      for (const angle of [1, 2, 5, 15, 30, 45, 60, 75, 89, 90]) {
        for (const turn of [-1, 1]) {
          const radians = (turn * angle * Math.PI) / 180
          const forward: Point[] = [
            [0, 0],
            [8, 0],
            [8 + 8 * Math.cos(radians), 8 * Math.sin(radians)],
          ]
          for (const reverse of [false, true]) {
            for (const flipProjection of [false, true]) {
              const points = reverse ? [...forward].reverse() : forward
              const result = buildRuns(
                `${form}_${angle}_${turn}_${reverse}_${flipProjection}`,
                points,
                form,
                {},
                flipProjection,
              )
              const overlaps = separatedTopOverlapCount(result.geometries)
              if (overlaps > 0) {
                failures.push(
                  `${form} angle=${angle} turn=${turn} reverse=${reverse} flip=${flipProjection} has ${overlaps} separated overlaps`,
                )
              }
              for (const geometry of result.geometries) geometry.dispose()
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  }, 15000)

  test('maximum canopy overhangs keep connected, non-overlapping corner roofs', () => {
    const patch = {
      highOverhang: 1.5,
      leftOverhang: 1.5,
      lowOverhang: 1.5,
      rightOverhang: 1.5,
    }
    for (const form of ['mono', 'gable', 'butterfly'] as const) {
      for (const angle of [5, 45, 90]) {
        const radians = (angle * Math.PI) / 180
        for (const flipProjection of [false, true]) {
          const result = buildRuns(
            `${form}_${angle}_maximum_overhang_${flipProjection}`,
            [
              [0, 0],
              [8, 0],
              [8 + 8 * Math.cos(radians), 8 * Math.sin(radians)],
            ],
            form,
            patch,
            flipProjection,
          )
          const overlaps = separatedTopOverlapCount(result.geometries)
          if (overlaps > 0) {
            throw new Error(
              `${form} angle=${angle} maximum overhang flip=${flipProjection} has ${overlaps} separated overlaps`,
            )
          }
          for (const geometry of result.geometries) geometry.dispose()
        }
      }
    }
  })

  test('canopy parameter boundaries keep finite corner roofs', () => {
    const profiles: Array<{
      name: string
      patch: Partial<LeanToExtensionNode>
      span: number
    }> = [
      { name: 'minimum-span', patch: {}, span: 0.5 },
      { name: 'minimum-projection', patch: { projection: 0.5 }, span: 8 },
      { name: 'maximum-projection', patch: { projection: 10 }, span: 20 },
      { name: 'minimum-pitch', patch: { pitch: 1 }, span: 8 },
      { name: 'maximum-pitch', patch: { pitch: 45 }, span: 8 },
      {
        name: 'minimum-span-maximum-depth',
        patch: { highOverhang: 1.5, lowOverhang: 1.5, projection: 10 },
        span: 0.5,
      },
    ]
    const failures: string[] = []
    for (const form of ['mono', 'gable', 'butterfly'] as const) {
      for (const angle of [5, 45, 90]) {
        const radians = (angle * Math.PI) / 180
        for (const profile of profiles) {
          for (const flipProjection of [false, true]) {
            let result: ReturnType<typeof buildRuns>
            try {
              result = buildRuns(
                `${form}_${angle}_${profile.name}_${flipProjection}`,
                [
                  [0, 0],
                  [profile.span, 0],
                  [
                    profile.span + profile.span * Math.cos(radians),
                    profile.span * Math.sin(radians),
                  ],
                ],
                form,
                profile.patch,
                flipProjection,
              )
            } catch {
              failures.push(
                `${form} angle=${angle} profile=${profile.name} flip=${flipProjection} throws during assembly`,
              )
              continue
            }
            for (const geometry of result.geometries) {
              const positions = geometry.getAttribute('position')
              for (let index = 0; index < positions.count; index++) {
                if (
                  !Number.isFinite(positions.getX(index)) ||
                  !Number.isFinite(positions.getY(index)) ||
                  !Number.isFinite(positions.getZ(index))
                ) {
                  failures.push(
                    `${form} angle=${angle} profile=${profile.name} flip=${flipProjection} has non-finite geometry`,
                  )
                  break
                }
              }
              geometry.dispose()
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  }, 15000)

  test('exact minimum diagonal spans remain placeable', () => {
    const level = LevelNode.parse({ id: 'level_exact_minimum_diagonal', level: 0 })
    const end: Point = [Math.SQRT1_2 * 0.5, Math.SQRT1_2 * 0.5]
    expect(
      resolveLeanToFreestandingRunPlacement(level.id, [0, 0], end, false, 'mono'),
    ).not.toBeNull()
  })

  test('a shared endpoint never creates a one-sided three-way joint', () => {
    const level = LevelNode.parse({ id: 'level_three_way_canopy', level: 0 })
    const endpoints: Point[] = [
      [8, 0],
      [-4, 7],
      [-4, -7],
    ]
    const runs = endpoints.map((end, index) => ({
      ...resolveLeanToFreestandingRunPlacement(level.id, [0, 0], end, false, 'gable')!,
      id: `leanto_three_way_${index}`,
    })) as LeanToExtensionNode[]
    const nodes = Object.fromEntries([level, ...runs].map((node) => [node.id, node])) as Record<
      string,
      AnyNode
    >
    const resolved = Object.fromEntries(
      runs.map((run) => [run.id, resolveFreestandingCanopyJoints(run, nodes)]),
    )

    for (const [runId, joints] of Object.entries(resolved)) {
      for (const joint of Object.values(joints)) {
        if (!joint) continue
        expect(
          Object.values(resolved[joint.neighborId]!).some(
            (neighborJoint) => neighborJoint?.neighborId === runId,
          ),
        ).toBe(true)
      }
    }
  })
})
