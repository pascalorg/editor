import { describe, expect, test } from 'bun:test'
import { authorScenePayload } from '../agent-tools/author-scene'
import { authorSceneChecks } from './index'

const wall = (id: string, openings: unknown[] = []) => ({
  id,
  start: [0, 0],
  end: [4, 0],
  height: 2.7,
  thickness: 0.2,
  openings,
})
const SASH_NO_CLIP = `export default function build({ THREE }) { const m = new THREE.MeshStandardMaterial(); m.name = 'glass'; return new THREE.Group() }`
const OPAQUE_WITH_CLIP = `export default function build({ THREE }) { const g = new THREE.Group(); g.animations = [new THREE.AnimationClip('open', 1, [track])]; return g }`

const checksOf = (
  levels: unknown[],
  issues: { type: string; message: string }[] = [],
  defects: { id: string; code: string; message: string }[] = [],
) =>
  Object.fromEntries(
    authorSceneChecks({
      payload: authorScenePayload.parse({ levels }),
      report: { defects, warnings: [], ids: {} },
      pending: [],
      issues,
    }).map((check) => [check.id, check]),
  )

describe('authorSceneChecks', () => {
  test('a clean conversion passes every check', () => {
    const checks = checksOf([
      {
        name: 'Ground floor',
        walls: [wall('a', [{ kind: 'window', along: 2, width: 1, height: 1, type: 'casement' }])],
        rooms: [{ name: 'Room', seed: [2, 1] }],
      },
    ])
    expect(Object.values(checks).filter((check) => !check.passed)).toEqual([])
  })

  test('names what fails: an opening that does not move, opaque glazing, debris, a buried slab, a stair, an empty level', () => {
    const tufts = Array.from({ length: 30 }, (_, i) => ({
      id: `tuft${i}`,
      name: `Grass tuft ${i}`,
      category: 'plant',
      code: 'export default function build({ THREE }) { return new THREE.Group() }',
      position: [i, 0, 5],
    }))
    const checks = checksOf(
      [
        {
          name: 'Ground floor',
          walls: [
            wall('a', [
              {
                kind: 'window',
                along: 1,
                width: 1,
                height: 1,
                type: 'casement',
                code: SASH_NO_CLIP,
              },
              {
                kind: 'window',
                along: 3,
                width: 1,
                height: 1,
                type: 'casement',
                code: OPAQUE_WITH_CLIP,
              },
            ]),
          ],
          rooms: [{ name: 'Room', seed: [2, 1] }],
          slabs: [
            {
              name: 'Footing',
              polygon: [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
              top: -0.6,
              thickness: 0.3,
            },
          ],
          items: tufts,
        },
        { name: 'Garden and foundation', elevation: -0.5 },
      ],
      [
        {
          type: 'stair_arrival_blocked',
          message: 'Wall w2 on First floor crosses the top of stair S',
        },
      ],
    )
    expect(checks.openings!.passed).toBe(false)
    expect(checks.openings!.detail).toContain('a/0')
    expect(checks.glass!.detail).toContain('a/1')
    expect(checks.outside!.detail).toContain('30 items are one thing')
    expect(checks.outside!.detail).toContain('Footing (level 0, top -0.6 m) is buried')
    expect(checks.stairs!.detail).toBe('Wall w2 on First floor crosses the top of stair S')
    expect(checks.levels!.detail).toContain('"Garden and foundation" holds no rooms or walls')
  })
})
