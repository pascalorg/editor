import {
  type AnyNode,
  type AnyNodeId,
  type MaterialSchema,
  nodeRegistry,
  slotDefaultPaintMaterial,
} from '@pascal-app/core'
import type { Material, Object3D } from 'three'
import {
  type ActivePaintMaterial,
  hasActivePaintMaterial,
  type PaintableMaterialTarget,
  resolveActivePaintMaterialFromSelection,
} from './material-paint'

type RenderedMaterial = Material & {
  color?: { getHexString: () => string }
  roughness?: number
  metalness?: number
}

/** The drawn material of a mesh hit, for a slot that carries no finish of its own (an item's GLB). */
function drawnMaterial(hitObject: Object3D | undefined, materialIndex: number | null) {
  const material = (hitObject as { material?: Material | Material[] } | undefined)?.material
  const drawn = (Array.isArray(material) ? material[materialIndex ?? 0] : material) as
    | RenderedMaterial
    | undefined
  if (!drawn?.color) return null
  return {
    preset: 'custom',
    properties: {
      color: `#${drawn.color.getHexString()}`,
      roughness: drawn.roughness ?? 0.5,
      metalness: drawn.metalness ?? 0,
      opacity: drawn.opacity ?? 1,
      transparent: drawn.transparent ?? false,
      side: 'front',
    },
  } satisfies MaterialSchema
}

/**
 * The material the eyedropper takes from `role` of `node`: what the surface
 * shows, read through the paint path — the kind's `getEffectiveMaterial` (the
 * finish a room, region or override gives it, with derived roles falling to
 * what they draw), the legacy per-kind arms, then the slot's declared default
 * (`node.slots[slot]` → `default`, the renderer's own chain). A slot with none
 * of those (an item's GLB material) is read off the drawn mesh.
 */
export function eyedropperMaterial(args: {
  node: AnyNode
  role: string
  nodes: Record<string, AnyNode>
  hitObject?: Object3D
  materialIndex?: number | null
}): ActivePaintMaterial | null {
  const { node, role, nodes } = args
  const definition = nodeRegistry.get(node.type)
  const paint = definition?.capabilities?.paint
  const sourceTarget = (paint?.materialTarget ?? node.type) as PaintableMaterialTarget
  const valid = (value: { material?: MaterialSchema; materialPreset?: string } | null) =>
    value && hasActivePaintMaterial({ ...value, sourceTarget })
      ? { material: value.material, materialPreset: value.materialPreset, sourceTarget }
      : null

  const effective =
    valid(
      paint?.getEffectiveMaterial?.({
        node,
        role,
        nodes: nodes as Record<AnyNodeId, AnyNode>,
        rendered: true,
      }) ?? null,
    ) ??
    resolveActivePaintMaterialFromSelection({
      nodes,
      selectedId: node.id,
      selectedMaterialTarget: { nodeId: node.id, role },
    })
  if (effective) return effective

  const declared = definition?.capabilities?.slots?.(node).find((slot) => slot.slotId === role)
  const fallback = valid(slotDefaultPaintMaterial(declared?.default))
  if (fallback) return fallback

  const drawn = drawnMaterial(args.hitObject, args.materialIndex ?? null)
  return drawn ? { material: drawn, sourceTarget } : null
}

/** A stable key for a picked material, so an unchanged pick is not re-announced. */
export function paintMaterialKey(material: ActivePaintMaterial | null): string {
  if (!material) return ''
  return material.materialPreset ?? JSON.stringify(material.material ?? null)
}
