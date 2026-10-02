import { refuse } from '../agent-tools/refusal'
import { artifactUrl } from '../lib/artifact-store'
import { geometryRestingHeight } from '../lib/geometry-surfaces'
import {
  type AnyNode,
  type CompiledGeometryScript,
  type GeometryScriptMount,
  type GeometryScriptParamValue,
  generateId,
  ItemNode,
} from '../schema'
import { targetLevel } from './level-target'
import type { AgentOperation } from './types'

type Vec3 = [number, number, number]

/** How many named parts one object may carry; past this it is several objects. */
export const AUTHORED_OBJECT_MAX_PARTS = 64

export type AuthorObjectInput = {
  code: string
  params?: Record<string, GeometryScriptParamValue>
  nodeId?: string
  parentId?: string
  position?: number[]
  /** Degrees about Y, as the contract parses it. */
  rotation?: number
  side?: 'front' | 'back'
  name?: string
  category?: string
  /** What the surface's compile produced from `code` (compiled before the operation runs). */
  compiled: CompiledGeometryScript
}

const ATTACH: Record<GeometryScriptMount, ItemNode['asset']['attachTo']> = {
  floor: undefined,
  wall: 'wall',
  'wall-side': 'wall-side',
  ceiling: 'ceiling',
}

const HOSTS: Record<GeometryScriptMount, readonly AnyNode['type'][]> = {
  floor: ['level', 'item'],
  wall: ['wall'],
  'wall-side': ['wall'],
  ceiling: ['ceiling'],
}

/**
 * The item's controls from what the module emitted: a light switch for its
 * lights, an open/close toggle for an `open` clip (closing plays `close`, or
 * `open` reversed), a `loop` clip that runs throughout, and a play toggle per
 * other clip, labelled with its name.
 */
function scriptInteractive(
  manifest: CompiledGeometryScript['manifest'],
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
        offset: light.position,
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

function scriptAsset(
  compiled: CompiledGeometryScript,
  input: AuthorObjectInput,
  previous: ItemNode['asset'] | undefined,
): ItemNode['asset'] {
  const { min, max } = compiled.manifest.bounds
  const restingHeight = geometryRestingHeight(compiled.manifest)
  return {
    id: `script_${compiled.sha256.slice(0, 16)}`,
    category: input.category ?? previous?.category ?? 'object',
    name: input.name ?? previous?.name ?? 'Authored object',
    thumbnail: previous?.thumbnail ?? '',
    source: 'mine',
    src: artifactUrl(compiled.sha256),
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    attachTo: ATTACH[compiled.mount],
    surface: restingHeight === null ? undefined : { height: restingHeight },
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    interactive: scriptInteractive(compiled.manifest),
  }
}

const scriptSource = (compiled: CompiledGeometryScript, code: string) => ({
  kind: 'script' as const,
  language: 'three' as const,
  code,
  params: compiled.params,
  artifact: compiled.sha256,
  manifest: compiled.manifest,
})

const round = (value: number) => Math.round(value * 1000) / 1000

function summary(node: ItemNode, compiled: CompiledGeometryScript, orphanedSlots: string[]) {
  const { bounds, parts, slots, lights, params, triangles, cutout, animations } = compiled.manifest
  return {
    nodeId: node.id,
    mount: compiled.mount,
    size: bounds.max.map((v, i) => round(v - bounds.min[i]!)),
    parts: parts.map((part) => (part.type ? `${part.id} (${part.type})` : part.id)),
    slots: slots.map((slot) => slot.id),
    lights: lights.map((light) => light.id),
    animations: animations.map((clip) => clip.name),
    params: params.map((spec) => ({ ...spec, value: compiled.params[spec.id] })),
    cutout,
    triangles,
    ...(orphanedSlots.length > 0
      ? {
          orphanedSlots,
          note: `Paint on ${orphanedSlots.join(', ')} is kept but no longer shows: the new output has no slot with that id.`,
        }
      : {}),
  }
}

/**
 * `author_object`: the item a compiled three.js module becomes. Not in
 * AGENT_OPERATIONS: each surface compiles `code` first (the chat in its
 * worker, the MCP on the server) and passes the result as `compiled`.
 * The artifact is referenced by hash and its bounds become the item's dimensions; editing
 * keeps the item's identity, placement, children and paint.
 */
export const authorObject: AgentOperation<AuthorObjectInput> = (nodes, input, context) => {
  const { compiled } = input
  if (compiled.manifest.parts.length > AUTHORED_OBJECT_MAX_PARTS) {
    refuse(
      'too_many_parts',
      `The object has ${compiled.manifest.parts.length} parts; at most ${AUTHORED_OBJECT_MAX_PARTS}. Group detail into fewer parts, or build separate objects for things that are separate.`,
      { parts: compiled.manifest.parts.length },
    )
  }
  const rotation: Vec3 | undefined =
    input.rotation === undefined ? undefined : [0, (input.rotation * Math.PI) / 180, 0]

  if (input.nodeId) {
    const previous = nodes[input.nodeId]
    if (!previous)
      refuse('node_not_found', `Node not found: ${input.nodeId}.`, { id: input.nodeId })
    if (previous.type !== 'item' || !previous.source) {
      refuse(
        'not_authored',
        `${input.nodeId} is a ${previous.type} without a script; only objects built with author_object can be edited this way.`,
        { id: input.nodeId, type: previous.type },
      )
    }
    const slotIds = new Set(compiled.manifest.slots.map((slot) => slot.id))
    const orphanedSlots = Object.keys(previous.slots ?? {}).filter((id) => !slotIds.has(id))
    const next = ItemNode.parse({
      ...previous,
      name: input.name ?? previous.name,
      position: (input.position as Vec3 | undefined) ?? previous.position,
      rotation: rotation ?? previous.rotation,
      side: input.side ?? previous.side,
      source: scriptSource(compiled, input.code),
      asset: scriptAsset(compiled, input, previous.asset),
    })
    return {
      result: summary(next, compiled, orphanedSlots),
      changes: { update: [{ id: next.id, data: next }] },
    }
  }

  const parent = input.parentId ? nodes[input.parentId] : targetLevel(nodes, {}, context)
  if (!parent)
    refuse('node_not_found', `Node not found: ${input.parentId}.`, { id: input.parentId })
  const hosts = HOSTS[compiled.mount]
  if (!hosts.includes(parent.type)) {
    refuse(
      'wrong_host',
      `A ${compiled.mount} object goes on a ${hosts.join(' or ')}, not on a ${parent.type}. Pass parentId of a ${hosts[0]}, or change \`mount\`.`,
      { mount: compiled.mount, parentType: parent.type },
    )
  }
  const asset = scriptAsset(compiled, input, undefined)
  const node = ItemNode.parse({
    object: 'node',
    id: generateId('item'),
    type: 'item',
    name: input.name ?? asset.name,
    parentId: parent.id,
    ...(parent.type === 'wall' ? { wallId: parent.id, side: input.side ?? 'front' } : {}),
    position: (input.position as Vec3 | undefined) ?? [0, 0, 0],
    rotation: rotation ?? [0, 0, 0],
    source: scriptSource(compiled, input.code),
    asset,
  })
  return {
    result: summary(node, compiled, []),
    changes: { create: [{ node, parentId: parent.id }] },
  }
}
