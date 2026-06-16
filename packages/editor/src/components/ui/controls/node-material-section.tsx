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
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getMaterialTargetKindForNode,
  getMaterialTargetsForNode,
} from '../../../lib/material-targets'
import useEditor from '../../../store/use-editor'
import { MaterialPicker } from './material-picker'
import { PanelSection } from './panel-section'
import { SegmentedControl } from './segmented-control'
import { SliderControl } from './slider-control'

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
  const selectedMaterialTarget = useEditor((state) => state.selectedMaterialTarget)
  const setSelectedMaterialTarget = useEditor((state) => state.setSelectedMaterialTarget)
  const [activeTargetKey, setActiveTargetKey] = useState<string>('surface')

  const targets = useMemo(() => getMaterialTargetsForNode(node), [node])
  const activeTarget = useMemo(
    () => targets.find((target) => target.key === activeTargetKey) ?? targets[0] ?? null,
    [activeTargetKey, targets],
  )
  const selectMaterialTargetKey = useCallback(
    (targetKey: string) => {
      setActiveTargetKey(targetKey)
      if (nodeId && isMaterialTargetRole(targetKey)) {
        setSelectedMaterialTarget({
          nodeId,
          role: targetKey,
        })
      }
    },
    [nodeId, setSelectedMaterialTarget],
  )

  useEffect(() => {
    if (targets.length === 0 || targets.some((target) => target.key === activeTargetKey)) return
    setActiveTargetKey(targets[0]?.key ?? 'surface')
  }, [activeTargetKey, targets])

  useEffect(() => {
    if (!(nodeId && selectedMaterialTarget?.nodeId === nodeId)) return
    const selectedTarget = targets.find((target) => target.key === selectedMaterialTarget.role)
    if (selectedTarget && selectedTarget.key !== activeTargetKey) {
      setActiveTargetKey(selectedTarget.key)
    }
  }, [activeTargetKey, nodeId, selectedMaterialTarget, targets])

  useEffect(() => {
    if (!(nodeId && activeTarget && isMaterialTargetRole(activeTarget.key))) return
    const currentTarget = useEditor.getState().selectedMaterialTarget
    if (currentTarget?.nodeId === nodeId) {
      if (currentTarget.role === activeTarget.key) return
      if (targets.some((target) => target.key === currentTarget.role)) return
    }
    setSelectedMaterialTarget({
      nodeId,
      role: activeTarget.key,
    })
  }, [activeTarget, nodeId, setSelectedMaterialTarget, targets])

  const values = useMemo(
    () => (node && activeTarget ? readTargetValues(node, activeTarget) : {}),
    [activeTarget, node],
  )
  const properties = useMemo(() => resolveEditableProperties(values), [values])

  const writeMaterial = useCallback(
    (next: MaterialTargetValues) => {
      if (!(node && nodeId && activeTarget)) return

      const materialKey = activeTarget.materialKey ?? 'material'
      const presetKey = activeTarget.materialPresetKey ?? 'materialPreset'
      updateNode(nodeId, {
        [materialKey]: next.material,
        [presetKey]: next.materialPreset,
      } as Partial<AnyNode>)

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
    [activeTarget, node, nodeId, updateNode],
  )

  const writeCustomProperties = useCallback(
    (updates: Partial<typeof defaultMaterialProperties>) => {
      writeMaterial({
        material: {
          preset: 'custom',
          properties: {
            ...properties,
            ...updates,
            transparent: (updates.opacity ?? properties.opacity) < 1,
          },
        },
        materialPreset: undefined,
      })
    },
    [properties, writeMaterial],
  )

  if (!(node && activeTarget && targets.length > 0)) return null

  return (
    <PanelSection title="Material">
      {targets.length > 1 ? (
        <div className="px-3 py-2">
          <SegmentedControl
            onChange={selectMaterialTargetKey}
            options={targets.map((target) => ({ label: target.label, value: target.key }))}
            value={activeTarget.key}
          />
        </div>
      ) : null}

      <div className="space-y-3 px-3 py-2">
        <MaterialPicker
          selectedMaterialPreset={values.materialPreset}
          value={values.material}
          onSelectMaterialPreset={(materialPreset) =>
            writeMaterial({ material: undefined, materialPreset })
          }
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground/80 text-xs">Base color</span>
            <div className="flex items-center gap-2">
              <input
                className="h-7 w-9 cursor-pointer rounded border border-border/50 bg-transparent"
                onChange={(event) => writeCustomProperties({ color: event.target.value })}
                type="color"
                value={properties.color}
              />
              <input
                className="w-24 rounded-md border border-border/50 bg-[#2C2C2E] px-2 py-1 font-mono text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-foreground/30"
                onChange={(event) => writeCustomProperties({ color: event.target.value })}
                type="text"
                value={properties.color}
              />
            </div>
          </div>
          <SliderControl
            label="Roughness"
            max={1}
            min={0}
            onChange={(roughness) => writeCustomProperties({ roughness })}
            precision={2}
            step={0.01}
            value={properties.roughness}
          />
          <SliderControl
            label="Metalness"
            max={1}
            min={0}
            onChange={(metalness) => writeCustomProperties({ metalness })}
            precision={2}
            step={0.01}
            value={properties.metalness}
          />
          <SliderControl
            label="Opacity"
            max={1}
            min={0.05}
            onChange={(opacity) => writeCustomProperties({ opacity })}
            precision={2}
            step={0.01}
            value={properties.opacity}
          />
        </div>
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

function readTargetValues(node: AnyNode, target: MaterialTargetDescriptor): MaterialTargetValues {
  const record = node as Record<string, unknown>
  const materialKey = target.materialKey ?? 'material'
  const presetKey = target.materialPresetKey ?? 'materialPreset'

  return {
    material: record[materialKey] as MaterialSchema | undefined,
    materialPreset: record[presetKey] as string | undefined,
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
    opacity: currentProperties?.opacity ?? presetProperties?.opacity ?? defaultMaterialProperties.opacity,
    transparent:
      currentProperties?.transparent ??
      presetProperties?.transparent ??
      defaultMaterialProperties.transparent,
    side: currentProperties?.side ?? defaultMaterialProperties.side,
  }
}
