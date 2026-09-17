import { getMaterialPresetByRef, parseMaterialRef, toSceneMaterialRef } from '../material-library'
import type { MaterialSchema } from '../schema/material'
import {
  generateSceneMaterialId,
  type SceneMaterial,
  type SceneMaterialId,
} from '../schema/scene-material'
import type { AnyNodeId } from '../schema/types'
import { runAsSingleSceneHistoryStep } from '../store/history-control'
import useScene from '../store/use-scene'
import { proceduralFinishLibraryColor } from './library-colors'
import { isProceduralItem } from './query'

export function proceduralSlotColor(
  ref: string | undefined,
  fallback: string,
  materials: Record<string, SceneMaterial>,
) {
  if (ref?.startsWith('#')) return ref
  const parsed = parseMaterialRef(ref)
  if (parsed?.kind === 'scene') return materials[parsed.id]?.material.properties?.color ?? fallback
  return ref
    ? (proceduralFinishLibraryColor(ref) ??
        getMaterialPresetByRef(ref)?.mapProperties?.color ??
        fallback)
    : fallback
}
export function setProceduralMaterial(
  nodeId: string,
  slotId: string,
  ref?: string,
  material?: MaterialSchema,
) {
  const state = useScene.getState(),
    node: unknown = state.nodes[nodeId as AnyNodeId]
  if (state.readOnly || !isProceduralItem(node)) return
  if (!node.recipe.slots.some((s) => s.id === slotId)) throw new Error('Unknown material slot')
  let created: SceneMaterial | undefined
  if (material && !ref) {
    const match = Object.values(state.materials).find(
      (m) => JSON.stringify(m.material) === JSON.stringify(material),
    )
    created = match
      ? undefined
      : {
          id: generateSceneMaterialId(),
          name: node.recipe.slots.find((s) => s.id === slotId)!.label,
          material,
        }
    ref = toSceneMaterialRef((match ?? created)!.id)
  }
  const slots = { ...node.slots }
  if (ref) slots[slotId] = ref
  else delete slots[slotId]
  runAsSingleSceneHistoryStep(useScene, () => {
    state.updateNode(nodeId as AnyNodeId, { slots } as never)
    if (created)
      useScene.getState().addSceneMaterial(created as SceneMaterial & { id: SceneMaterialId })
  })
}
