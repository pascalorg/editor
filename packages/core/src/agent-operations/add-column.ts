import type { z } from 'zod'
import type { addColumnTool } from '../agent-tools/columns'
import { refuse } from '../agent-tools/refusal'
import { matchScriptSlotsToLibrary, scriptedSize, scriptSource } from '../lib/geometry-script-node'
import { resettledPosition } from '../lib/geometry-surfaces'
import { ColumnNode, type CompiledGeometryScript, type GeometryScriptParamValue } from '../schema'
import { editedScriptParams, refuseParamsWithoutScript } from './add-object'
import { targetLevel } from './level-target'
import type { AgentOperation } from './types'

export type AddColumnInput = z.infer<z.ZodObject<typeof addColumnTool.input>> & {
  compiled?: CompiledGeometryScript
}

/**
 * The params a column's script compiles with for this edit: native sizes edit
 * the declared params, keeping the module's other values. Undefined when the
 * edit leaves the geometry alone (a rename, a move), so nothing recompiles.
 */
export function columnScriptParams(
  node: ColumnNode | undefined,
  input: {
    code?: string
    params?: Record<string, GeometryScriptParamValue>
    height?: number
    width?: number
    depth?: number
  },
) {
  const sizes = (['height', 'width', 'depth'] as const).filter((key) => input[key] !== undefined)
  if (!(input.code || (node?.source && (input.params || sizes.length > 0)))) return undefined
  const params = { ...editedScriptParams(node, input.params) }
  for (const key of sizes) {
    if (node?.source && !input.code && !node.source.manifest.params.some((spec) => spec.id === key))
      refuse(
        'missing_size_param',
        `This column's script has no ${key} parameter. Rebuild its code to make ${key} editable.`,
        { id: node.id, dimension: key },
      )
    params[key] = input[key]!
  }
  return params
}

export const addColumn: AgentOperation<AddColumnInput> = (nodes, input, context) => {
  const previous = input.nodeId ? nodes[input.nodeId] : undefined
  if (input.nodeId && !previous) refuse('node_not_found', `Node not found: ${input.nodeId}.`)
  if (previous && previous.type !== 'column')
    refuse('not_a_column', `${previous.id} is not a column.`)
  refuseParamsWithoutScript(nodes, input)
  const parent = previous
    ? nodes[previous.parentId!]
    : targetLevel(nodes, { level: input.level }, context)
  if (parent?.type !== 'level') refuse('not_a_level', 'A column belongs to a level.')
  if (!previous && (input.x === undefined || input.z === undefined))
    refuse('position_required', 'Pass x and z for the column support point.')
  const { compiled } = input
  if (compiled && compiled.mount !== 'floor')
    refuse('wrong_mount', "A column's script uses mount 'floor'.")
  const dimensions = compiled ? scriptedSize(compiled.manifest) : undefined
  const {
    nodeId: _,
    code: _code,
    params: _params,
    level: _level,
    compiled: _compiled,
    x,
    y,
    z,
    rotation,
    ...fields
  } = input
  const node = ColumnNode.parse({
    ...previous,
    ...fields,
    name:
      input.name ??
      previous?.name ??
      `Column ${Object.values(nodes).filter((node) => node.type === 'column').length + 1}`,
    parentId: parent.id,
    position: [
      x ?? previous?.position[0] ?? 0,
      y ?? previous?.position[1] ?? 0,
      z ?? previous?.position[2] ?? 0,
    ],
    rotation: rotation === undefined ? previous?.rotation : (rotation * Math.PI) / 180,
    ...(compiled && dimensions
      ? {
          source: scriptSource(compiled),
          slots: matchScriptSlotsToLibrary(
            compiled.manifest,
            previous?.slots,
            previous?.source?.manifest,
          ),
          width: dimensions[0],
          height: dimensions[1],
          depth: dimensions[2],
        }
      : {}),
  })
  const slotIds = new Set(compiled?.manifest.slots.map((slot) => slot.id))
  const orphanedSlots = compiled
    ? Object.keys(previous?.slots ?? {}).filter((id) => !slotIds.has(id))
    : []
  const resettled: { id: string; data: { position: [number, number, number] } }[] = []
  if (compiled && previous) {
    for (const id of previous.children) {
      const child = nodes[id]
      if (child?.type !== 'item' || child.wallId) continue
      const position = resettledPosition(compiled.manifest, child, [1, 1, 1])
      if (position?.some((value, i) => Math.abs(value - child.position[i]!) > 1e-4))
        resettled.push({ id, data: { position } })
    }
  }
  return {
    result: {
      ok: true,
      columnId: node.id,
      nodeId: node.id,
      height: node.height,
      width: node.width,
      depth: node.depth,
      ...(orphanedSlots.length ? { orphanedSlots } : {}),
    },
    changes: previous
      ? { update: [{ id: node.id, data: node }, ...resettled] }
      : { create: [{ node, parentId: parent.id }] },
  }
}
