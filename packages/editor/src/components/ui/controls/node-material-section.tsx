'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getMaterialPresetByRef,
  type MaterialSchema,
  type MaterialTargetDescriptor,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo } from 'react'
import {
  getMaterialTargetKindForNode,
  getMaterialTargetsForNode,
} from '../../../lib/material-targets'
import useEditor from '../../../store/use-editor'
import { MaterialSwatchField } from './material-swatch-field'
import { PanelSection } from './panel-section'

type NodeMaterialSectionProps = {
  nodeId?: AnyNodeId
}

type MaterialTargetValues = {
  material?: MaterialSchema
  materialPreset?: string
}

const defaultMaterialProperties = {
  color: '#ffffff',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  transparent: false,
  side: 'front' as const,
}

export function NodeMaterialSection({ nodeId: explicitNodeId }: NodeMaterialSectionProps) {
  const selectedId = useViewer((state) => state.selection.selectedIds[0]) as AnyNodeId | undefined
  const nodeId = explicitNodeId ?? selectedId
  const node = useScene((state) => (nodeId ? state.nodes[nodeId] : undefined))
  const updateNode = useScene((state) => state.updateNode)
  const setSelectedMaterialTarget = useEditor((state) => state.setSelectedMaterialTarget)

  const targets = useMemo(() => getMaterialTargetsForNode(node), [node])

  useEffect(() => {
    const firstTarget = targets[0]
    if (!(nodeId && firstTarget && isMaterialTargetRole(firstTarget.key))) return
    const currentTarget = useEditor.getState().selectedMaterialTarget
    if (currentTarget?.nodeId === nodeId) {
      if (currentTarget.role === firstTarget.key) return
      if (targets.some((target) => target.key === currentTarget.role)) return
    }
    setSelectedMaterialTarget({
      nodeId,
      role: firstTarget.key,
    })
  }, [nodeId, setSelectedMaterialTarget, targets])

  const writeMaterial = useCallback(
    (target: MaterialTargetDescriptor, next: MaterialTargetValues) => {
      if (!(node && nodeId)) return

      const materialKey = target.materialKey ?? 'material'
      const presetKey = target.materialPresetKey ?? 'materialPreset'
      updateNode(nodeId, {
        [materialKey]: next.material,
        [presetKey]: next.materialPreset,
      } as Partial<AnyNode>)
      useScene.getState().markDirty(nodeId)
      console.log('[pascal:material-panel:write]', {
        nodeId,
        nodeType: node.type,
        target: target.key,
        materialKey,
        presetKey,
        materialColor: next.material?.properties?.color,
        materialProperties: next.material?.properties,
        materialPreset: next.materialPreset,
      })

      const sourceTarget = getMaterialTargetKindForNode(node)
      if (sourceTarget) {
        useEditor.getState().setActivePaintTarget(sourceTarget)
        useEditor.getState().setActivePaintMaterial({
          material: next.material,
          materialPreset: next.materialPreset,
          sourceTarget,
        })
      }
    },
    [node, nodeId, updateNode],
  )

  if (!(node && targets.length > 0)) return null

  return (
    <PanelSection title={'\u6750\u8d28'}>
      <div className="space-y-2 px-3 py-2">
        {targets.map((target) => {
          const values = readTargetValues(node, target)
          const properties = resolveEditableProperties(values)
          return (
            <MaterialSwatchField
              key={target.key}
              label={getMaterialTargetLabel(target)}
              selectedMaterialPreset={values.materialPreset}
              value={values.material}
              onChange={(material) =>
                writeMaterial(target, {
                  material: {
                    preset: 'custom',
                    properties: {
                      ...properties,
                      ...material.properties,
                      transparent:
                        (material.properties?.opacity ?? properties.opacity) < 1 ||
                        (material.properties?.transparent ?? properties.transparent),
                    },
                  },
                  materialPreset: undefined,
                })
              }
              onOpenChange={(open) => {
                if (open && nodeId && isMaterialTargetRole(target.key)) {
                  setSelectedMaterialTarget({ nodeId, role: target.key })
                }
              }}
              onSelectMaterialPreset={(materialPreset) =>
                writeMaterial(target, { material: undefined, materialPreset })
              }
            />
          )
        })}
      </div>
    </PanelSection>
  )
}

function isMaterialTargetRole(
  value: string,
): value is
  | 'interior'
  | 'exterior'
  | 'top'
  | 'edge'
  | 'wall'
  | 'railing'
  | 'tread'
  | 'side'
  | 'surface' {
  return (
    value === 'interior' ||
    value === 'exterior' ||
    value === 'top' ||
    value === 'edge' ||
    value === 'wall' ||
    value === 'railing' ||
    value === 'tread' ||
    value === 'side' ||
    value === 'surface'
  )
}

function getMaterialTargetLabel(target: MaterialTargetDescriptor): string {
  if (target.key === 'surface' || target.label === 'Overall') return '整体'
  if (target.key === 'interior' || target.label === 'Interior') return '内侧'
  if (target.key === 'exterior' || target.label === 'Exterior') return '外侧'
  if (target.key === 'top' || target.label === 'Top') return '顶面'
  if (target.key === 'edge' || target.label === 'Edge') return '边缘'
  if (target.key === 'wall' || target.label === 'Wall') return '墙面'
  if (target.key === 'tread' || target.label === 'Tread') return '踏步'
  if (target.key === 'side' || target.label === 'Side') return '侧面'
  if (target.key === 'railing' || target.label === 'Railing') return '栏杆'
  return target.label
}

function readTargetValues(node: AnyNode, target: MaterialTargetDescriptor): MaterialTargetValues {
  const record = node as Record<string, unknown>
  const materialKey = target.materialKey ?? 'material'
  const presetKey = target.materialPresetKey ?? 'materialPreset'
  const material = record[materialKey] as MaterialSchema | undefined
  const materialPreset = record[presetKey] as string | undefined

  if (!material && !materialPreset && node.type === 'road' && materialKey === 'material') {
    return {
      material: {
        preset: 'custom',
        properties: {
          ...defaultMaterialProperties,
          color: typeof record.asphaltColor === 'string' ? record.asphaltColor : '#2f3338',
          roughness: 0.88,
          metalness: 0.02,
        },
      },
    }
  }

  return {
    material,
    materialPreset: material ? undefined : materialPreset,
  }
}

function resolveEditableProperties(values: MaterialTargetValues) {
  const presetProperties = getMaterialPresetByRef(values.materialPreset)?.mapProperties
  const currentProperties = values.material?.properties

  return {
    ...defaultMaterialProperties,
    color: currentProperties?.color ?? presetProperties?.color ?? defaultMaterialProperties.color,
    roughness:
      currentProperties?.roughness ??
      presetProperties?.roughness ??
      defaultMaterialProperties.roughness,
    metalness:
      currentProperties?.metalness ??
      presetProperties?.metalness ??
      defaultMaterialProperties.metalness,
    opacity:
      currentProperties?.opacity ?? presetProperties?.opacity ?? defaultMaterialProperties.opacity,
    transparent:
      currentProperties?.transparent ??
      presetProperties?.transparent ??
      defaultMaterialProperties.transparent,
    side: currentProperties?.side ?? defaultMaterialProperties.side,
  }
}
