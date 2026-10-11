import { matchPascalMaterial } from '../procedural-items/library-colors'
import type { CompiledGeometryScript } from '../schema'
import { GeometrySourceMeta } from '../schema/geometry-metadata'
import type { ColumnNode } from '../schema/nodes/column'
import type { DoorNode } from '../schema/nodes/door'
import type { ItemNode } from '../schema/nodes/item'
import type { WindowNode } from '../schema/nodes/window'
import { artifactUrl } from './artifact-store'

/** A node built from a three.js script: an authored item, or a window or door with a script source. */
export type ScriptedNode = (ItemNode | WindowNode | DoorNode | ColumnNode) & {
  source: NonNullable<ItemNode['source']>
}

export const isScriptedNode = (
  node: { type: string; source?: unknown } | undefined,
): node is ScriptedNode =>
  Boolean(node?.source) &&
  (node!.type === 'item' ||
    node!.type === 'window' ||
    node!.type === 'door' ||
    node!.type === 'column')

/**
 * Merges reuse metadata into a source's, dropping `meta` when nothing is left:
 * the scene carries no empty object.
 */
export function withSourceMeta<S extends { meta?: GeometrySourceMeta }>(
  source: S,
  next: object,
  parent?: string,
): S {
  const { meta: previous, ...rest } = source
  const meta = GeometrySourceMeta.parse({
    ...previous,
    ...Object.fromEntries(
      Object.entries(GeometrySourceMeta.parse(next)).filter(([, value]) => value !== undefined),
    ),
    ...(parent ? { parent } : {}),
  })
  return (Object.keys(meta).length > 0 ? { ...rest, meta } : rest) as S
}

/** The `source` a compile produces, the same on every kind. */
export const scriptSource = (
  compiled: CompiledGeometryScript,
  meta: object = {},
  previous?: ScriptedNode['source'],
) =>
  withSourceMeta(
    {
      kind: 'script' as const,
      meta: previous?.meta,
      language: 'three' as const,
      script: compiled.script,
      params: compiled.params,
      artifact: compiled.sha256,
      // Worker structured clones retain optional undefined fields; durable scene writes are JSON.
      manifest: JSON.parse(JSON.stringify(compiled.manifest)),
    },
    meta,
    // A params-only rebuild runs the same script: its lineage stays where it was.
    previous && previous.script !== compiled.script ? previous.script : undefined,
  )

/**
 * What a scripted object is, for reuse, whatever its kind: the name from the
 * node, an item's category from its asset, the rest from `source.meta`.
 */
export function scriptedObjectMeta(node: ScriptedNode) {
  const { description, category, tags, parent } = node.source.meta ?? {}
  return {
    name: node.name,
    description,
    category: node.type === 'item' ? node.asset.category : category,
    tags,
    parent,
  }
}

/**
 * A scripted node's thumbnail and floor-plan image as `artifact://` URLs, or
 * null until an editor has taken them of the GLB the node shows now.
 */
export function scriptImages(
  node: { type: string; source?: unknown } | undefined,
): { thumbnail: string; floorPlan: string } | null {
  if (!isScriptedNode(node)) return null
  const { images, artifact } = node.source
  if (images?.artifact !== artifact) return null
  return { thumbnail: artifactUrl(images.thumbnail), floorPlan: artifactUrl(images.floorPlan) }
}

type Manifest = CompiledGeometryScript['manifest']

const matchSlot = (slot: Manifest['slots'][number]) =>
  matchPascalMaterial({ ...slot, name: `${slot.id} ${slot.label ?? ''}` })

/**
 * Paint and automatic matching write the same overrides. A rebuild keeps every
 * pick, but a slot still holding what the previous build matched is matched
 * again, so a script edit to that finish shows.
 */
export function matchScriptSlotsToLibrary(
  manifest: Manifest,
  overrides: Record<string, string> = {},
  previous?: Manifest,
): Record<string, string> {
  const slots = { ...overrides }
  for (const slot of manifest.slots) {
    if (Object.hasOwn(overrides, slot.id)) {
      const before = previous?.slots.find((candidate) => candidate.id === slot.id)
      if (!before || overrides[slot.id] !== matchSlot(before)) continue
      delete slots[slot.id]
    }
    const ref = matchSlot(slot)
    if (ref) slots[slot.id] = ref
  }
  return slots
}

/** Width, height and depth of what the script built. */
export function scriptedSize(
  manifest: CompiledGeometryScript['manifest'],
): [number, number, number] {
  const { min, max } = manifest.bounds
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
}

/**
 * Where the script's origin (the bottom centre of what it built) sits in the
 * node's own frame: a window or door is placed by its centre.
 */
export function scriptedOrigin(node: ScriptedNode): [number, number, number] {
  if (node.type !== 'window' && node.type !== 'door') return [0, 0, 0]
  return [0, -scriptedSize(node.source.manifest)[1] / 2, 0]
}

/**
 * The item's controls from what the module emitted: a light switch for its
 * lights, an open/close toggle for an `open` clip (closing plays `close`, or
 * `open` reversed), a `loop` clip that runs throughout, and a play toggle per
 * other clip, labelled with its name. Light offsets are in the node's frame,
 * `origin` being where the script's origin sits in it (`scriptedOrigin`).
 */
export function scriptInteractive(
  manifest: CompiledGeometryScript['manifest'],
  origin: [number, number, number] = [0, 0, 0],
): ItemNode['asset']['interactive'] {
  const controls: NonNullable<ItemNode['asset']['interactive']>['controls'] = []
  const effects: NonNullable<ItemNode['asset']['interactive']>['effects'] = []
  if (manifest.lights.length > 0) {
    controls.push({ kind: 'toggle', label: 'Lights', default: true })
    for (const light of manifest.lights) {
      effects.push({
        kind: 'light',
        color: light.color,
        intensityRange: [0, light.intensity],
        distance: light.distance,
        offset: [
          light.position[0] + origin[0],
          light.position[1] + origin[1],
          light.position[2] + origin[2],
        ],
      })
    }
  }
  const clip = (name: string) => manifest.animations.some((animation) => animation.name === name)
  if (clip('open')) {
    effects.push({
      kind: 'animation',
      mode: 'open-close',
      control: controls.length,
      clips: { on: 'open', off: clip('close') ? 'close' : undefined },
    })
    controls.push({ kind: 'toggle', label: 'Open', default: false })
  }
  if (clip('loop')) effects.push({ kind: 'animation', mode: 'ambient', clips: { loop: 'loop' } })
  // Every other clip gets its own play toggle, labelled with its name.
  for (const { name } of manifest.animations) {
    if (name === 'open' || name === 'close' || name === 'loop') continue
    effects.push({
      kind: 'animation',
      mode: 'ambient',
      control: controls.length,
      clips: { on: name },
    })
    controls.push({ kind: 'toggle', label: name, default: false })
  }
  return effects.length > 0 ? { controls, effects } : undefined
}
