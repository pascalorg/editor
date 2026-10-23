import { z } from 'zod'
import { addObjectTool } from '../agent-tools/add-object'
import { isAgentRefusal, refuse } from '../agent-tools/refusal'
import { CATALOG_SOURCE } from '../agent-tools/sources'
import { artifactUrl } from '../lib/artifact-store'
import {
  isScriptedNode,
  matchScriptSlotsToLibrary,
  requireMeasured,
  type ScriptedNode,
  scriptedSize,
  scriptInteractive,
  scriptSource,
} from '../lib/geometry-script-node'
import { geometryRestingHeight, resettledPosition } from '../lib/geometry-surfaces'
import { area, intersection, union } from '../lib/polygon-boolean'
import {
  type AnyNode,
  type CompiledGeometryScript,
  type GeometryScriptLanguage,
  type GeometryScriptMount,
  type GeometryScriptParamValue,
  generateId,
  ItemNode,
  type SlabNode,
  type WallFace,
} from '../schema'
import { achievedChanges } from './achieved'
import { targetLevel } from './level-target'
import { roofLevelRefusal } from './roof-writes'
import { queryNodes } from './scene-queries'
import type { AgentOperation, BatchedObject, SceneNodes } from './types'

type Vec3 = [number, number, number]

export type AddObjectInput = {
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
  description?: string
  tags?: string[]
  category?: string
  /** What the object stands in for; kept in `metadata.reason`, listed by verify_scene. */
  reason?: string
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
  input: AddObjectInput,
  previous: ItemNode['asset'] | undefined,
): ItemNode['asset'] {
  const { min, max } = compiled.manifest.bounds
  const restingHeight = geometryRestingHeight(compiled.manifest)
  const attachTo = ATTACH[compiled.mount]
  const interactive = scriptInteractive(compiled.manifest)
  return {
    id: `script_${compiled.sha256.slice(0, 16)}`,
    category: input.category ?? previous?.category ?? 'object',
    name: input.name ?? previous?.name ?? 'Authored object',
    thumbnail: previous?.thumbnail ?? '',
    source: 'mine',
    src: artifactUrl(compiled.sha256),
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    ...(attachTo ? { attachTo } : {}),
    ...(restingHeight === null ? {} : { surface: { height: restingHeight } }),
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...(interactive ? { interactive } : {}),
  }
}

/**
 * Words that name what Pascal already builds, with the tool that builds it. An object named so is
 * built with a hint naming that tool: authored objects are for what has no type.
 */
export const PASCAL_TYPES: [RegExp, string][] = [
  [/\bwalls?\b/i, 'walls: add_wall'],
  [
    /\b(slabs?|floor plates?|floors?)\b/i,
    'a floor: rooms make their floor plates (create_room), shaped by set_room_floor_construction or set_floor_foundation',
  ],
  [
    /\b(doors?|windows?|sills?|glazing)\b/i,
    'add_door / add_window (with code for a design their fields cannot express)',
  ],
  [/\b(stairs?|staircases?)\b/i, 'create_stair'],
  [/\broofs?\b/i, 'create_roof'],
  [/\b(rooms?|zones?|apartments?)\b/i, 'rooms: create_room'],
]

/**
 * What a label names: the last word of its main phrase. "entry door pull handle (brass)" is a
 * handle; "door" only says which one (it was once refused as a door).
 */
function headWord(label: string) {
  const phrase = label.split(/\(|,|\s[-–—]\s|\sof\s/i)[0]!.trim()
  return phrase.split(/\s+/).at(-1) ?? phrase
}

/**
 * The tool for an object named after something Pascal builds: an invitation, not a gate. A word
 * gate taught evasion: refused "entry door pull handle (brass)", the agent relabelled it "brass
 * pull bars", and the label stopped naming the gap.
 */
function typeHint(input: AddObjectInput): string | undefined {
  for (const label of [input.name, input.category]) {
    const named = label && PASCAL_TYPES.find(([word]) => word.test(headWord(label)))
    if (named) return `"${label}" is something Pascal builds: ${named[1]}.`
  }
  return undefined
}

/** A wall's box: thin, a metre long or more, two metres high or more. */
function wallSized(compiled: CompiledGeometryScript) {
  const [width, height, depth] = scriptedSize(compiled.manifest)
  return Math.min(width, depth) <= 0.45 && Math.max(width, depth) >= 1 && height >= 2
}

/** A plain box: one cuboid, as a wall is. A bookcase or a screen has shelves or holes. */
const PLAIN_BOX = 12

/** A plate with at least this share of its footprint over a floor lies on that floor. */
const FLOOR_SHARE = 0.5

/**
 * The share of a plate's footprint that lies over a floor of its level: the slabs the level owns (a
 * room's floor plate, a drawn slab, a deck) with their holes left out. The footprint is the bounds
 * the compile measured, turned and placed as the object will be.
 */
function shareOverFloor(
  nodes: SceneNodes,
  levelId: string,
  compiled: CompiledGeometryScript,
  input: AddObjectInput,
) {
  const slabs = queryNodes<SlabNode>(nodes, { type: 'slab', parentId: levelId })
  const { min, max } = compiled.manifest.bounds
  const footprintArea = (max[0] - min[0]) * (max[2] - min[2])
  if (slabs.length === 0 || !(footprintArea > 0)) return 0
  const [px = 0, , pz = 0] = input.position ?? []
  const turn = ((input.rotation ?? 0) * Math.PI) / 180
  const [cos, sin] = [Math.cos(turn), Math.sin(turn)]
  const corners: [number, number][] = [
    [min[0], min[2]],
    [max[0], min[2]],
    [max[0], max[2]],
    [min[0], max[2]],
  ]
  const footprint = corners.map(([u, v]): [number, number] => [
    px + u * cos + v * sin,
    pz - u * sin + v * cos,
  ])
  const floor = union(slabs.map((slab) => ({ outer: slab.polygon, holes: slab.holes ?? [] })))
  return area(intersection(footprint, floor)) / footprintArea
}

/**
 * A floor object that is a plain box with a wall's size, or a floor plate with no floor under it, is
 * refused: Pascal builds those, and rooms, openings and facades only work with its own. Production
 * saw whole houses of plain custom solids, nothing editable as walls, rooms or doors. A flat object
 * over a floor the level already has is furniture, a rug: the scene decides, not its name.
 */
function refuseWallOrSlabShape(
  nodes: SceneNodes,
  levelId: string,
  compiled: CompiledGeometryScript,
  input: AddObjectInput,
) {
  const [width, height, depth] = scriptedSize(compiled.manifest)
  const long = Math.max(width, depth)
  const short = Math.min(width, depth)
  const label = input.name ?? input.category ?? 'The object'
  if (wallSized(compiled) && compiled.manifest.triangles <= PLAIN_BOX)
    refuse(
      'use_walls',
      `"${label}" (${long.toFixed(2)} × ${short.toFixed(2)} m, ${height.toFixed(2)} m high) is a plain box with a wall's size: build it with add_wall so rooms, openings and facades work with it.`,
      { label },
    )
  const base = input.position?.[1] ?? 0
  if (
    height <= 0.35 &&
    short >= 2 &&
    base <= 0.05 &&
    shareOverFloor(nodes, levelId, compiled, input) < FLOOR_SHARE
  ) {
    // Its extent along x and z as it stands, so the numbers match the outline the agent drew.
    const turn = ((input.rotation ?? 0) * Math.PI) / 180
    const [c, s] = [Math.abs(Math.cos(turn)), Math.abs(Math.sin(turn))]
    const [x, z] = [width * c + depth * s, width * s + depth * c]
    refuse(
      'use_slab',
      `"${label}" (${x.toFixed(2)} × ${z.toFixed(2)} m in x and z, ${height.toFixed(2)} m thick, on the floor) is a floor plate: build it as a slab.`,
      { label },
    )
  }
}

/** An item's category lives on its asset, so its source meta leaves it out. */
const itemSourceMeta = ({ category: _, ...input }: AddObjectInput) => input

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
 * `add_object`: the item a compiled three.js module becomes. Not in
 * AGENT_OPERATIONS: each surface compiles `code` first (the chat in its
 * worker, the MCP on the server) and passes the result as `compiled`.
 * The artifact is referenced by hash and its bounds become the item's dimensions; editing
 * keeps the item's identity, placement, children, paint and reason. Only a new object is judged
 * by its shape and must give a reason: the editor's inspector rebuilds through the edit path.
 */
/**
 * A new object says what it stands in for. Hosts check it before running the script: a missing
 * reason refused after the compile has run it and stored its artifacts for nothing.
 */
export function requireAddObjectReason(input: { nodeId?: string; reason?: string }) {
  if (!input.nodeId && !input.reason?.trim())
    refuse(
      'reason_required',
      'Give its design intent (reason): why the authored shape, size or style suits the request. The scene check lists every authored object with its reason; no catalog-exhaustion proof is required.',
    )
}

export const addObject: AgentOperation<AddObjectInput> = (nodes, input, context) => {
  const { compiled } = input
  requireMeasured(compiled, { label: input.name, nodeId: input.nodeId, tool: 'add_object' })
  const rotation: Vec3 | undefined =
    input.rotation === undefined ? undefined : [0, (input.rotation * Math.PI) / 180, 0]

  if (input.nodeId) {
    if (nodes[input.nodeId]?.type === 'column')
      refuse('use_column_tool', `Rebuild ${input.nodeId} with add_column and nodeId.`, {
        id: input.nodeId,
        type: 'column',
      })
    const previous = authoredObject(nodes, input.nodeId)
    if (previous.type !== 'item')
      refuse(
        'use_opening_tool',
        `${previous.id} is a ${previous.type}: rebuild it with add_${previous.type} and nodeId.`,
        { id: previous.id, type: previous.type },
      )
    const slotIds = new Set(compiled.manifest.slots.map((slot) => slot.id))
    const orphanedSlots = Object.keys(previous.slots ?? {}).filter((id) => !slotIds.has(id))
    const next = ItemNode.parse({
      ...previous,
      name: input.name ?? previous.name,
      position: (input.position as Vec3 | undefined) ?? previous.position,
      rotation: rotation ?? previous.rotation,
      ...(input.side === undefined ? {} : { side: input.side }),
      source: scriptSource(compiled, itemSourceMeta(input), previous.source),
      slots: matchScriptSlotsToLibrary(
        compiled.manifest,
        previous.slots,
        previous.source?.manifest,
      ),
      asset: scriptAsset(compiled, input, previous.asset),
      ...(input.reason ? { metadata: { ...previous.metadata, reason: input.reason } } : {}),
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
  if (compiled.mount === 'floor' && parent.type === 'level') {
    // Given no host while the roof level is in view (a roof just placed selects it), the object
    // belongs on the storey it covers; one named onto the roof level goes up with the roof (a
    // chimney cap, a gable louvre).
    const onRoofLevel = input.parentId
      ? null
      : roofLevelRefusal(nodes, parent.id, `"${input.name ?? 'the object'}"`)
    if (onRoofLevel) throw onRoofLevel
    refuseWallOrSlabShape(nodes, parent.id, compiled, input)
  }
  requireAddObjectReason(input)
  const asset = scriptAsset(compiled, input, undefined)
  const node = ItemNode.parse({
    object: 'node',
    id: compiled.nodeId ?? generateId('item'),
    type: 'item',
    name: input.name ?? asset.name,
    parentId: parent.id,
    ...(parent.type === 'wall' ? { wallId: parent.id, side: input.side ?? 'front' } : {}),
    position: (input.position as Vec3 | undefined) ?? [0, 0, 0],
    rotation: rotation ?? [
      0,
      compiled.mount === 'wall-side' && input.side === 'back' ? Math.PI : 0,
      0,
    ],
    source: scriptSource(compiled, itemSourceMeta(input)),
    slots: matchScriptSlotsToLibrary(compiled.manifest),
    asset,
    metadata: { reason: input.reason },
  })
  const hint = [
    typeHint(input),
    compiled.mount === 'floor' &&
      wallSized(compiled) &&
      `It has a wall's size: if it is a wall, add_wall builds it so rooms, openings and facades work with it.`,
  ]
    .filter(Boolean)
    .join(' ')
  return {
    result: { ...summary(node, compiled, []), ...(hint ? { hint } : {}) },
    changes: { create: [{ node, parentId: parent.id }] },
  }
}

/**
 * `add_object` inside run_batch: the batch's host built the module before the batch ran (a compile
 * is async, the operations are not), and the call places what was built, with the receipt a lone
 * add_object gives.
 */
export const addObjectInBatch: AgentOperation<Omit<AddObjectInput, 'compiled'>> = (
  nodes,
  input,
  context,
) => {
  const built =
    context.batchCall === undefined ? undefined : context.batchObjects?.[context.batchCall]
  if (!built)
    refuse(
      'object_not_built',
      "This host did not build the batch's add_object calls: call add_object on its own.",
    )
  if ('failure' in built) refuse(built.failure.code, built.failure.message)
  const outcome = addObject(nodes, { ...input, compiled: built.compiled }, context)
  return {
    ...outcome,
    result: { ...outcome.result, achieved: achievedChanges(nodes, outcome.changes ?? {}) },
  }
}

/** How many modules of one batch a host compiles at once. */
const BATCH_COMPILES_AT_ONCE = 3

/**
 * Builds the module of every add_object call of a batch with the host's own compile, a few at a
 * time, by call index. A call that fails (a reason missing, a script that does not run, a host
 * that refuses) is kept with its own message, so the batch reports it and the others stand. A call
 * whose input does not parse is left out: the batch refuses it with the contract's message.
 */
export async function buildBatchObjects(
  calls: readonly { tool?: unknown; input?: unknown }[],
  build: (input: Omit<AddObjectInput, 'compiled'>) => Promise<CompiledGeometryScript>,
): Promise<Record<number, BatchedObject>> {
  const parse = z.object(addObjectTool.input)
  const built: Record<number, BatchedObject> = {}
  const edited = new Set<string>()
  const jobs = calls.flatMap((call, index) => {
    if (call?.tool !== addObjectTool.name) return []
    const parsed = parse.safeParse(call.input ?? {})
    if (!parsed.success) return []
    const input = parsed.data as Omit<AddObjectInput, 'compiled'>
    if (input.nodeId) {
      if (edited.has(input.nodeId)) {
        built[index] = {
          failure: {
            code: 'object_edit_conflict',
            message: `${input.nodeId} is edited more than once in this batch: combine its changes in one add_object call, or edit it in separate calls. Modules are compiled before the batch runs.`,
          },
        }
        return []
      }
      edited.add(input.nodeId)
    }
    return [{ index, input }]
  })
  let next = 0
  const worker = async () => {
    for (let job = jobs[next++]; job; job = jobs[next++]) {
      try {
        requireAddObjectReason(job.input)
        built[job.index] = { compiled: await build(job.input) }
      } catch (error) {
        built[job.index] = {
          failure: isAgentRefusal(error)
            ? { code: error.code, message: error.message }
            : {
                code: 'script_failed',
                message: `${error instanceof Error ? error.message : String(error)} ${CATALOG_SOURCE}`,
              },
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_COMPILES_AT_ONCE, jobs.length) }, worker))
  return built
}

export type RescriptOpeningInput = {
  description?: string
  category?: string
  tags?: string[]
  nodeId: string
  /** Where it goes; without one its bottom edge stays put. */
  position?: number[]
  name?: string
  /** What the host compiled: new code, or the stored script with new params. */
  compiled: CompiledGeometryScript
}

/**
 * `add_window` / `add_door` with a nodeId: a window or door built from (or
 * given) a script, rebuilt from what the host compiled. Its size is what the
 * script built; marks, hosting and the opening's own fields are kept.
 */
export const rescriptOpening: AgentOperation<RescriptOpeningInput> = (nodes, input) => {
  const { compiled } = input
  const previous = nodes[input.nodeId]
  if (!previous) refuse('node_not_found', `Node not found: ${input.nodeId}.`, { id: input.nodeId })
  if (previous.type !== 'window' && previous.type !== 'door')
    refuse('not_an_opening', `${input.nodeId} is a ${previous.type}, not a window or door.`, {
      id: input.nodeId,
      type: previous.type,
    })
  const slotIds = new Set(compiled.manifest.slots.map((slot) => slot.id))
  const orphanedSlots = Object.keys(previous.slots ?? {}).filter((id) => !slotIds.has(id))
  // A window or door keeps its place on the wall and its bottom edge; its size is what the script built.
  if (compiled.mount !== 'wall')
    refuse('wrong_mount', `A ${previous.type}'s script uses mount 'wall'.`, {
      mount: compiled.mount,
    })
  requireMeasured(compiled, {
    label: input.name ?? previous.name,
    nodeId: input.nodeId,
    tool: `add_${previous.type}`,
  })
  const [width, height] = scriptedSize(compiled.manifest)
  // Given a position, that is where it goes; otherwise its bottom edge stays put.
  const [x, y, z] = previous.position
  const placed: Vec3 = (input.position as Vec3 | undefined) ?? [
    x,
    y - previous.height / 2 + height / 2,
    z,
  ]
  // A wider rebuild stays on its wall, as a new opening does.
  const wall = previous.wallId ? nodes[previous.wallId] : undefined
  const wallLength =
    wall?.type === 'wall' ? Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) : 0
  const position: Vec3 =
    wallLength >= width
      ? [Math.min(wallLength - width / 2, Math.max(width / 2, placed[0])), placed[1], placed[2]]
      : placed
  return {
    result: summary(previous, compiled, orphanedSlots),
    changes: {
      update: [
        {
          id: previous.id,
          data: {
            name: input.name ?? previous.name,
            source: scriptSource(compiled, input, previous.source),
            slots: matchScriptSlotsToLibrary(
              compiled.manifest,
              previous.slots,
              previous.source?.manifest,
            ),
            width,
            height,
            position,
          },
        },
      ],
    },
  }
}

/**
 * The param values a rebuild of `node` compiles with: its current ones under the
 * edit's. The compile then keeps only what the module declares, clamps numbers to
 * their new range and gives a param new to the code, or one whose type changed,
 * its default. A node without a script just takes the edit's.
 */
export function editedScriptParams(
  node: AnyNode | undefined,
  params: Record<string, GeometryScriptParamValue> | undefined,
): Record<string, GeometryScriptParamValue> | undefined {
  return isScriptedNode(node) ? { ...node.source.params, ...params } : params
}

/**
 * The language a build of `node` runs in: new code's own (the node's when not
 * given), and the stored script's for a params-only rebuild.
 */
export function editedScriptLanguage(
  node: AnyNode | undefined,
  input: { code?: string; language?: GeometryScriptLanguage },
): GeometryScriptLanguage {
  const stored = isScriptedNode(node) ? node.source.language : 'three'
  return input.code ? (input.language ?? stored) : stored
}

/** The scripted node `get_source` and a params-only rebuild act on, or a refusal. */
export function authoredObject(nodes: Record<string, AnyNode>, nodeId: string): ScriptedNode {
  const node = nodes[nodeId]
  if (!node) refuse('node_not_found', `Node not found: ${nodeId}.`, { id: nodeId })
  if (!isScriptedNode(node))
    refuse(
      'not_authored',
      `${nodeId} is a ${node.type} without a script; only objects, windows, doors and columns built from code have one.`,
      { id: nodeId, type: node.type },
    )
  return node
}

/**
 * Params are a script's values: without code, only a node already built from a
 * script has one to rerun, so a new node, or one without a script, is refused.
 */
export function refuseParamsWithoutScript(
  nodes: Record<string, AnyNode>,
  input: { code?: string; params?: unknown; nodeId?: string },
): void {
  if (!input.params || input.code) return
  if (!input.nodeId)
    refuse('not_authored', 'Pass code with params: they are values for its script.')
  authoredObject(nodes, input.nodeId)
}

/** The native size a scripted window, door or column takes from what its script built. */
const SCRIPTED_SIZE: Partial<Record<ScriptedNode['type'], readonly string[]>> = {
  window: ['width', 'height'],
  door: ['width', 'height'],
  column: ['width', 'height', 'depth'],
}

/**
 * Why a raw update (chat `update_node`, MCP `apply_patch`) may not write what a
 * node's script owns, its `source` or the size it built, or null: the stored
 * fields would no longer match the geometry. Restating the current value passes.
 */
export function scriptedFieldRefusal(node: AnyNode, data: Record<string, unknown>): string | null {
  if (!isScriptedNode(node)) return null
  const owned = ['source', ...(SCRIPTED_SIZE[node.type] ?? [])]
  const current = node as unknown as Record<string, unknown>
  const fields = owned.filter(
    (key) => key in data && JSON.stringify(data[key]) !== JSON.stringify(current[key]),
  )
  if (fields.length === 0) return null
  const tool = node.type === 'item' ? 'add_object' : `add_${node.type}`
  return `${node.id} is built from a script, so ${fields.join(', ')} ${fields.length === 1 ? 'comes' : 'come'} from it: rebuild it with ${tool} with nodeId and params (get_source shows them); nothing was changed.`
}

/** What `get_source` reads: a scripted node, a room's floor script, or a wall face's script. */
export type ScriptReadable = Pick<ScriptedNode, 'name' | 'source'> & {
  id: string
  type: ScriptedNode['type'] | 'zone' | 'wall'
  /** The wall face whose script it is. */
  face?: WallFace
}

/**
 * The script `get_source` reads at `nodeId`: an authored object's, a room's floor script by its
 * zone id, or a wall's face script (`face`, which a wall with one scripted face may leave out).
 */
export function readableScript(
  nodes: Record<string, AnyNode>,
  nodeId: string,
  face?: WallFace,
): ScriptReadable {
  const node = nodes[nodeId]
  if (node?.type === 'wall') {
    const faces = (['a', 'b'] as const).filter((side) => node.finishScripts?.[side])
    const read = face ?? (faces.length === 1 ? faces[0] : undefined)
    if (!faces.length)
      refuse('not_authored', `${node.name || nodeId} has no face script.`, { id: nodeId })
    if (!read)
      refuse(
        'face_required',
        `Both faces of ${node.name || nodeId} have a script: name the face, a or b.`,
        {
          id: nodeId,
          faces,
        },
      )
    const source = node.finishScripts?.[read]
    if (!source)
      refuse(
        'not_authored',
        `Face ${read} of ${node.name || nodeId} has no script; face ${faces[0]} has.`,
        {
          id: nodeId,
          faces,
        },
      )
    return { id: node.id, type: 'wall', name: node.name, source, face: read }
  }
  if (node?.type !== 'zone') return authoredObject(nodes, nodeId)
  if (!node.floor?.script)
    refuse('not_authored', `${node.name || nodeId} has no floor script.`, { id: nodeId })
  return { id: node.id, type: 'zone', name: node.name, source: node.floor.script }
}

/** What `get_source` answers once the host has the module's text. */
export function readSourceResult(node: ScriptReadable, code: string) {
  return {
    nodeId: node.id,
    type: node.type,
    ...(node.face ? { face: node.face } : {}),
    name: node.name,
    language: node.source.language,
    code,
    params: node.source.manifest.params.map((spec) => ({
      ...spec,
      value: node.source.params[spec.id] ?? spec.default,
    })),
  }
}
