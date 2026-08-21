'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type ParametricDescriptor,
  GROUND_SUPPORT_ID,
  getCeilingClampBound,
  getWallEffectiveHeightForNodes,
  resolveCeilingHeight,
  terrainSupportLift,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { formatLinearMeasurement } from '../../../lib/measurements'
import { SegmentedControl } from '../controls/segmented-control'
import { SliderControl } from '../controls/slider-control'
import {
  commitMultiNodeFields,
  firstNumericFieldValue,
  previewMultiNodeFields,
  reduceFieldValue,
  reduceHeightBoundMode,
} from './multi-field-value'
import { precisionForStep } from './parametric-field-utils'

function wallFollowsLevelPatch(wall: WallNode, nodes: Record<string, AnyNode>): Partial<WallNode> {
  const terrainSupported =
    wall.parentId != null &&
    terrainSupportLift(nodes, wall.parentId, wall.start[0], wall.start[1]) != null
  return {
    height: undefined,
    supportOffset: undefined,
    ...(wall.supportSlabId === GROUND_SUPPORT_ID && !terrainSupported
      ? { supportSlabId: undefined }
      : {}),
  }
}

function effectiveHeight(node: AnyNode, nodes: Record<string, AnyNode>): number {
  if (node.type === 'wall') return getWallEffectiveHeightForNodes(node, nodes)
  if (node.type === 'ceiling') return resolveCeilingHeight(node, nodes)
  const height = (node as { height?: number }).height
  return typeof height === 'number' ? height : 0
}

function ceilingCustomHeight(node: CeilingNode, nodes: Record<string, AnyNode>): number {
  const resolved = resolveCeilingHeight(node, nodes)
  const parent = node.parentId ? nodes[node.parentId] : undefined
  const max =
    parent?.type === 'level'
      ? getCeilingClampBound(parent.id, nodes as Record<AnyNodeId, AnyNode>, node.polygon ?? [])
      : Number.POSITIVE_INFINITY
  return Math.min(resolved, max)
}

export function MultiHeightModeField({
  nodeIds,
  nodeType,
  parametrics,
  min = 1.5,
  max = 20,
  step = 0.05,
}: {
  nodeIds: AnyNodeId[]
  nodeType: 'wall' | 'ceiling'
  parametrics: ParametricDescriptor<AnyNode>
  min?: number
  max?: number
  step?: number
}) {
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const mode = useScene(useShallow((s) => reduceHeightBoundMode(nodeIds, s.nodes)))
  const storedHeight = useScene(useShallow((s) => reduceFieldValue(nodeIds, 'height', s.nodes)))
  const heightOrigin = useScene((s) => firstNumericFieldValue(nodeIds, 'height', s.nodes, min))
  const liveHeight = useScene((s) => {
    let seen = false
    let shared: number | undefined
    for (const id of nodeIds) {
      const node = s.nodes[id]
      if (!node) continue
      const height = effectiveHeight(node, s.nodes as Record<string, AnyNode>)
      if (!seen) {
        seen = true
        shared = height
        continue
      }
      if (!Object.is(shared, height)) return Number.NaN
    }
    return seen && shared !== undefined ? shared : Number.NaN
  })

  const applyMode = useCallback(
    (next: 'storey' | 'custom') => {
      const nodes = useScene.getState().nodes as Record<string, AnyNode>
      commitMultiNodeFields(
        nodeIds,
        (node) => {
          const isCustom = (node as { height?: number }).height != null
          if (next === 'custom') {
            if (isCustom) return {}
            if (node.type === 'ceiling') {
              return { height: ceilingCustomHeight(node, nodes) }
            }
            if (node.type === 'wall') {
              return { height: Math.max(0.1, getWallEffectiveHeightForNodes(node, nodes)) }
            }
            return {}
          }
          if (!isCustom) return {}
          if (node.type === 'wall') return wallFollowsLevelPatch(node, nodes)
          return { height: undefined }
        },
        parametrics,
      )
    },
    [nodeIds, parametrics],
  )

  const previewHeight = useCallback(
    (height: number) => {
      previewMultiNodeFields(nodeIds.map((id) => [id, { height }] as const))
    },
    [nodeIds],
  )
  const commitHeight = useCallback(
    (height: number) => {
      commitMultiNodeFields(nodeIds, () => ({ height }), parametrics)
    },
    [nodeIds, parametrics],
  )

  const mixedMode = mode.kind === 'mixed'
  const isFollows = mode.kind === 'same' && mode.value === 'storey'
  const isCustom = mode.kind === 'same' && mode.value === 'custom'
  const sliderValue =
    storedHeight.kind === 'same' && typeof storedHeight.value === 'number'
      ? storedHeight.value
      : heightOrigin
  const sliderMixed = storedHeight.kind === 'mixed' || mixedMode
  const currentLabel = Number.isFinite(liveHeight)
    ? formatLinearMeasurement(liveHeight, unit, metricNotation)
    : 'Mixed'

  return (
    <>
      {nodeType === 'wall' && (
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          Top
        </div>
      )}
      <SegmentedControl
        mixed={mixedMode}
        onChange={applyMode}
        options={[
          { label: 'Follows level', value: 'storey' },
          { label: 'Custom height', value: 'custom' },
        ]}
        value={mode.kind === 'same' ? mode.value : 'storey'}
      />
      {isFollows ? (
        <div className="px-1 text-[11px] text-muted-foreground">Currently {currentLabel}</div>
      ) : isCustom ? (
        <SliderControl
          label="Height"
          max={max}
          min={min}
          mixed={sliderMixed}
          onChange={previewHeight}
          onCommit={commitHeight}
          precision={precisionForStep(step)}
          restoreOnCommit={false}
          step={step}
          unit="m"
          value={sliderValue}
        />
      ) : null}
    </>
  )
}
