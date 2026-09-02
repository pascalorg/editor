import { describe, expect, test } from 'bun:test'
import type { InstancedMesh, Material, MeshStandardMaterial } from 'three'
import type { Fixture, Member, MemberMaterial, MemberRole } from '../core/types'
import { baselineConfig, baselineScene } from './baseline-scene'
import { computeLevel } from './compute'
import { throttleTrailing } from './live'
import {
  buildGroups,
  disposeGroup,
  materialCensus,
  patchGroups,
} from './renderer'

/**
 * NIGHT-8 PERFORMANCE GATES (headless QA round on master 75591f9):
 *
 *  F1 — buildGroup minted ~347 fresh MeshStandardMaterials per compose; on
 *       the host's WebGPU/TSL pipeline every fresh material is a node-graph
 *       build + program compile: ~29s softGL (~2.6s pure JS) per X-ray /
 *       Basement toggle. Gate: material IDENTITY — same (color, variant) →
 *       the SAME object reference across rebuilds; census pinned.
 *  F2 — the move-tool ghost preview paid a full group+material rebuild per
 *       throttle tick (~2.4s JS per cursor step, 19.3s across 8 steps).
 *       Gates: the recompute-throttle counter (a pointermove storm collapses
 *       to ≤ ceil(span/wait)+1 recomputes) and the in-place patch path
 *       (same bucket structure → same meshes, matrices rewritten in place).
 *  F3 — +2.9MB GC-resistant heap per X-ray toggle pair + 1229 'bindTexture:
 *       attempt to use a deleted object' warnings from disposing shared
 *       resources. Gate: a create/destroy ×10 loop keeps the material
 *       census flat and never fires a dispose event on a cached material
 *       or the shared unit-box geometry.
 */

const ROLES: MemberRole[] = [
  'bottom-plate', 'top-plate', 'stud', 'king-stud', 'trimmer', 'header',
  'sill', 'cripple', 'joist', 'girder', 'rafter', 'ridge', 'footing',
  'slab', 'pipe-run', 'duct-run', 'wire-run', 'rebar',
]
const MATERIALS: MemberMaterial[] = [
  'lumber', 'pt-lumber', 'engineered', 'concrete', 'steel', 'pvc', 'copper', 'duct',
]

function synthesizeMembers(count: number): Member[] {
  const members: Member[] = []
  for (let i = 0; i < count; i++) {
    members.push({
      system: 'wall-framing',
      role: ROLES[i % ROLES.length] as MemberRole,
      dims: [0.04, 2, 0.09],
      length: 2,
      position: [i * 0.1, 1, 0],
      rotation: [0, (i % 8) * (Math.PI / 4), 0],
      material: MATERIALS[i % MATERIALS.length] as MemberMaterial,
      sourceId: `w${i % 10}`,
    })
  }
  return members
}

const FIXTURES: Fixture[] = [
  { system: 'electrical', kind: 'receptacle', position: [1, 0.4, 0], rotationY: 0, sourceId: 'w1' },
  { system: 'electrical', kind: 'switch', position: [2, 1.2, 0], rotationY: 0, sourceId: 'w2' },
  { system: 'plumbing', kind: 'cleanout', position: [1, -0.2, 0], rotationY: 0, sourceId: 'dwv' },
]

type Built = ReturnType<typeof buildGroups>
const allMeshes = (built: Built): InstancedMesh[] => {
  const out = [...built.group.children] as InstancedMesh[]
  for (const g of built.foreign.values()) out.push(...(g.children as InstancedMesh[]))
  return out
}
const uniqueMaterials = (built: Built): Set<Material> =>
  new Set(allMeshes(built).map((m) => m.material as Material))

describe('F1 — stable material identity across rebuilds', () => {
  test('same input, two consecutive builds: every mesh material is the SAME object reference', () => {
    const members = synthesizeMembers(500)
    for (const mode of ['xray', 'basement', 'off'] as const) {
      const a = buildGroups(members, FIXTURES, mode)
      const b = buildGroups(members, FIXTURES, mode)
      const am = allMeshes(a)
      const bm = allMeshes(b)
      expect(am.length).toBe(bm.length)
      expect(am.length).toBeGreaterThan(0)
      for (let i = 0; i < am.length; i++) {
        expect(bm[i]?.material).toBe(am[i]?.material as MeshStandardMaterial)
      }
      disposeGroup(a.group)
      disposeGroup(b.group)
    }
  })

  test('every mesh shares ONE module-lifetime unit-box geometry — across buckets AND builds', () => {
    const a = buildGroups(synthesizeMembers(100), FIXTURES, 'basement')
    const b = buildGroups(synthesizeMembers(100), FIXTURES, 'xray')
    const geometries = new Set([...allMeshes(a), ...allMeshes(b)].map((m) => m.geometry))
    expect(geometries.size).toBe(1)
    disposeGroup(a.group)
    disposeGroup(b.group)
  })

  test('census pin — baseline compose: 38 unique materials in X-ray (was ~347 fresh mints), 51 basement, 8 off; rebuilds add ZERO', () => {
    const result = computeLevel(baselineScene(), baselineConfig('INTL'))
    expect(result.members.length).toBeGreaterThan(500) // the compose is real
    const counts: Record<string, number> = {}
    for (const mode of ['xray', 'basement', 'off'] as const) {
      counts[mode] = uniqueMaterials(buildGroups(result.members, result.fixtures, mode)).size
    }
    // The true distinct-(color, variant) counts for the baseline house —
    // O(palette), never O(buckets × rebuilds). Recalibrate ONLY when the
    // palette or the compose content legitimately changes.
    expect(counts.xray).toBe(38)
    expect(counts.basement).toBe(51)
    expect(counts.off).toBe(8)
    // Identity, not equality: rebuilding every mode adds nothing to the cache.
    const census = materialCensus()
    for (const mode of ['xray', 'basement', 'off'] as const) {
      buildGroups(result.members, result.fixtures, mode)
    }
    expect(materialCensus()).toBe(census)
  })
})

describe('F3 — disposal: create/destroy ×10 holds the census flat, shared resources never disposed', () => {
  test('10 build/dispose cycles: census flat, zero dispose events on cached materials + shared geometry', () => {
    const members = synthesizeMembers(300)
    const seed = buildGroups(members, FIXTURES, 'basement')
    const watched = uniqueMaterials(seed)
    expect(watched.size).toBeGreaterThan(5)
    let disposeEvents = 0
    const onDispose = () => {
      disposeEvents++
    }
    for (const m of watched) m.addEventListener('dispose', onDispose)
    const geometry = (allMeshes(seed)[0] as InstancedMesh).geometry
    geometry.addEventListener('dispose', onDispose)
    disposeGroup(seed.group)
    for (const g of seed.foreign.values()) disposeGroup(g)

    const census = materialCensus()
    for (let i = 0; i < 10; i++) {
      const built = buildGroups(members, FIXTURES, 'basement')
      // the rebuild REUSES the watched materials (identity, not lookalikes)
      for (const mat of uniqueMaterials(built)) expect(watched.has(mat)).toBe(true)
      disposeGroup(built.group)
      for (const g of built.foreign.values()) disposeGroup(g)
    }
    expect(materialCensus()).toBe(census) // flat — no per-cycle minting
    expect(disposeEvents).toBe(0) // shared material/geometry never torn down
    for (const m of watched) m.removeEventListener('dispose', onDispose)
    geometry.removeEventListener('dispose', onDispose)
  })
})

describe('F2 — the in-place patch path (cheap common path for drag previews)', () => {
  test('a same-structure move patches in place: same mesh objects, matrices match a fresh build', () => {
    const members = synthesizeMembers(400)
    const built = buildGroups(members, FIXTURES, 'xray')
    const meshesBefore = allMeshes(built)
    // needsUpdate is a write-only setter in three (it bumps `version`) —
    // snapshot versions to prove the patch flags the GPU upload.
    const versionsBefore = meshesBefore.map((m) => m.instanceMatrix.version)
    // the drag: every member slides 0.37m along x (structure unchanged)
    const moved = members.map((m) => ({
      ...m,
      position: [m.position[0] + 0.37, m.position[1], m.position[2]] as const,
    }))
    expect(patchGroups(built, moved, FIXTURES, 'xray')).toBe(true)
    const meshesAfter = allMeshes(built)
    expect(meshesAfter.length).toBe(meshesBefore.length)
    for (let i = 0; i < meshesAfter.length; i++) {
      expect(meshesAfter[i]).toBe(meshesBefore[i] as InstancedMesh) // no mesh churn
      // GPU upload flagged: version bumped past the build-time write
      expect(meshesAfter[i]?.instanceMatrix.version).toBeGreaterThan(
        versionsBefore[i] as number,
      )
    }
    // ground truth: the patched matrices equal a from-scratch build's
    const fresh = buildGroups(moved, FIXTURES, 'xray')
    const freshMeshes = allMeshes(fresh)
    expect(freshMeshes.length).toBe(meshesAfter.length)
    for (let i = 0; i < freshMeshes.length; i++) {
      const a = meshesAfter[i] as InstancedMesh
      const f = freshMeshes[i] as InstancedMesh
      expect(a.count).toBe(f.count)
      expect([...a.instanceMatrix.array]).toEqual([...f.instanceMatrix.array])
    }
    disposeGroup(built.group)
    disposeGroup(fresh.group)
  })

  test('structural changes refuse the patch: count drift, new bucket, mode flip', () => {
    const members = synthesizeMembers(200)
    const built = buildGroups(members, FIXTURES, 'xray')
    // a member disappeared → some bucket's count shrank
    expect(patchGroups(built, members.slice(0, -1), FIXTURES, 'xray')).toBe(false)
    // an assembly layer appeared → new face-bucket key
    const withFace = [
      ...members,
      { ...(members[0] as Member), role: 'drywall' as const, face: [0, 1] as const },
    ]
    expect(patchGroups(built, withFace, FIXTURES, 'xray')).toBe(false)
    // view mode flipped → different treatment keys, never patched
    expect(patchGroups(built, members, FIXTURES, 'basement')).toBe(false)
    disposeGroup(built.group)
  })

  test('foreign level groups: same structure patches; level-set or stratum-tag drift rebuilds', () => {
    const stud = synthesizeMembers(1)[0] as Member
    const rafter: Member = {
      ...stud,
      system: 'roof-framing',
      role: 'rafter',
      levelId: 'lvlroof',
      strataAbove: true,
    }
    const built = buildGroups([stud, rafter], [], 'xray')
    expect(built.foreign.size).toBe(1)
    // slide both — structure identical → in-place
    const slide = (m: Member): Member => ({
      ...m,
      position: [m.position[0] + 1, m.position[1], m.position[2]],
    })
    expect(patchGroups(built, [slide(stud), slide(rafter)], [], 'xray')).toBe(true)
    // a second foreign level appears → rebuild
    const porch: Member = { ...stud, sourceId: 'porch', levelId: 'lvl0' }
    expect(patchGroups(built, [stud, rafter, porch], [], 'xray')).toBe(false)
    // the stratum tag flips (exploded-offset semantics) → rebuild
    expect(
      patchGroups(built, [stud, { ...rafter, strataAbove: undefined }], [], 'xray'),
    ).toBe(false)
    disposeGroup(built.group)
    for (const g of built.foreign.values()) disposeGroup(g)
  })

  test('recompute-throttle counter: a pointermove storm collapses to ≤ ceil(span/wait)+1 recomputes', async () => {
    // The renderer's live path throttles at 100ms trailing (~10Hz preview).
    // Storm ~95 synthetic pointermoves over ~950ms: the counter must stay
    // within the contract bound — leading edge + one per 100ms window + the
    // trailing call that lands the final position.
    let recomputes = 0
    const throttled = throttleTrailing(() => {
      recomputes++
    }, 100)
    const t0 = Date.now()
    while (Date.now() - t0 < 950) {
      throttled.run()
      await new Promise((r) => setTimeout(r, 10))
    }
    await new Promise((r) => setTimeout(r, 150)) // let the trailing edge land
    throttled.cancel()
    expect(recomputes).toBeLessThanOrEqual(11) // ceil(1000ms / 100ms) + 1
    expect(recomputes).toBeGreaterThanOrEqual(5) // non-vacuous: the storm really ran
  })
})
