'use client'

import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { Html } from '@react-three/drei'
import { Box, Wrench } from 'lucide-react'
import { memo, useMemo } from 'react'
import {
  type ObjectCapabilityProfile,
  resolveObjectCapabilities,
} from '../../../lib/object-capabilities'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import {
  type AnyRecord,
  compactId,
  estimateEquipmentHeight,
  isEquipmentProfile,
  type LensNodeMap,
  metadataOf,
  nodeBasePosition,
  numberValue,
  uniqueStrings,
} from './canvas-lens-helpers'

type EquipmentLensItem = {
  nodeId: string
  label: string
  family?: string
  recipeId?: string
  position: [number, number, number]
  footprint: [number, number, number]
  editableParts: string[]
  editableCapabilityLabels: string[]
  portCount: number
}

function estimateFootprint(node: AnyNode | undefined, profile: ObjectCapabilityProfile) {
  const record = (node ?? {}) as unknown as AnyRecord
  if (profile.equipmentFamily === 'column') return [2.3, 0.04, 2.3] as [number, number, number]
  if (profile.equipmentFamily === 'tank') return [3.6, 0.04, 3.6] as [number, number, number]
  if (profile.equipmentFamily === 'pump') return [3.0, 0.04, 1.6] as [number, number, number]
  return [
    numberValue(record.width) ?? 2.6,
    0.04,
    numberValue(record.depth) ?? numberValue(record.length) ?? 2.0,
  ] as [number, number, number]
}

function roleLabel(role: string | undefined) {
  return role?.trim() || 'part'
}

function equipmentLensItems(nodes: LensNodeMap) {
  const items: EquipmentLensItem[] = []
  for (const node of Object.values(nodes)) {
    const profile = resolveObjectCapabilities(node, nodes)
    if (!profile) continue
    if (!isEquipmentProfile(profile)) continue

    const metadata = metadataOf(node)
    const base = nodeBasePosition(node)
    const height = estimateEquipmentHeight(node, profile, 2.2)
    const editableParts = uniqueStrings(
      profile.editableParts
        .filter((part) => part.editable)
        .map((part) => roleLabel(part.semanticRole ?? part.sourcePartKind)),
      5,
    )
    const editableCapabilityLabels = profile.capabilities
      .filter((capability) => capability.editable)
      .map((capability) => capability.label)
      .slice(0, 3)

    items.push({
      nodeId: profile.nodeId,
      label: profile.label ?? String(node?.id ?? 'Equipment'),
      family:
        profile.equipmentFamily ??
        (typeof metadata.equipmentRole === 'string' ? metadata.equipmentRole : undefined),
      recipeId: compactId(profile.recipeId),
      position: [base[0], base[1] + height + 0.6, base[2]],
      footprint: estimateFootprint(node, profile),
      editableParts,
      editableCapabilityLabels,
      portCount: profile.ports.length,
    })
  }

  return items.slice(0, 64)
}

export const EquipmentLensOverlay = memo(function EquipmentLensOverlay() {
  const canvasLens = useEditor((state) => state.canvasLens)
  const nodes = useScene((state) => state.nodes)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const setSelection = useViewer((state) => state.setSelection)
  const items = useMemo(
    () => (canvasLens === 'equipment' ? equipmentLensItems(nodes) : []),
    [canvasLens, nodes],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds])

  if (canvasLens !== 'equipment' || items.length === 0) return null

  return (
    <group name="equipment-lens-overlay">
      {items.map((item) => {
        const selected = selectedIdSet.has(item.nodeId)
        const basePosition: [number, number, number] = [item.position[0], 0.08, item.position[2]]
        return (
          <group key={item.nodeId}>
            <mesh position={basePosition}>
              <boxGeometry args={item.footprint} />
              <meshBasicMaterial
                color={selected ? '#a7f3d0' : '#86efac'}
                opacity={selected ? 0.34 : 0.18}
                transparent
                wireframe
              />
            </mesh>
            <Html center distanceFactor={18} position={item.position} zIndexRange={[12, 0]}>
              <button
                className={cn(
                  'pointer-events-auto min-w-40 max-w-60 rounded-lg border px-2.5 py-2 text-left text-white shadow-xl backdrop-blur-md transition-colors',
                  selected
                    ? 'border-emerald-200/90 bg-emerald-500/25'
                    : 'border-white/15 bg-zinc-950/80 hover:border-emerald-200/70 hover:bg-zinc-900/90',
                )}
                data-equipment-lens-node-id={item.nodeId}
                data-testid={`equipment-lens-card-${item.nodeId}`}
                onClick={() => setSelection({ selectedIds: [item.nodeId as AnyNodeId] })}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Box className="h-3.5 w-3.5 shrink-0 text-emerald-200" />
                  <span className="truncate font-medium text-[12px]">{item.label}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-emerald-100/70">
                  {[item.family, item.recipeId].filter(Boolean).join(' / ') || 'semantic equipment'}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {item.editableCapabilityLabels.map((label) => (
                    <span
                      className="rounded border border-emerald-200/20 bg-emerald-200/10 px-1.5 py-0.5 text-[9px] text-emerald-50"
                      data-testid={`equipment-lens-capability-${item.nodeId}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                      key={label}
                    >
                      {label}
                    </span>
                  ))}
                  {item.portCount > 0 && (
                    <span
                      className="rounded border border-sky-200/20 bg-sky-200/10 px-1.5 py-0.5 text-[9px] text-sky-50"
                      data-testid={`equipment-lens-ports-${item.nodeId}`}
                    >
                      {item.portCount} ports
                    </span>
                  )}
                </span>
                {item.editableParts.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {item.editableParts.map((part) => (
                      <span
                        className="inline-flex items-center gap-1 rounded border border-amber-200/20 bg-amber-200/10 px-1.5 py-0.5 text-[9px] text-amber-50"
                        data-testid={`equipment-lens-part-${item.nodeId}-${part}`}
                        key={part}
                      >
                        <Wrench className="h-2.5 w-2.5" />
                        {part}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </Html>
          </group>
        )
      })}
    </group>
  )
})
