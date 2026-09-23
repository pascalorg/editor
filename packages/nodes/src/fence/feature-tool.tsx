'use client'

import {
  type AnyNodeId,
  fenceFeaturePlacementIssue,
  emitter,
  type FenceEvent,
  type FenceFeatureData,
  FenceGateNode,
  type FenceNode,
  FenceOpeningNode,
  FenceStyle,
  fenceWithFeatures,
  type GridEvent,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { markToolCancelConsumed, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { pickFenceTarget } from '../fence-feature/pick-target'

export default function FenceFeatureTool({ kind }: { kind: 'gate' | 'opening' }) {
  useEffect(() => {
    let previewId: FenceNode['id'] | undefined
    let finished = false
    const featureId = crypto.randomUUID()
    const clear = () => {
      if (!previewId) return
      useLiveNodeOverrides.getState().clearFields(previewId, ['features'])
      useScene.getState().markDirty(previewId)
      previewId = undefined
    }
    const setFeedback = (message?: string) => {
      const defaults = useEditor.getState().toolDefaults.fence
      if (defaults?.featurePlacementFeedback === message) return
      useEditor
        .getState()
        .setToolDefaults('fence', { ...defaults, featurePlacementFeedback: message })
    }
    const candidate = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      const nodes = useScene.getState().nodes
      const best = pickFenceTarget(point, host, ray)
      if (!best) return { issue: 'Click on a fence to place the feature.' }
      const defaults = useEditor.getState().toolDefaults.fence
      const selectedStyle = FenceStyle.safeParse(defaults?.featureStyle)
      const feature: FenceFeatureData = {
        id: featureId,
        kind,
        center: best.center,
        width: typeof defaults?.featureWidth === 'number' ? defaults.featureWidth : 1.1,
        matchFenceStyle: defaults?.featureMatchStyle !== false,
        leafType: defaults?.featureLeafType === 'double' ? 'double' : 'single',
        height:
          defaults?.featureMatchStyle === false
            ? Math.max(0.3, best.fence.height - 0.22)
            : undefined,
        clearance: defaults?.featureMatchStyle === false ? best.fence.groundClearance : undefined,
        style:
          defaults?.featureMatchStyle === false && selectedStyle.success
            ? selectedStyle.data
            : 'match',
        hinge: 'left',
        swing: 'inward',
        openAngle: 0,
        frameWidth: defaults?.featureMatchStyle === false ? 0.055 : undefined,
        thickness: defaults?.featureMatchStyle === false ? 0.06 : undefined,
        spacing: defaults?.featureMatchStyle === false ? 0.15 : undefined,
        boardWidth: defaults?.featureMatchStyle === false ? 0.055 : undefined,
        brace: 'none',
        showHardware: true,
        showPosts: true,
      }
      const issue = fenceFeaturePlacementIssue(
        fenceWithFeatures(
          best.fence,
          (best.fence.children ?? []).map((id) => nodes[id as AnyNodeId]).filter(Boolean),
        ),
        feature,
      )
      return issue
        ? {
            issue:
              issue === 'overlap'
                ? 'That spot overlaps another gate or passage. Choose a clear section.'
                : issue === 'end'
                  ? 'Move farther from the fence end or reduce the opening width.'
                  : 'Opening width must be at least 0.35 m.',
          }
        : { hit: { fence: best.fence, feature } }
    }
    const update = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      clear()
      const { hit, issue } = candidate(point, host, ray)
      if (hit) {
        setFeedback(undefined)
        previewId = hit.fence.id
        useLiveNodeOverrides.getState().set(previewId, { features: [hit.feature] })
        useScene.getState().markDirty(previewId)
      }
      return { hit, issue }
    }
    const commit = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      if (finished) return
      const { hit, issue } = update(point, host, ray)
      if (!hit) {
        setFeedback(issue)
        return
      }
      finished = true
      clear()
      const { id: _id, kind: _kind, ...data } = hit.feature
      const schema = kind === 'gate' ? FenceGateNode : FenceOpeningNode
      const child = schema.parse({
        ...data,
        parentId: hit.fence.id,
        name: kind === 'gate' ? 'Gate' : 'Open passage',
      })
      useScene.getState().createNode(child, hit.fence.id)
      triggerSFX('sfx:item-place')
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
      useEditor.getState().setToolDefaults('fence', null)
      useViewer.getState().setSelection({ selectedIds: [child.id] })
    }
    const onMove = (event: GridEvent) => {
      update([event.localPosition[0], event.localPosition[2]], undefined, event.localRay)
    }
    const onClick = (event: GridEvent) => {
      commit([event.localPosition[0], event.localPosition[2]], undefined, event.localRay)
    }
    const onFenceMove = (event: FenceEvent) => {
      update([event.localPosition[0], event.localPosition[2]], event.node)
    }
    const onFenceClick = (event: FenceEvent) => {
      commit([event.localPosition[0], event.localPosition[2]], event.node)
      event.stopPropagation()
    }
    const cancel = () => {
      clear()
      markToolCancelConsumed()
      useEditor.getState().setMode('select')
      useEditor.getState().setTool(null)
      useEditor.getState().setToolDefaults('fence', null)
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('fence:move', onFenceMove)
    emitter.on('fence:click', onFenceClick)
    emitter.on('tool:cancel', cancel)
    return () => {
      clear()
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('fence:move', onFenceMove)
      emitter.off('fence:click', onFenceClick)
      emitter.off('tool:cancel', cancel)
    }
  }, [kind])
  return null
}
