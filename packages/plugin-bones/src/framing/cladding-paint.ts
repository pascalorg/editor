import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type SceneMaterial,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import type { WallCladding } from './schema'

/**
 * Solid-mode half of the cladding choice: the Bones members only render in
 * X-ray, so picking "stucco" must ALSO repaint the host-drawn wall skin.
 * The host's unified surface model is `node.slots[side] = MaterialRef`
 * (`library:<id>` or `scene:<id>`) — the paint tool writes exactly that
 * field, so writing it here gets rendering, caching, undo, persistence and
 * GLB export for free. No host changes needed.
 */

/**
 * Exterior face-band slots fall back to the whole-face `exterior` ref only
 * when they carry no ref of their own — clearing them makes a banded wall
 * repaint uniformly instead of keeping stale bands over the new finish.
 */
const EXTERIOR_BAND_SLOTS = ['lowerExterior', 'middleExterior', 'upperExterior', 'topExterior']

/**
 * Families with a real texture set in the host material library. The library
 * has no siding/clapboard textures at all (vinyl, fiber cement, wood lap),
 * so those mint flat scene materials below instead.
 */
const LIBRARY_REF: Partial<Record<WallCladding, string>> = {
  stucco: 'library:concrete-stucco',
  brickVeneer: 'library:flooring-rusticbrick',
  eifs: 'library:concrete-plaster',
}

/**
 * Flat finishes for the texture-less families — colors match the X-ray
 * member palette (framing/renderer colorOf) so solid and X-ray agree.
 */
export const FLAT_FINISH: Partial<
  Record<WallCladding, { name: string; color: string; roughness: number }>
> = {
  vinyl: { name: 'Vinyl siding', color: '#b9c6d1', roughness: 0.45 },
  fiberCement: { name: 'Fiber cement siding', color: '#a9b3a4', roughness: 0.8 },
  wood: { name: 'Wood siding', color: '#a67848', roughness: 0.75 },
}

type MaterialsLike = Record<string, { id: string; name: string; material: unknown }>

export type CladdingPaintPlan = {
  /** Full replacement slots record for the wall node (interior untouched). */
  slots: Record<string, string>
  /** Scene material to create WITH the slot write (one undo step) — set only
   * when a flat family has no byte-identical material to reuse. */
  mint?: SceneMaterial
}

const flatMaterial = (def: { color: string; roughness: number }) => ({
  preset: 'custom' as const,
  properties: {
    color: def.color,
    roughness: def.roughness,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  },
})

/**
 * Pure planner: given the chosen family and the wall's current slots, return
 * the next slots record (+ a material to mint when needed). Mirrors the host
 * paint tool's find-or-mint so repeated picks reuse one scene material.
 */
export function claddingPaintPlan(
  cladding: WallCladding,
  slots: Record<string, string> | undefined,
  materials: MaterialsLike,
): CladdingPaintPlan | null {
  const next: Record<string, string> = { ...(slots ?? {}) }
  for (const band of EXTERIOR_BAND_SLOTS) delete next[band]

  const libraryRef = LIBRARY_REF[cladding]
  if (libraryRef) {
    next.exterior = libraryRef
    return { slots: next }
  }

  const flat = FLAT_FINISH[cladding]
  if (!flat) return null
  const material = flatMaterial(flat)
  const wanted = JSON.stringify(material)
  const existing = Object.values(materials).find((m) => JSON.stringify(m.material) === wanted)
  if (existing) {
    next.exterior = toSceneMaterialRef(existing.id)
    return { slots: next }
  }
  const id = generateSceneMaterialId()
  next.exterior = toSceneMaterialRef(id)
  return { slots: next, mint: { id, name: flat.name, material } }
}

/**
 * Apply the OVERRIDE write and the solid-mode repaint as ONE store commit:
 * the framing-node patch, every wall's new slots (paintIds from
 * selectedWallInfo — the kept wall plus its dedupe twins, so a merged run
 * repaints without a seam) and any minted material land in a single
 * setState, so a single Cmd+Z reverts the whole cladding pick together
 * (verify round: two entries let one undo desync the skin from the
 * Engineering select). Interior slots are never touched.
 */
export function paintWallExterior(
  paintIds: readonly string[],
  cladding: WallCladding,
  framingWrite?: { nodeId: string; patch: Record<string, unknown> },
): void {
  const state = useScene.getState()
  // Bail BEFORE the setState: guarding only inside the reducer still
  // pushes an identical-snapshot undo entry in read-only mode (verify
  // round advisory — host actions guard before set).
  if ((state as { readOnly?: boolean }).readOnly) return

  // Plan everything against the CURRENT state first (find-or-mint must see
  // a material minted for wall A when planning wall B in the same pick).
  const plans = new Map<string, CladdingPaintPlan>()
  const mints: SceneMaterial[] = []
  const staged: MaterialsLike = { ...(state.materials as MaterialsLike) }
  for (const wallId of paintIds) {
    const node = state.nodes[wallId as AnyNodeId] as
      | (AnyNode & { slots?: Record<string, string> })
      | undefined
    if (!node) continue
    const plan = claddingPaintPlan(cladding, node.slots, staged)
    if (!plan) continue
    plans.set(wallId, plan)
    if (plan.mint) {
      mints.push(plan.mint)
      staged[plan.mint.id] = plan.mint
    }
  }
  if (plans.size === 0 && !framingWrite) return

  useScene.setState((s) => {
    if (s.readOnly) return s
    const nodes = { ...s.nodes }
    let materials = s.materials
    for (const mint of mints) {
      materials = materials === s.materials ? { ...s.materials } : materials
      ;(materials as Record<string, SceneMaterial>)[mint.id] = mint
    }
    for (const [wallId, plan] of plans) {
      const live = nodes[wallId as AnyNodeId] as
        | (AnyNode & { slots?: Record<string, string> })
        | undefined
      if (!live) continue
      nodes[wallId as AnyNodeId] = { ...live, slots: plan.slots } as AnyNode
    }
    if (framingWrite) {
      const live = nodes[framingWrite.nodeId as AnyNodeId]
      if (live) {
        nodes[framingWrite.nodeId as AnyNodeId] = {
          ...live,
          ...framingWrite.patch,
        } as AnyNode
      }
    }
    return { nodes, materials }
  })
  const after = useScene.getState()
  for (const wallId of plans.keys()) after.markDirty(wallId as AnyNodeId)
  if (framingWrite) after.markDirty(framingWrite.nodeId as AnyNodeId)
}
