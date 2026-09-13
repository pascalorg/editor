/**
 * THE AUTO ROOF FOLLOWS THE WALLS.
 *
 * Once a level's roof was derived — by the generator or by the Auto roof
 * command — it keeps following: move a wall, stretch one, add one, and the
 * roof is re-derived from the walls as they now stand, with the intent the
 * roof was made with (its form, pitch, overhang, gables). It is on by
 * default and the user can turn it off per roof (Steve, 2026-09-07: "on auto
 * build roof, once it's on, if they change the wall or move it out make sure
 * it updates the roof as they do it, they can turn it off too, default on").
 *
 * This module is the PURE part — which roof follows, with what intent, and
 * whether a scene change touched the walls — so it can be tested without a
 * store. `index.ts` wires it to the scene; `run.ts` does the rebuild.
 */
import type { RoofIntent } from './derive'
import type { Pt } from './geometry'
import type { AutoRoofOptions } from './store'
import { styleRoofForm } from './styles'

const IN = 0.0254

type Node = {
  id: string
  type?: string
  parentId?: string | null
  visible?: boolean
  children?: readonly string[]
  metadata?: Record<string, unknown>
  [key: string]: unknown
}
export type Nodes = Readonly<Record<string, Node | undefined>>

/** What the roof node remembers about how it was derived. */
export type AutoRoofRecord = {
  source?: string
  porch?: boolean
  follow?: boolean
  /** The generator's intent (plan-document terms). */
  intent?: { form?: string; pitchInTwelfths?: number; overhangIn?: number; gables?: readonly string[] }
  /** The Auto roof command's options. */
  options?: Partial<AutoRoofOptions>
}

function record(roof: Node | undefined): AutoRoofRecord | null {
  const auto = roof?.metadata?.autoRoof
  return auto && typeof auto === 'object' ? (auto as AutoRoofRecord) : null
}

/**
 * The roof on `levelId` that follows the walls: a derived roof (it carries
 * an `autoRoof` record), not a porch cover (those belong to the porch), and
 * not one the user switched off. The first such roof; a level has one.
 */
export function followRoofOf(nodes: Nodes, levelId: string): Node | null {
  const level = nodes[levelId]
  for (const id of level?.children ?? []) {
    const roof = nodes[id]
    if (!roof || roof.type !== 'roof' || roof.visible === false) continue
    const auto = record(roof)
    if (!auto || auto.porch) continue
    if (auto.follow === false) continue
    return roof
  }
  return null
}

const EDGE_NORMAL: Record<string, Pt> = {
  front: [0, -1],
  back: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/**
 * The intent the roof was derived with, read back off its record: the
 * generator's plan-document terms (form, pitch in twelfths, overhang in
 * inches, gable edges by name) or the command's options. Null when the
 * record carries neither — a hand-placed roof has no intent to follow.
 */
export function intentOfRoof(roof: Node): RoofIntent | null {
  const auto = record(roof)
  if (!auto) return null
  if (auto.intent && typeof auto.intent.form === 'string') {
    const i = auto.intent
    const form = i.form === 'flat' || i.form === 'shed' || i.form === 'hip' ? i.form : 'gable'
    const gables = (i.gables ?? []).map((g) => EDGE_NORMAL[g]).filter((g): g is Pt => !!g)
    return {
      form,
      pitchTwelfths: typeof i.pitchInTwelfths === 'number' ? i.pitchInTwelfths : 6,
      overhang: (typeof i.overhangIn === 'number' ? i.overhangIn : 16) * IN,
      ...(gables.length > 0 ? { gables } : {}),
      frontDir: [0, -1],
    }
  }
  if (auto.options) {
    const o = auto.options
    const style = typeof o.style === 'string' ? o.style : ''
    const form = o.form && o.form !== 'auto' ? o.form : (styleRoofForm(style) ?? 'gable')
    return {
      form,
      pitchTwelfths: typeof o.pitchTwelfths === 'number' ? o.pitchTwelfths : 6,
      overhang: (typeof o.overhangIn === 'number' ? o.overhangIn : 16) * IN,
      ...(style ? { style } : {}),
    }
  }
  return null
}

/** The fields of a wall that shape a roof — a change in any of them re-derives it. */
function wallShape(wall: Node): string {
  const num = (v: unknown) => (typeof v === 'number' ? v.toFixed(5) : '')
  const pt = (v: unknown) => (Array.isArray(v) ? `${num(v[0])},${num(v[1])}` : '')
  return `${pt(wall.start)}|${pt(wall.end)}|${num(wall.thickness)}|${num(wall.height)}|${num(wall.supportOffset)}|${wall.visible === false ? 'h' : 'v'}`
}

/**
 * The levels whose walls changed shape between two scene snapshots — a wall
 * moved, resized, added, removed, hidden. Metadata-only writes (the roof
 * roles the rebuild itself stamps on the walls) are not a change, which is
 * what keeps the follow from feeding itself.
 */
export function levelsWithWallChanges(before: Nodes, after: Nodes): string[] {
  const levels = new Set<string>()
  const seen = new Set<string>()
  for (const node of Object.values(after)) {
    if (!node || node.type !== 'wall') continue
    seen.add(node.id)
    const prior = before[node.id]
    if (prior === node) continue
    if (!prior || wallShape(prior) !== wallShape(node)) {
      if (typeof node.parentId === 'string') levels.add(node.parentId)
    }
  }
  for (const node of Object.values(before)) {
    if (!node || node.type !== 'wall' || seen.has(node.id)) continue
    if (typeof node.parentId === 'string') levels.add(node.parentId)
  }
  return [...levels]
}
