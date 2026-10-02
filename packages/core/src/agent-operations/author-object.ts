import { refuse } from '../agent-tools/refusal'
import { artifactUrl } from '../lib/artifact-store'
import {
  isScriptedNode,
  type ScriptedNode,
  scriptedSize,
  scriptInteractive,
  scriptSource,
} from '../lib/geometry-script-node'
import { geometryRestingHeight, resettledPosition } from '../lib/geometry-surfaces'
import {
  type AnyNode,
  type CompiledGeometryScript,
  type DoorNode,
  type GeometryScriptMount,
  type GeometryScriptParamValue,
  generateId,
  ItemNode,
  type WindowNode,
} from '../schema'
import { targetLevel } from './level-target'
import type { AgentOperation } from './types'

type Vec3 = [number, number, number]

export type AuthorObjectInput = {
  /** Absent for a params-only edit: the host compiled the object's stored script. */
  code?: string
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

const round = (value: number) => Math.round(value * 1000) / 1000

function summary(node: { id: string }, compiled: CompiledGeometryScript, orphanedSlots: string[]) {
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
  const rotation: Vec3 | undefined =
    input.rotation === undefined ? undefined : [0, (input.rotation * Math.PI) / 180, 0]

  if (input.nodeId) {
    // New code may also give a native window or door its script; params alone need one already.
    const previous = input.code
      ? scriptTarget(nodes, input.nodeId)
      : authoredObject(nodes, input.nodeId)
    const slotIds = new Set(compiled.manifest.slots.map((slot) => slot.id))
    const orphanedSlots = Object.keys(previous.slots ?? {}).filter((id) => !slotIds.has(id))
    if (previous.type !== 'item') {
      // A window or door keeps its place on the wall and its bottom edge; its size is what the script built.
      if (compiled.mount !== 'wall')
        refuse('wrong_mount', `A ${previous.type}'s script uses mount 'wall'.`, {
          mount: compiled.mount,
        })
      const [width, height] = scriptedSize(compiled.manifest)
      // Given a position, that is where it goes; otherwise its bottom edge stays put.
      const [x, y, z] = previous.position
      const position: Vec3 = (input.position as Vec3 | undefined) ?? [
        x,
        y - previous.height / 2 + height / 2,
        z,
      ]
      return {
        result: summary(previous, compiled, orphanedSlots),
        changes: {
          update: [
            {
              id: previous.id,
              data: {
                name: input.name ?? previous.name,
                source: scriptSource(compiled),
                width,
                height,
                position,
              },
            },
          ],
        },
      }
    }
    const next = ItemNode.parse({
      ...previous,
      name: input.name ?? previous.name,
      position: (input.position as Vec3 | undefined) ?? previous.position,
      rotation: rotation ?? previous.rotation,
      side: input.side ?? previous.side,
      source: scriptSource(compiled),
      asset: scriptAsset(compiled, input, previous.asset),
    })
    // Children resting on or hanging from the object follow its new geometry.
    const resettled: { id: string; position: Vec3 }[] = []
    for (const childId of previous.children) {
      const child = nodes[childId]
      if (child?.type !== 'item' || child.wallId) continue
      const position = resettledPosition(compiled.manifest, child, next.scale)
      if (!position || position.every((v, i) => Math.abs(v - child.position[i]!) < 1e-4)) continue
      resettled.push({ id: child.id, position })
    }
    return {
      result: {
        ...summary(next, compiled, orphanedSlots),
        ...(resettled.length > 0 ? { resettled: resettled.map((entry) => entry.id) } : {}),
      },
      changes: {
        update: [
          { id: next.id, data: next },
          ...resettled.map(({ id, position }) => ({ id, data: { position } })),
        ],
      },
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
    source: scriptSource(compiled),
    asset,
  })
  return {
    result: summary(node, compiled, []),
    changes: { create: [{ node, parentId: parent.id }] },
  }
}

/** The scripted node `read_source` and a params-only rebuild act on, or a refusal. */
export function authoredObject(nodes: Record<string, AnyNode>, nodeId: string): ScriptedNode {
  const node = nodes[nodeId]
  if (!node) refuse('node_not_found', `Node not found: ${nodeId}.`, { id: nodeId })
  if (!isScriptedNode(node))
    refuse(
      'not_authored',
      `${nodeId} is a ${node.type} without a script; only objects, windows and doors built from code have one.`,
      { id: nodeId, type: node.type },
    )
  return node
}

/** What `author_object` with new code may edit: a scripted node, or a window or door taking its first script. */
function scriptTarget(
  nodes: Record<string, AnyNode>,
  nodeId: string,
): ScriptedNode | WindowNode | DoorNode {
  const node = nodes[nodeId]
  if (node?.type === 'window' || node?.type === 'door') return node
  return authoredObject(nodes, nodeId)
}

/** What `read_source` answers once the host has the module's text. */
export function readSourceResult(node: ScriptedNode, code: string) {
  return {
    nodeId: node.id,
    type: node.type,
    name: node.name,
    code,
    params: node.source.manifest.params.map((spec) => ({
      ...spec,
      value: node.source.params[spec.id] ?? spec.default,
    })),
  }
}
