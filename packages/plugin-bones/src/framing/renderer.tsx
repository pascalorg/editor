'use client'

import {
  pauseSceneHistory,
  resumeSceneHistory,
  sceneRegistry,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three'
import type { Fixture, Member } from '../core/types'
import { inches } from '../core/units'
import { reconcileDeviceNodes } from '../device/place'
import { circuitColor, hvacDuctColor, plumbingPipeColor } from '../plans/circuit-colors'
import { normalizeServiceAnchors } from '../service/normalize'
import { planServiceSeeding } from '../service/place'
import { computeLevel } from './compute'
import {
  condenserAssetSnapshot,
  isCondenserCabinet,
  loadCondenserAsset,
  prepareCondenserClone,
} from './condenser-asset'
import { effectiveNodesFor, throttleTrailing } from './live'
import { effectiveViewMode, type FramingNode, type ViewMode } from './schema'

/**
 * The X-ray renderer: derives every member for this node's level and draws
 * them as one InstancedMesh per color bucket — a whole house is a handful of
 * draw calls. Nothing here is persisted; edit a wall and the skeleton
 * recomputes on the spot.
 */

/** Color buckets — material first, with structural roles popped for reading. */
export function colorOf(member: Member): string {
  // Wires color by CIRCUIT (sourceId carries the circuit id) so a run reads
  // as its zone in the building exactly like on the exported plan.
  if (member.system === 'electrical' && member.role === 'wire-run') {
    return circuitColor(member.sourceId)
  }
  // Plumbing runs color by SYSTEM (sourceId prefix): cold blue, hot red,
  // DWV slate — identical to the exported MEP sheet. The room-category
  // fallback's room-sourced runs keep their material colors below. HVAC
  // refrigerant line-sets join the same convention (suction cold-blue,
  // liquid warm-red); hvac condensate keeps its material color (null).
  if (
    (member.system === 'plumbing' || member.system === 'hvac') &&
    member.role === 'pipe-run'
  ) {
    const pipe = plumbingPipeColor(member.sourceId)
    if (pipe) return pipe
  }
  // RETURN-air duct reads darker than supply tin (B19c) — same 3D/paper
  // contract as the circuit and plumbing colors.
  if (member.system === 'hvac' && member.role === 'duct-run') {
    const tone = hvacDuctColor(member.sourceId)
    if (tone) return tone
  }
  switch (member.role) {
    case 'drywall':
      return '#ece7de'
    case 'sheathing':
      return '#c8a262'
    case 'wrb':
      return '#4f7d8c'
    case 'cladding': {
      // Distinct per-family colors so the Engineering panel's finish choice
      // reads in the X-ray (user report: stucco vs vinyl looked identical).
      const l = (member.label ?? '').toLowerCase()
      if (l.includes('brick')) return '#9e4a3a'
      if (l.includes('stucco') || l.includes('plaster')) return '#d6cdb8'
      if (l.includes('vinyl')) return '#b9c6d1'
      if (l.includes('fiber cement')) return '#a9b3a4'
      if (l.includes('wood')) return '#a67848'
      if (l.includes('eps') || l.includes('base coat') || l.includes('finish')) return '#e3dccb'
      return '#aebfc7'
    }
    case 'insulation':
      return '#e8b4c8' // pink batts (board spec, full wall engineering panel)
    default:
      break
  }
  switch (member.material) {
    case 'concrete':
      return '#9aa0a5'
    case 'pt-lumber':
      return '#7d9d6a'
    case 'steel':
      return '#8b8f96'
    case 'engineered':
      return '#c39b5e'
    case 'pvc':
      return '#e9e7df'
    case 'copper':
      return '#b0723d'
    case 'duct':
      return '#aab3bb'
    default:
      break
  }
  switch (member.role) {
    case 'rebar':
      return '#8a4b2a'
    case 'wire-run':
      return '#e6c84a'
    case 'header':
      return '#c1904f'
    case 'king-stud':
    case 'trimmer':
      return '#cfa269'
    default:
      return '#dbb98b'
  }
}

const FIXTURE_COLORS: Record<string, string> = {
  'exhaust-fan': '#9fb8c8',
  receptacle: '#f2b63d',
  'receptacle-gfci': '#e88f2a',
  'receptacle-wr-gfci': '#c96a2e',
  switch: '#7fb3e0',
  light: '#f5e08a',
  'smoke-alarm': '#e06c6c',
  'co-alarm': '#e0a34f',
  panel: '#8f8f8f',
}

/** Fixtures render as small instanced boxes (device-box scale). */
function fixtureBox(fixture: Fixture): { dims: [number, number, number]; color: string } {
  const color = FIXTURE_COLORS[fixture.kind] ?? '#f2b63d'
  if (fixture.kind === 'panel') return { dims: [inches(14), inches(30), inches(4)], color }
  if (fixture.kind === 'light') return { dims: [inches(6), inches(1.5), inches(6)], color }
  return { dims: [inches(3), inches(4.5), inches(2.5)], color }
}

/**
 * Below-floor stratum predicate (user round 2026-08-20: "I shouldn't be able
 * to see the crawl space at all [in X-ray]" + the dedicated basement mode).
 * System-based for the two systems that live under the floor plane by
 * definition — foundation (footings, stemwalls, slab, vapor, anchor bolts,
 * rebar) and floor-framing (joists/girders under the subfloor — the
 * crawl-space ceiling) — plus a y-extent rule for buried runs of any other
 * system: top of the box below the floor line (same 0.02 m tolerance the old
 * buried-DWV ghost used). Everything at or above grade stays 'above': an
 * outdoor condenser pad (hvac, sitting ON grade) is outside, not under the
 * house.
 */
export const BURIED_TOP_Y = 0.02
export function isBelowFloor(member: Member): boolean {
  if (member.system === 'foundation' || member.system === 'floor-framing') return true
  return member.position[1] + member.dims[1] / 2 < BURIED_TOP_Y
}

/**
 * Fixture kinds a FINISHED house shows (viewMode 'off'): the wall/ceiling
 * surface devices — outlet & switch plates, lights, smoke alarms, the
 * panel's door face, thermostat, registers/returns, exhaust fans — and the
 * standing appliances/meters (water heater, air handler, meters, condenser
 * disconnect). Rough-in-only kinds hide: stub-outs (in-wall), cleanouts and
 * the vent-stack marker read as construction, not as a finished surface.
 */
const SURFACE_FIXTURE_KINDS: ReadonlySet<Fixture['kind']> = new Set([
  'receptacle',
  'receptacle-gfci',
  'receptacle-wr-gfci', // outdoor WR box behind its in-use cover IS the finished surface
  'switch',
  'light',
  'smoke-alarm',
  'co-alarm', // B13: a CO alarm is a visible ceiling device like a smoke alarm
  'panel',
  'thermostat',
  'register',
  'return',
  'exhaust-fan',
  'water-heater',
  'equipment',
  'water-meter',
  'electric-meter',
  'disconnect',
] as Fixture['kind'][])

/** Basement mode: below-floor overlay strength — near-solid so foundation /
 * drainage / buried pipes read crisply through the floor and the shell. */
export const BELOW_GHOST_OPACITY = 0.9
/** Basement mode: the slab/vapor PLANE FIELDS' overlay strength — reduced
 * (still clearly concrete) and depth-silent, so the under-slab drainage
 * network reads THROUGH the slab field instead of only peeking out at the
 * edges (browser QA round 3: 'you get to see what's under your house…
 * the drainage' was only partially met with the field at 0.9). */
export const SLAB_FIELD_OPACITY = 0.5
/** Basement mode: buried MEP runs draw AFTER the slab field in the overlay
 * pass (renderOrder beats transparent distance-sorting), so with the field
 * writing no depth the network composites crisply on top of it. */
export const THROUGH_RENDER_ORDER = 1
/** Basement mode: the above-floor house shell — barely visible, enough to
 * orient ("super transparent on top" — user round 2026-08-20). */
export const FAINT_OPACITY = 0.08

/** Per-bucket render treatment (derived from view mode + stratum):
 * 'solid' one opaque depth-tested mesh; 'faint' one barely-visible
 * transparent mesh (basement's above-floor orientation shell); and the
 * three below-floor basement variants, all opaque-solid on the scene layer
 * plus an overlay copy that differs per class:
 *  - 'ghosted'         structural stratum (footings, stemwalls, joists…):
 *                      strong (0.9), depth-writing, renderOrder 0;
 *  - 'ghosted-field'   the slab / vapor plane fields: reduced opacity,
 *                      depthWrite OFF, renderOrder 0 — a translucent
 *                      concrete veil that can never hide what's under it;
 *  - 'ghosted-through' buried MEP runs + their fixtures (the drainage
 *                      network, cleanout risers): strong, depth-writing
 *                      (self-occlusion stays physical), renderOrder 1 —
 *                      drawn after the field, reading through it. */
type BucketTreatment = 'solid' | 'ghosted' | 'ghosted-field' | 'ghosted-through' | 'faint'

type Bucket = {
  color: string
  /** Source wall id for face-carrying buckets — the per-wall cut key
   * (each wall classifies near/far against its OWN plane). */
  sourceId?: string
  entries: {
    dims: readonly [number, number, number]
    position: readonly [number, number, number]
    rotation: readonly [number, number, number]
  }[]
  /** Assembly-layer face normal — the dollhouse cut hides camera-facing buckets. */
  face?: readonly [number, number]
  treatment: BucketTreatment
}

/**
 * STABLE MATERIAL IDENTITY (night-8 perf, F1): buildGroup used to mint a
 * fresh MeshStandardMaterial per bucket per rebuild — ~347 unique material
 * instances per compose. Under the host's WebGPU/TSL pipeline every fresh
 * material is a full node-graph build + shader program compile, so each
 * X-ray/Basement toggle (and every live-drag preview tick!) paid seconds of
 * pure JS before the first pixel. A bucket material is fully determined by
 * (color, render variant) — cache them at module level and every rebuild
 * reuses the SAME object, so the renderer's program/pipeline caches hit.
 *
 * Consequences the disposal path must honor (F3): cached materials are
 * SHARED across live groups and across rebuilds — never dispose them on
 * group teardown (disposing shared materials freed textures other meshes
 * still bind: 1229 'bindTexture: attempt to use a deleted object' warnings
 * + ~2.9MB GC-resistant heap per toggle pair in the QA round).
 *
 * The cache is bounded by construction: colors come from the fixed palettes
 * above (colorOf / FIXTURE_COLORS / circuit + pipe + duct tables) × four
 * variants — dozens of entries for the life of the module, not a leak.
 */
type MaterialVariant = 'solid' | 'faint' | 'ghost' | 'ghost-field'

const materialCache = new Map<string, MeshStandardMaterial>()

export function acquireBucketMaterial(
  color: string,
  variant: MaterialVariant,
): MeshStandardMaterial {
  const key = `${color}|${variant}`
  let material = materialCache.get(key)
  if (!material) {
    switch (variant) {
      case 'solid':
        material = new MeshStandardMaterial({ color, roughness: 0.82 })
        break
      case 'faint':
        material = new MeshStandardMaterial({
          color,
          roughness: 0.82,
          transparent: true,
          opacity: FAINT_OPACITY,
          depthWrite: false,
        })
        break
      case 'ghost-field':
        // The slab/vapor veil: translucent AND depth-silent — a depth-writing
        // slab hid the whole under-slab drainage run in the overlay pass.
        material = new MeshStandardMaterial({
          color,
          roughness: 0.82,
          transparent: true,
          opacity: SLAB_FIELD_OPACITY,
          depthWrite: false,
        })
        break
      case 'ghost':
        // Self-occlusion inside the overlay pass needs the depth write that
        // transparent materials normally skip.
        material = new MeshStandardMaterial({
          color,
          roughness: 0.82,
          transparent: true,
          opacity: BELOW_GHOST_OPACITY,
          depthWrite: true,
        })
        break
    }
    materialCache.set(key, material)
  }
  return material
}

/** Census hook for the identity/disposal gates: cache size = the TRUE
 * distinct-(color, variant) count — flat across rebuilds by construction. */
export function materialCensus(): number {
  return materialCache.size
}

/** One shared unit-box geometry for every instanced bucket ever built —
 * module-lifetime, never disposed. The per-group box bought nothing (the
 * instance transforms carry all shape) and its dispose/recreate churn was
 * one more per-rebuild GPU re-upload. */
const UNIT_BOX = new BoxGeometry(1, 1, 1)

/** Main group (the node's own level) + one group per FOREIGN source level
 * (cross-level roofs). Foreign groups hold level-LOCAL geometry and get
 * mounted into that level's Object3D by the renderer so the host's
 * stacked / exploded / solo level transforms apply natively. */
export type BuiltGroups = { group: Group; foreign: Map<string, Group> }

/** bucket key → the bucket's mesh set (solid [+ overlay ghost]) for every
 * live built group — the in-place patch path (F2) looks meshes up by key
 * instead of rebuilding. WeakMap: dies with the group, no teardown needed. */
const bucketIndex = new WeakMap<Group, Map<string, InstancedMesh[]>>()

/** Scratch objects for matrix composition — module-level singletons (the
 * renderer is single-threaded; buildGroup/patchGroup never re-enter). */
const scratchMatrix = new Matrix4()
const scratchQuaternion = new Quaternion()
const scratchScale = new Vector3()
const scratchTranslation = new Vector3()
const scratchEuler = new Euler()

/** Compose one entry's instance matrix (position, rotation, scale = dims,
 * with the same degenerate-dim clamp the buckets always used). Shared by
 * the box buckets AND the condenser-asset wrappers, so the asset sits at
 * the EXACT matrix its box would — parity by construction. */
export function composeEntryMatrix(
  dims: readonly [number, number, number],
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  out: Matrix4,
): Matrix4 {
  scratchEuler.set(rotation[0], rotation[1], rotation[2])
  scratchQuaternion.setFromEuler(scratchEuler)
  scratchTranslation.set(position[0], position[1], position[2])
  scratchScale.set(
    Math.max(dims[0], 0.001),
    Math.max(dims[1], 0.001),
    Math.max(dims[2], 0.001),
  )
  return out.compose(scratchTranslation, scratchQuaternion, scratchScale)
}

/** Write a bucket's instance matrices into its mesh set (solid + ghost copy
 * share indices) and flag the GPU upload. */
function writeMatrices(bucket: Bucket, meshes: InstancedMesh[]) {
  bucket.entries.forEach((entry, i) => {
    composeEntryMatrix(entry.dims, entry.position, entry.rotation, scratchMatrix)
    for (const mesh of meshes) mesh.setMatrixAt(i, scratchMatrix)
  })
  for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true
}

/**
 * AC-BLOCK VISUAL SWAP (user ask 2026-08-22: the outdoor condenser "is
 * actually a heatpump" — render the host's 'AC block' asset, keep the
 * label). X-ray-only member partition: with a LOADED asset, condenser
 * cabinet members (isCondenserCabinet) leave the box buckets and render as
 * per-member asset wrappers below; without one (headless tests, missing
 * asset, load failure) or in any other mode ('off' draws no members at
 * all; 'basement' keeps its faint shell abstract) every member stays a box
 * exactly as before — the swap is a progressive enhancement, never a hole.
 * The MEMBER itself is untouched everywhere (SAT, plans, takeoff, panel —
 * its 'AC condenser #N …' label keeps surfacing there unchanged); only
 * this renderer trades the cabinet's box for the model. Pad, disconnect,
 * whip and line-set render as before.
 */
function splitAssetMembers(
  members: Member[],
  mode: ViewMode,
  condenserAsset: Object3D | null | undefined,
): { boxed: Member[]; condensers: Member[] } {
  if (!condenserAsset || mode !== 'xray') return { boxed: members, condensers: [] }
  const condensers = members.filter(isCondenserCabinet)
  if (condensers.length === 0) return { boxed: members, condensers }
  return { boxed: members.filter((m) => !isCondenserCabinet(m)), condensers }
}

/** Condenser-asset wrapper groups per built group, in cabinet-member order —
 * the patch path rewrites their matrices exactly like bucket instances.
 * WeakMap like bucketIndex: dies with the group, no teardown needed (the
 * wrappers' geometry is SHARED with the module-cached asset and their one
 * material is the module-cached schematic tint — neither may ever be
 * disposed; disposeGroup only frees InstancedMesh state). */
const assetWrapperIndex = new WeakMap<Group, Group[]>()

/** Mount one asset wrapper per cabinet member onto the group. The wrapper
 * takes the box's exact instance matrix (matrixAutoUpdate off — the matrix
 * IS the source of truth, patch rewrites it in place); the clone inside is
 * normalized to a unit cube, so the model fills precisely the volume the
 * box occupied. Clones share geometry with the cached asset, wear the
 * shared schematic equipment-gray tint (condenser-asset.ts — never the
 * GLB's authored red) and follow the X-ray mesh conventions (no-op
 * raycast, shadow flags). */
function attachCondenserAssets(
  group: Group,
  condensers: Member[],
  condenserAsset: Object3D,
): void {
  if (condensers.length === 0) return
  const wrappers = condensers.map((member) => {
    const wrapper = new Group()
    wrapper.add(prepareCondenserClone(condenserAsset))
    wrapper.matrixAutoUpdate = false
    composeEntryMatrix(member.dims, member.position, member.rotation, wrapper.matrix)
    wrapper.matrixWorldNeedsUpdate = true
    group.add(wrapper)
    return wrapper
  })
  assetWrapperIndex.set(group, wrappers)
}

export function buildGroups(
  members: Member[],
  fixtures: Fixture[],
  mode: ViewMode,
  condenserAsset?: Object3D | null,
): BuiltGroups {
  const foreign = new Map<string, Group>()
  const own: Member[] = []
  const byLevel = new Map<string, Member[]>()
  for (const m of members) {
    // mountLevelId = render-only mount (own-level roof strata); the sheets
    // never lift it — only the renderer groups on it.
    const mount = m.levelId ?? m.mountLevelId
    if (mount) {
      const list = byLevel.get(mount) ?? []
      list.push(m)
      byLevel.set(mount, list)
    } else own.push(m)
  }
  const group = buildGroup(own, fixtures, mode, condenserAsset)
  for (const [levelId, list] of byLevel) {
    const g = buildGroup(list, [], mode, condenserAsset)
    g.name = `bones-foreign-${levelId}`
    // Source level strictly ABOVE the owner (compute tags the members) —
    // only these groups take the exploded roof stratum drop below.
    g.userData.strataAbove = list.some((m) => m.strataAbove === true)
    foreign.set(levelId, g)
  }
  return { group, foreign }
}

/**
 * Per-mode member/fixture treatment (user round 2026-08-20 — the OFF /
 * X-RAY / BASEMENT tri-state):
 *
 *  - 'off' — the FINISHED house. NO members at all: framing, wires, pipes,
 *    ducts and foundation live inside walls/floors and a finished home
 *    shows none of them (the host's own skins are the walls — also kills
 *    the old drywall-face z-fight). Only the finished-SURFACE fixtures
 *    render: outlet/switch plates, lights, smoke alarms, the panel face…
 *    (SURFACE_FIXTURE_KINDS), so the level still reads like a real home.
 *  - 'xray' — the engineering X-ray: assembly layers + the dollhouse cut as
 *    before, but the BELOW-FLOOR stratum (isBelowFloor) is depth-tested
 *    only — the old foundation/buried-DWV overlay ghosts are GONE, so the
 *    crawl space no longer reads through the floor ("I shouldn't be able
 *    to see it at all"); it is still visible via real sightlines from
 *    outside/under. This retires the 2026-08-16 'crawl-space at a glance'
 *    ghosts in favor of the dedicated basement mode.
 *  - 'basement' — under the house: below-floor members render fully (solid
 *    scene copy) PLUS an overlay copy so foundation/drainage read through
 *    the floor and the shell from any angle; everything above the floor
 *    collapses to a barely-visible transparent shell (FAINT_OPACITY) for
 *    orientation only. No dollhouse cull (the shell is already faint).
 *    Within the stratum (browser QA round 3: the DWV network must read
 *    THROUGH the slab, not just at its edges): slab/vapor plane FIELDS get
 *    the translucent depth-silent 'ghosted-field' veil, buried MEP runs +
 *    fixtures get 'ghosted-through' (drawn after the field), structure
 *    keeps the strong 'ghosted' copy.
 */
export function buildGroup(
  members: Member[],
  fixtures: Fixture[],
  mode: ViewMode,
  condenserAsset?: Object3D | null,
): Group {
  const { boxed, condensers } = splitAssetMembers(members, mode, condenserAsset)
  const group = groupFromBuckets(collectBuckets(boxed, fixtures, mode))
  if (condenserAsset) attachCondenserAssets(group, condensers, condenserAsset)
  return group
}

/** Pure bucketing pass — cheap JS grouping, shared by the full build and the
 * in-place patch path (F2). */
function collectBuckets(
  members: Member[],
  fixtures: Fixture[],
  mode: ViewMode,
): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>()
  const push = (
    key: string,
    color: string,
    dims: readonly [number, number, number],
    position: readonly [number, number, number],
    rotation: readonly [number, number, number],
    face: readonly [number, number] | undefined,
    treatment: BucketTreatment,
    sourceId?: string,
  ) => {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { color, entries: [], face, treatment, sourceId }
      buckets.set(key, bucket)
    }
    bucket.entries.push({ dims, position, rotation })
  }

  if (mode !== 'off') {
    for (const member of members) {
      const color = colorOf(member)
      if (mode === 'basement') {
        // Stratum split: below-floor is the star (solid + overlay ghost),
        // the house above fades to the faint orientation shell. Within the
        // stratum the slab/vapor FIELDS turn into a translucent veil and
        // the buried MEP network draws through them (QA round 3).
        if (isBelowFloor(member)) {
          const field = member.role === 'slab' || member.role === 'vapor-retarder'
          const run =
            member.system === 'plumbing' ||
            member.system === 'hvac' ||
            member.system === 'electrical'
          const treatment: BucketTreatment = field
            ? 'ghosted-field'
            : run
              ? 'ghosted-through'
              : 'ghosted'
          push(`${color}|${treatment}`, color, member.dims, member.position, member.rotation, undefined, treatment)
        } else {
          push(`${color}|faint`, color, member.dims, member.position, member.rotation, undefined, 'faint')
        }
        continue
      }
      // mode === 'xray'
      if (member.face) {
        // Assembly layers: bucket PER FACE NORMAL (quantized) AND per source
        // wall, so the dollhouse cut can classify each wall's near/far face
        // against its OWN plane and toggle whole meshes (night-4 split,
        // now load-bearing for the camera-position cut itself).
        const key = `${color}|${member.face[0].toFixed(2)},${member.face[1].toFixed(2)}|${member.sourceId}`
        push(key, color, member.dims, member.position, member.rotation, member.face, 'solid', member.sourceId)
        continue
      }
      // Everything — below-floor included — is depth-tested only: wall/roof/
      // MEP members read through the OPENED near faces of the dollhouse cut
      // (ghosting them made every wall look transparent, round-13), and the
      // under-floor stratum stays hidden behind real geometry by design.
      push(`${color}|solid`, color, member.dims, member.position, member.rotation, undefined, 'solid')
    }
  }
  for (const fixture of fixtures) {
    // Finished house: only the surface devices; basement: stratum-split
    // like members (advisory 2026-08-21 — a buried cleanout riser joins the
    // ghosted star content instead of fading into the shell); X-ray: solid.
    if (mode === 'off' && !SURFACE_FIXTURE_KINDS.has(fixture.kind)) continue
    const { dims, color } = fixtureBox(fixture)
    const below = fixture.position[1] + dims[1] / 2 < BURIED_TOP_Y
    // A buried fixture rides the RUN treatment (a cleanout riser belongs to
    // the drainage network it serves — it must read through the slab too).
    const treatment: BucketTreatment =
      mode === 'basement' ? (below ? 'ghosted-through' : 'faint') : 'solid'
    push(`${color}|fixture|${treatment}`, color, dims, fixture.position, [0, fixture.rotationY, 0], undefined, treatment)
  }
  return buckets
}

function groupFromBuckets(buckets: Map<string, Bucket>): Group {
  const group = new Group()
  const index = new Map<string, InstancedMesh[]>()

  // 'ghosted' buckets (basement mode's below-floor stratum) = TWO passes
  // (round-11 regression: overlay-only members painted over a TREE standing
  // in front of the house — the host's overlay pass composites over the
  // finished scene with no scene-depth test).
  //
  //  - A SOLID copy on the SCENE layer (0): normal depth against the whole
  //    scene, so anything nearer the camera — a tree, a neighboring house —
  //    occludes it exactly like real geometry. Under the floor it is
  //    hidden, which is fine: that is what the ghost is for.
  //  - A GHOST copy on the host OVERLAY layer (1): the editor's
  //    post-processing pipeline (packages/viewer post-processing.tsx)
  //    renders that layer into its own freshly cleared depth buffer and
  //    composites it on top by alpha. The ghost therefore shows THROUGH
  //    floors/walls/occluders (near member still hides far member — the
  //    round-2 requirement). Basement mode runs structure + buried runs
  //    STRONG (0.9) and the slab/vapor fields as a depth-silent 0.5 veil
  //    the runs draw through: the under-floor content is the star.
  //
  // Every in-scene depth trick failed on this pipeline and is pinned in
  // tests: renderer.clearDepth() poisoned the WebGPU pass; an inverted
  // depth-wipe box never landed its depthWrite; transparent-list membership
  // lost to the host's MRT scene pass on camera change.
  //
  // Degraded-but-visible fallback: when post-processing is off (WebGL2
  // fallback, ?disable=postFx) the camera mask still includes layer 1, so
  // both copies render in the main pass with shared depth — no see-through,
  // but nothing disappears.
  const OVERLAY_LAYER = 1

  for (const [key, bucket] of buckets) {
    // Normal depth-tested draws, so members occlude each other correctly —
    // the round-2 user-reported artifacts (footing over nearer studs, far
    // stud tops reading through the top plate) came from bypassing the
    // depth test. 'faint' buckets (basement's above-floor shell) skip the
    // depth WRITE so the barely-visible shell never occludes the solid
    // below-floor content behind it. Materials come from the module cache
    // (F1) — same (color, variant) → the SAME object every rebuild.
    const faint = bucket.treatment === 'faint'
    const solid = new InstancedMesh(
      UNIT_BOX,
      acquireBucketMaterial(bucket.color, faint ? 'faint' : 'solid'),
      bucket.entries.length,
    )
    if (bucket.face) solid.userData.face = bucket.face
    if (bucket.sourceId) solid.userData.sourceId = bucket.sourceId
    const meshes = [solid]
    if (
      bucket.treatment === 'ghosted' ||
      bucket.treatment === 'ghosted-field' ||
      bucket.treatment === 'ghosted-through'
    ) {
      // The slab/vapor veil stays clearly concrete but translucent and
      // depth-SILENT — a depth-writing slab hid the whole under-slab
      // drainage run in the overlay pass (QA round 3, 51-basement-34-sw.png
      // — pipes only peeked out at the edges); the runs draw after it
      // (renderOrder) and composite through. Structure and the buried
      // network keep the strong depth-writing copy (self-occlusion inside
      // the overlay pass needs the depth write transparent materials skip).
      const field = bucket.treatment === 'ghosted-field'
      const ghost = new InstancedMesh(
        UNIT_BOX,
        acquireBucketMaterial(bucket.color, field ? 'ghost-field' : 'ghost'),
        bucket.entries.length,
      )
      ghost.layers.set(OVERLAY_LAYER)
      if (bucket.treatment === 'ghosted-through') ghost.renderOrder = THROUGH_RENDER_ORDER
      meshes.push(ghost)
    }
    writeMatrices(bucket, meshes)
    for (const mesh of meshes) {
      mesh.castShadow = mesh === solid && !faint
      mesh.receiveShadow = mesh === solid && !faint
      mesh.frustumCulled = false
      // The X-ray is a pure VISUAL: framing meshes must never intercept
      // the host's event raycast. R3F recurses through the level wrapper
      // groups, so without this every bucket (even invisible culled ones)
      // landed in event.intersections at the wall's own depth and starved
      // the hidden-wall selection gate — hovering a stud highlighted the
      // furniture behind the wall (F2 QA round). Devices stay clickable:
      // outlets are separate bones:device HOST nodes, not these meshes.
      mesh.raycast = () => {}
      group.add(mesh)
    }
    index.set(key, meshes)
  }
  bucketIndex.set(group, index)
  return group
}

/**
 * The cheap common path (night-8 perf, F2): during a move-tool drag the
 * bucket STRUCTURE barely changes — the same walls keep the same color
 * buckets with the same member counts; only positions/dims move. When the
 * fresh bucketing matches the group's existing meshes key-for-key and
 * count-for-count, rewrite the instance matrices in place and keep every
 * mesh (and its cached material, and the React tree) untouched — the
 * preview tick costs matrix math, not group + material + program rebuilds.
 * Any structural change (stud added, bucket appeared, wall rotated → face
 * key moved) returns false and the caller does a full rebuild.
 */
export function patchGroup(
  group: Group,
  members: Member[],
  fixtures: Fixture[],
  mode: ViewMode,
  condenserAsset?: Object3D | null,
): boolean {
  const index = bucketIndex.get(group)
  if (!index) return false
  // Condenser-asset wrappers patch like bucket instances: same member
  // count → rewrite the wrapper matrices in place; any structural change
  // (asset just resolved, cabinet added/removed, mode moved) mismatches
  // and forces the full rebuild — exactly the bucket contract.
  const { boxed, condensers } = splitAssetMembers(members, mode, condenserAsset)
  const wrappers = assetWrapperIndex.get(group) ?? []
  if (wrappers.length !== condensers.length) return false
  const buckets = collectBuckets(boxed, fixtures, mode)
  if (buckets.size !== index.size) return false
  for (const [key, bucket] of buckets) {
    const meshes = index.get(key)
    if (!meshes || meshes[0]?.count !== bucket.entries.length) return false
  }
  for (const [key, bucket] of buckets) {
    const meshes = index.get(key)
    if (meshes) writeMatrices(bucket, meshes)
  }
  condensers.forEach((member, i) => {
    const wrapper = wrappers[i]
    if (!wrapper) return
    composeEntryMatrix(member.dims, member.position, member.rotation, wrapper.matrix)
    wrapper.matrixWorldNeedsUpdate = true
  })
  return true
}

/**
 * Group-set level patch: split members by mount level exactly like
 * buildGroups, then patch the main + every foreign group in place. False on
 * ANY mismatch (level set changed, stratum tag flipped, bucket structure
 * moved) — the caller rebuilds; a partially patched group is then discarded
 * wholesale, so there is no torn state to unwind.
 */
export function patchGroups(
  built: BuiltGroups,
  members: Member[],
  fixtures: Fixture[],
  mode: ViewMode,
  condenserAsset?: Object3D | null,
): boolean {
  const own: Member[] = []
  const byLevel = new Map<string, Member[]>()
  for (const m of members) {
    const mount = m.levelId ?? m.mountLevelId
    if (mount) {
      const list = byLevel.get(mount) ?? []
      list.push(m)
      byLevel.set(mount, list)
    } else own.push(m)
  }
  if (byLevel.size !== built.foreign.size) return false
  for (const levelId of byLevel.keys()) if (!built.foreign.has(levelId)) return false
  if (!patchGroup(built.group, own, fixtures, mode, condenserAsset)) return false
  for (const [levelId, list] of byLevel) {
    const g = built.foreign.get(levelId)
    if (!g) return false
    if (g.userData.strataAbove !== list.some((m) => m.strataAbove === true)) return false
    if (!patchGroup(g, list, [], mode, condenserAsset)) return false
  }
  return true
}

/**
 * X-RAY DOLLHOUSE CUT — camera-POSITION based, per wall (night-8 UX round:
 * "the closest [face] to the camera is removed as if the wall was opened…
 * the drywall in the back shows — we don't see through the whole wall").
 *
 * The original cut classified faces by VIEW DIRECTION (face · camera
 * forward > 0.02): any wall roughly PARALLEL to the view axis had BOTH
 * faces at dot ≈ 0 → both hidden → you saw straight through the wall into
 * the next room ("shouldn't just be like no drywall at all"). Position-
 * based: the camera sits on exactly ONE side of each wall's plan-space
 * plane; the LAYER face pointing at that side (the near face) opens, its
 * twin stays visible as the closed backing. Exactly one face per wall is
 * ever hidden, from any azimuth. Framing members and in-wall MEP carry no
 * `face` and are never touched by this pass; 'off' has no face buckets at
 * all and 'basement' buckets are built face-less (the faint shell owns it) —
 * plus the mode gate in the frame loop.
 *
 * HYSTERESIS: while the camera's plan distance to a wall plane is within
 * ±XRAY_CUT_BAND (m), the wall HOLDS its last committed side — crossing or
 * grazing a wall plane while orbiting never flaps the cut. A wall flips
 * only once the camera is clearly past the plane, and the per-wall cache
 * means visibility writes happen only on that flip (O(walls) dots per
 * frame, zero .visible churn while the side is stable).
 */
export const XRAY_CUT_BAND = 0.5

/** Plan-space cut plane of one wall: unit normal (nx, nz) + a point on the
 * centerline (cx, cz) — level-local XZ, same frame the members live in. */
export type CutPlane = { nx: number; nz: number; cx: number; cz: number }

/**
 * Cut planes for every face-carrying source wall. Exact planes come from
 * the compute result's WallSlices (normal = dir rotated -90°, matching
 * wall-layers' normalOf, so face · n = ±1 for that wall's two stacks).
 * Defensive fallback (every wall-layers member sources an ACTIVE wall
 * today): a face member whose wall the compute didn't return derives its
 * plane from the members themselves — first face as the canonical normal,
 * centroid of ALL that wall's layer boxes as the plane point (the two
 * stacks average out to ≈ the centerline; the residual is centimeters,
 * far inside the hysteresis band).
 */
export function collectCutPlanes(
  members: readonly Pick<Member, 'face' | 'sourceId' | 'position'>[],
  walls: readonly {
    id: string
    start: readonly [number, number]
    dir: readonly [number, number]
    length: number
  }[],
): Map<string, CutPlane> {
  const planes = new Map<string, CutPlane>()
  for (const w of walls) {
    planes.set(w.id, {
      nx: -w.dir[1],
      nz: w.dir[0],
      cx: w.start[0] + (w.dir[0] * w.length) / 2,
      cz: w.start[1] + (w.dir[1] * w.length) / 2,
    })
  }
  let fallback: Map<string, { nx: number; nz: number; sx: number; sz: number; n: number }> | null =
    null
  for (const m of members) {
    if (!m.face || planes.has(m.sourceId)) continue
    fallback ??= new Map()
    let acc = fallback.get(m.sourceId)
    if (!acc) {
      acc = { nx: m.face[0], nz: m.face[1], sx: 0, sz: 0, n: 0 }
      fallback.set(m.sourceId, acc)
    }
    acc.sx += m.position[0]
    acc.sz += m.position[2]
    acc.n += 1
  }
  if (fallback) {
    for (const [id, acc] of fallback) {
      planes.set(id, { nx: acc.nx, nz: acc.nz, cx: acc.sx / acc.n, cz: acc.sz / acc.n })
    }
  }
  return planes
}

/** Last committed camera side of one wall (+1 = the side its canonical
 * normal points to), stored WITH that normal so a re-oriented wall (face
 * keys re-bucket on rotation anyway) never reuses a stale side. */
export type WallSide = { side: 1 | -1; nx: number; nz: number }

/**
 * Per-frame side classification: one dot per wall against the PLAN camera
 * position — dot(wallNormal, camPos − wallPoint) — with the hysteresis dead
 * band. Mutates `state` in place; entries flip only when the camera is
 * clearly (> XRAY_CUT_BAND) on the other side of the plane.
 */
export function updateWallSides(
  planes: ReadonlyMap<string, CutPlane>,
  camX: number,
  camZ: number,
  state: Map<string, WallSide>,
): void {
  for (const [id, p] of planes) {
    const s = p.nx * (camX - p.cx) + p.nz * (camZ - p.cz)
    const cached = state.get(id)
    // No cache yet, or the wall re-oriented (> ~8°): commit the raw sign —
    // hysteresis needs a committed side to hold.
    if (!cached || cached.nx * p.nx + cached.nz * p.nz < 0.99) {
      state.set(id, { side: s >= 0 ? 1 : -1, nx: p.nx, nz: p.nz })
      continue
    }
    if (Math.abs(s) > XRAY_CUT_BAND) {
      const side: 1 | -1 = s > 0 ? 1 : -1
      if (cached.side !== side) cached.side = side
    }
    // inside the band: hold the last committed side — no flapping
  }
}

/**
 * Apply the cut to one group's children: LAYER buckets (userData.face) hide
 * exactly when they are the wall's NEAR face — face · wallNormal has the
 * same sign as the camera's side. The far face, framing, MEP, fixtures:
 * untouched. `.visible` is written ONLY when the value actually changes
 * (the side cache makes that "only on a flip"). A face with no classifiable
 * plane stays visible — this pass may open ONE face of a wall, never both.
 *
 * SELECTION never changes the cut (day-9 feedback #4). The retired night-4
 * exemption kept BOTH faces of the selected wall visible so finish picks
 * read under the old view-DIRECTION cull (which could blank both faces of
 * a parallel wall); under the position cut that pathology is gone, and the
 * exemption's only remaining effect was to CLOSE the near drywall over the
 * in-wall wires/pipes at the exact moment the user opened the Engineering
 * card to look inside ("electrical, plumbing, all the wires… disappear").
 * A selected wall now reads open toward the camera like any other wall.
 */
export function applyFaceCut(
  children: readonly { userData: unknown; visible: boolean }[],
  sides: ReadonlyMap<string, WallSide>,
): void {
  for (const child of children) {
    const ud = child.userData as { face?: readonly [number, number]; sourceId?: string }
    const face = ud.face
    if (!face) continue
    const wall = ud.sourceId ? sides.get(ud.sourceId) : undefined
    let visible = true
    if (wall) {
      const toward = face[0] * wall.nx + face[1] * wall.nz
      visible = toward * wall.side <= 0
    }
    if (child.visible !== visible) child.visible = visible
  }
}

/** Exploded-view stratum for a foreign roof group (day board A): drop the
 * bones roof HALF an exploded slot below the roof shell so floor / trusses /
 * shingle shell read as three ~equal strata — but ONLY for groups whose
 * source level sits strictly ABOVE the owner's storey — or the owner sits ON
 * a true attic level (render-only mountLevelId) — (`strataAbove`, tagged
 * by compute): a ground-storey porch roof foreign to an upper owner drops
 * INTO the storey below it otherwise (verify round 2026-08-16, F1). Intended
 * limitation (checklist A3): an owner ON the roof level frames that roof as
 * own-level members — no foreign group, no stratum in exploded view.
 * DRIFT PIN: half a slot = EXPLODED_GAP / 2; the host constant lives at
 * editor packages/viewer/src/systems/level/level-system.tsx
 * (`const EXPLODED_GAP = 5`) — if that value moves, this one follows.
 * Foreign groups are level-LOCAL — the offset composes with the host's own
 * level lerp in every mode. `undefined` levelMode (viewer store not
 * resolved yet) reads as stacked. */
export function explodedRoofOffset(
  levelMode: string | undefined,
  strataAbove: boolean,
): number {
  return levelMode === 'exploded' && strataAbove ? -2.5 : 0
}

export function disposeGroup(group: Group) {
  // mesh.dispose() releases the per-mesh GPU state (instance-matrix
  // buffers) via the renderer's dispose listener — that is ALL a teardown
  // may free. Materials are module-cache SHARED across live groups (F1)
  // and the unit-box geometry is a module singleton: disposing either here
  // freed resources other meshes still bind (F3: 1229 'bindTexture:
  // attempt to use a deleted object' warnings + ~2.9MB retained heap per
  // X-ray toggle pair) and forced the very shader recompiles the cache
  // exists to prevent.
  for (const child of group.children) {
    ;(child as InstancedMesh).dispose?.()
  }
}

export const FramingRenderer = ({ node }: { node: FramingNode }) => {
  const ref = useRef<Group>(null!)
  const camLocal = useRef(new Vector3())
  // Per-wall committed camera side — survives rebuilds AND the patch path,
  // so the hysteresis band holds across drags and mode round-trips.
  const wallSides = useRef(new Map<string, WallSide>())
  // Cached useViewer store handle (resolved by the dynamic import below) —
  // useFrame can't await, so attachForeign reads levelMode through this ref;
  // null until the import lands = treat as stacked.
  const viewerStore = useRef<{
    getState: () => { levelMode?: string }
  } | null>(null)
  useRegistry(node.id, node.type, ref)

  // Any scene edit re-derives the skeleton — that's the contract (never stale).
  const nodes = useScene((s) => s.nodes)
  const result = useMemo(
    () => computeLevel(nodes as Record<string, Record<string, unknown>>, node),
    [nodes, node],
  )

  // LIVE-DRAG reactivity (night-6, user report: framing froze while a door
  // slid): the host's move/placement tools ride transient node overrides
  // and only commit on drop — fold them in and recompute at ~10Hz so
  // kings/trimmers/headers/wires FOLLOW the gesture. Falls back to the
  // memoized committed result the instant the overrides clear.
  const [liveResult, setLiveResult] = useState<ReturnType<typeof computeLevel> | null>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  useEffect(() => {
    let disposed = false
    const recompute = () => {
      if (disposed) return
      const overrides = useLiveNodeOverrides.getState().overrides
      const effective = effectiveNodesFor(
        nodesRef.current as Record<string, Record<string, unknown>>,
        overrides,
      )
      setLiveResult(effective ? computeLevel(effective, node) : null)
    }
    const throttled = throttleTrailing(recompute, 100)
    const unsub = useLiveNodeOverrides.subscribe(() => throttled.run())
    return () => {
      disposed = true
      throttled.cancel()
      unsub()
    }
  }, [node])
  // A committed write (drop, or any config edit mid-drag) invalidates the
  // live snapshot IMMEDIATELY — waiting for the trailing null left `active`
  // one edit behind the store at the commit render (verify night-6).
  useEffect(() => {
    setLiveResult(null)
  }, [nodes, node])
  const active = liveResult ?? result

  // Movable outlets (Q7): mirror every derived wall device into a
  // `bones:device` node so ANY receptacle/switch is hoverable and draggable —
  // create missing nodes at the derived spots, normalize drag-committed
  // positions into wall anchors, re-seat unmoved ones when the derivation
  // drifts, drop orphans; nodes the user moved are never re-seated
  // (device/place.ts). The same batch normalizes drag-committed
  // `bones:service` positions (service/normalize.ts) — the parentFrame drags
  // carry NO onCommit (night-5 D2/D3: the host onCommit branch's wall patch
  // woke the space-detection sync mid-commit), so the anchor conversion for
  // both kinds lives here. Derived maintenance, not a user edit: history
  // pauses around the batch so reconcile writes never pollute undo, and the
  // whole plan lands in ONE applyNodeChanges. Converges in one pass (the
  // re-run on the resulting nodes change plans zero ops). Bails in read-only
  // hosts (community viewer) — no scene writes on view, like cladding-paint.
  useEffect(() => {
    if (node.visible === false) return
    const levelId = node.parentId
    if (!levelId) return
    const state = useScene.getState() as unknown as {
      readOnly?: boolean
      nodes: Record<string, Record<string, unknown>>
      applyNodeChanges: (changes: {
        create?: { node: unknown; parentId?: unknown }[]
        update?: { id: unknown; data: Record<string, unknown> }[]
        delete?: unknown[]
      }) => void
    }
    if (state.readOnly) return
    // Plan against the FRESH store state, not this render's snapshot: with
    // two X-rays on one level, the second effect would otherwise re-plan
    // the first one's creates from a stale snapshot and mint duplicates
    // (the dedupe would heal it, but with churn).
    //
    // Service anchor normalization runs regardless of the outlets flag —
    // service points ship enabled and their drags need the same one-entry
    // commit. Device reconciliation rides the movableOutlets flag (default
    // ON since night-5; the per-node opt-out stays available). ABSENT ≠ off:
    // stored scenes predating the flag never re-parse through the schema on
    // load, so the node object simply lacks the key — only an explicit
    // `false` (inspector toggle / MCP) disables (night-5 final round: a
    // `=== true` guard left a default-path scene with ZERO device nodes).
    const serviceUpdates = normalizeServiceAnchors(state.nodes, levelId)
    const devicesOn = node.movableOutlets !== false && node.showElectrical !== false
    const plan = devicesOn
      ? reconcileDeviceNodes(state.nodes, levelId, result.devices)
      : { create: [], update: [], remove: [] }
    // Service auto-heal (user round 2026-08-20: automatic service points,
    // no button): a pre-automation scene — framing node without the
    // `servicesSeeded` latch — seeds ONCE on the next render, right here in
    // the derived-maintenance batch (history-paused, like device seeding:
    // undo never replays it). The latch (written in the SAME batch) plus
    // the adopt-existing rule in planServiceSeeding guarantee a service
    // point the user deletes is never resurrected. Read the FRESH framing
    // node — a paused-batch latch write doesn't bump this effect's deps in
    // every host, and a stale prop must not double-seed.
    const freshFraming =
      (state.nodes[node.id as string] as { id: string; servicesSeeded?: unknown } | undefined) ??
      (node as { id: string; servicesSeeded?: unknown })
    const seeding = planServiceSeeding(state.nodes, levelId, freshFraming)
    const create = [...plan.create, ...seeding.create] as unknown[]
    const update = [...plan.update, ...serviceUpdates, ...seeding.update]
    if (create.length + update.length + plan.remove.length === 0) return
    pauseSceneHistory(useScene)
    try {
      state.applyNodeChanges({
        create: create.map((n) => ({ node: n, parentId: levelId })),
        update: update.map((u) => ({ id: u.id, data: u.data })),
        delete: plan.remove,
      })
    } finally {
      resumeSceneHistory(useScene)
    }
  }, [nodes, node, result])

  // OFF / X-RAY / BASEMENT — one field drives every treatment below
  // (legacy seeThrough nodes resolve through effectiveViewMode).
  const mode = effectiveViewMode(node)

  // AC-block visual swap (user ask 2026-08-22): once the host's 'AC block'
  // heat-pump asset resolves, X-ray condenser cabinets render as the real
  // model in place of the steel box (same matrix — splitAssetMembers /
  // attachCondenserAssets above). Lazy: only an X-ray that actually SHOWS a
  // cabinet kicks the once-per-session GLB fetch, and a failed load simply
  // leaves the boxes (loadCondenserAsset never rejects) — progressive
  // enhancement, never a hole. Headless (bun test) nothing here runs: the
  // component is never mounted, so the dynamic loader import never fires.
  const [condenserAsset, setCondenserAsset] = useState<Object3D | null>(() =>
    condenserAssetSnapshot(),
  )
  const wantsCondenserAsset = mode === 'xray' && active.members.some(isCondenserCabinet)
  useEffect(() => {
    if (condenserAsset || !wantsCondenserAsset) return
    let disposed = false
    loadCondenserAsset().then((asset) => {
      if (!disposed && asset) setCondenserAsset(asset)
    })
    return () => {
      disposed = true
    }
  }, [condenserAsset, wantsCondenserAsset])

  // In-place fast path (night-8 perf, F2): when the fresh compute keeps the
  // bucket structure (the common case for every live-drag preview tick and
  // most single-member commits), patch the existing groups' instance
  // matrices and return the SAME BuiltGroups reference — no mesh/material
  // construction, no dispose, no React commit on the <primitive>. Structure
  // changed → full rebuild; the [built] effect below disposes the old one.
  const builtRef = useRef<BuiltGroups | null>(null)
  const built = useMemo(() => {
    const prev = builtRef.current
    if (prev && patchGroups(prev, active.members, active.fixtures, mode, condenserAsset)) {
      return prev
    }
    const next = buildGroups(active.members, active.fixtures, mode, condenserAsset)
    builtRef.current = next
    return next
    // `active` (NOT `result`): during a drag only the override store moves,
    // so a committed-only dep froze the scene graph — the whole feature was
    // visually inert (verify night-6 blocker).
  }, [active, mode, condenserAsset])
  const group = built.group
  useEffect(() => {
    return () => {
      disposeGroup(built.group)
      for (const g of built.foreign.values()) {
        g.parent?.remove(g)
        disposeGroup(g)
      }
    }
  }, [built])

  // Cross-level members (the roof on its own storey) mount into THEIR
  // level's Object3D so the host's stacked/exploded/solo level transforms
  // and visibility apply natively — a baked storey offset was only right
  // in stacked view (prod 2026-08-15 round 3). The level object may
  // register after us, so (re)attach lazily in the frame loop below.
  const attachForeign = () => {
    // Exploded stratum: in exploded level mode a foreign roof group ABOVE
    // the owner drops half a slot below the roof shell (floor / trusses /
    // shell = three strata). Below-owner groups (a ground-storey porch
    // roof), any other mode, or the viewer store not resolved yet: flush.
    const levelMode = viewerStore.current?.getState().levelMode
    for (const [levelId, g] of built.foreign) {
      const levelObj = sceneRegistry.nodes.get(levelId as Parameters<typeof sceneRegistry.nodes.get>[0])
      if (levelObj && g.parent !== levelObj) levelObj.add(g)
      g.position.y = explodedRoofOffset(levelMode, g.userData.strataAbove === true)
      // Imperative children don't unmount with the JSX — mirror the node's
      // visibility by hand (hiding the X-ray must hide the foreign roofs).
      g.visible = node.visible !== false
    }
  }

  // Wall-mode note: the auto-switch to 'down' (Low) used to live HERE as
  // mount-time magic with a restore-on-unmount — unreliable by construction
  // (it rode the renderer lifecycle behind two async hops, a second X-rayed
  // level recorded nothing so removing the first snapped walls back to
  // full/cutaway under a live X-ray, and remounts re-imposed 'down' over a
  // manual choice). It now lives in src/activation.ts, scoped to the actual
  // user actions: activate → 'down' once; viewMode off / panel Remove →
  // restore; everything in between is the user's. This effect only caches
  // the viewer store HANDLE for the frame loop (exploded roof stratum) —
  // dynamic import because the viewer package drags browser-only deps that
  // must never evaluate under bun test (it only runs in the host).
  useEffect(() => {
    import('@pascal-app/viewer').then(({ useViewer }) => {
      viewerStore.current = useViewer as unknown as {
        getState: () => { levelMode?: string }
      }
    })
  }, [])

  // Cut planes for every face-carrying wall — recomputed with the compute
  // result (`active` moves on every commit AND every live-drag tick, so the
  // planes are never stale under the patch path).
  const cutPlanes = useMemo(
    () => collectCutPlanes(active.members, active.walls),
    [active],
  )

  // Dollhouse cut (round 13; camera-POSITION rewrite night-8): assembly-
  // layer buckets carry their face normal — the face on the CAMERA'S side
  // of the wall plane opens so you look INTO the cavity, and the far face
  // stays visible as the closed backing (you never see through the wall
  // into the next room). The wall is never transparent; the near face is
  // simply removed.
  useFrame(({ camera }) => {
    attachForeign()
    // The dollhouse cut is an X-ray affordance: 'off' has no face buckets
    // at all, 'basement' keeps its faint shell intact from every angle.
    if (mode !== 'xray') return
    // Camera position in the LEVEL's local plan frame: levels move in Y
    // across stacked/exploded/solo (XZ shared), and worldToLocal also
    // covers hosts that transform buildings in plan.
    const cam = camera.getWorldPosition(camLocal.current)
    group.updateWorldMatrix(true, false)
    group.worldToLocal(cam)
    updateWallSides(cutPlanes, cam.x, cam.z, wallSides.current)
    // SELECTION does not change the cut (day-9 feedback #4): the user opens
    // a wall's Engineering card precisely to look INSIDE it, so the selected
    // wall keeps the same open-toward-the-camera read as every other wall —
    // the near face stays off, the in-wall wires/pipes/framing stay in view.
    // (The retired night-4 both-faces exemption closed the near drywall over
    // the guts on selection; its finish-readability rationale belonged to
    // the old direction cull. The host's selection outline is a post-
    // processing pass over the WALL node's own Object3D — bones meshes are
    // registered under the framing node and raycast-disabled, so it never
    // needs these faces.)
    applyFaceCut(group.children, wallSides.current)
    // Foreign groups (cross-level roofs, gable-wall layers) carry face
    // buckets too — they were never culled, leaving gable finishes
    // permanently opaque from every angle (night-5 queue). Levels differ by
    // Y only, so the owner-local plan camera classifies their walls
    // identically.
    for (const [, g] of built.foreign) applyFaceCut(g.children, wallSides.current)
  })

  if (!node.visible) return null
  return (
    <group ref={ref}>
      <primitive object={group} />
    </group>
  )
}

export default FramingRenderer
