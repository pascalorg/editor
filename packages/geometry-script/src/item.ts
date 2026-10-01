import {
  type AnyNode,
  artifactUrl,
  type GeometryScriptParamValue,
  generateId,
  ItemNode,
} from '@pascal-app/core'
import type { GeometryScriptCompileOutput, GeometryScriptMount } from './compile'

type Vec3 = [number, number, number]

export type ScriptItemFields = {
  code: string
  name?: string
  /** What the object is ("column", "lantern", "transom"): the item's category. */
  category?: string
  position?: Vec3
  rotation?: Vec3
  /** Which wall face a wall-side object sits on. */
  side?: 'front' | 'back'
}

const ATTACH: Record<GeometryScriptMount, ItemNode['asset']['attachTo']> = {
  floor: undefined,
  wall: 'wall',
  'wall-side': 'wall-side',
  ceiling: 'ceiling',
}

function scriptAsset(
  output: GeometryScriptCompileOutput,
  fields: ScriptItemFields,
  previous: ItemNode['asset'] | undefined,
): ItemNode['asset'] {
  const { min, max } = output.manifest.bounds
  const lights = output.manifest.lights
  return {
    id: `script_${output.sha256.slice(0, 16)}`,
    category: fields.category ?? previous?.category ?? 'object',
    name: fields.name ?? previous?.name ?? 'Scripted object',
    thumbnail: previous?.thumbnail ?? '',
    source: 'mine',
    src: artifactUrl(output.sha256),
    dimensions: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    attachTo: ATTACH[output.mount],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    interactive:
      lights.length > 0
        ? {
            controls: [{ kind: 'toggle', label: 'Lights', default: true }],
            effects: lights.map((light) => ({
              kind: 'light' as const,
              color: light.color,
              intensityRange: [0, light.intensity] as [number, number],
              distance: light.distance,
              offset: light.position,
            })),
          }
        : undefined,
  }
}

function scriptSource(output: GeometryScriptCompileOutput, code: string) {
  return {
    kind: 'script' as const,
    language: 'three' as const,
    code,
    params: output.params as Record<string, GeometryScriptParamValue>,
    artifact: output.sha256,
    manifest: output.manifest,
  }
}

/**
 * The item a compiled script becomes: it references the artifact by hash and
 * takes its bounds as dimensions; lights become the item's light effects.
 */
export function createScriptItem(
  output: GeometryScriptCompileOutput,
  fields: ScriptItemFields,
  parent: AnyNode,
): ItemNode {
  const asset = scriptAsset(output, fields, undefined)
  return ItemNode.parse({
    object: 'node',
    id: generateId('item'),
    type: 'item',
    name: fields.name ?? asset.name,
    parentId: parent.id,
    ...(parent.type === 'wall' ? { wallId: parent.id, side: fields.side ?? 'front' } : {}),
    position: fields.position ?? [0, 0, 0],
    rotation: fields.rotation ?? [0, 0, 0],
    source: scriptSource(output, fields.code),
    asset,
  })
}

/**
 * The same item after a re-compile: identity, placement, children and paint
 * survive; paint on a slot the new output no longer has is dropped.
 */
export function updateScriptItem(
  previous: ItemNode,
  output: GeometryScriptCompileOutput,
  fields: ScriptItemFields,
): ItemNode {
  const slotIds = new Set(output.manifest.slots.map((slot) => slot.id))
  return ItemNode.parse({
    ...previous,
    name: fields.name ?? previous.name,
    position: fields.position ?? previous.position,
    rotation: fields.rotation ?? previous.rotation,
    side: fields.side ?? previous.side,
    slots: previous.slots
      ? Object.fromEntries(Object.entries(previous.slots).filter(([id]) => slotIds.has(id)))
      : undefined,
    source: scriptSource(output, fields.code),
    asset: scriptAsset(output, fields, previous.asset),
  })
}
