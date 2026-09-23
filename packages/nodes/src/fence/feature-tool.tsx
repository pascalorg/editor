'use client'

import {
  type AnyNodeId,
  canPlaceFenceFeature,
  emitter,
  type FenceEvent,
  type FenceFeatureData,
  FenceGateNode,
  type FenceNode,
  FenceOpeningNode,
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
    const candidate = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      const nodes = useScene.getState().nodes
      const best = pickFenceTarget(point, host, ray)
      if (!best) return null
      const defaults = useEditor.getState().toolDefaults.fence
      const feature: FenceFeatureData = {
        id: featureId,
        kind,
        center: best.center,
        width: typeof defaults?.featureWidth === 'number' ? defaults.featureWidth : 1.1,
        leafType: defaults?.featureLeafType === 'double' ? 'double' : 'single',
        height: Math.max(0.3, best.fence.height - 0.22),
        clearance: best.fence.groundClearance,
        style: 'match',
        hinge: 'left',
        swing: 'inward',
        openAngle: 0,
        frameWidth: 0.055,
        thickness: 0.06,
        spacing: 0.15,
        boardWidth: 0.055,
        brace: 'none',
        showHardware: true,
        showPosts: true,
      }
      return canPlaceFenceFeature(
        fenceWithFeatures(
          best.fence,
          (best.fence.children ?? []).map((id) => nodes[id as AnyNodeId]).filter(Boolean),
        ),
        feature,
      )
        ? { fence: best.fence, feature }
        : null
    }
    const update = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      clear()
      const hit = candidate(point, host, ray)
      if (hit) {
        previewId = hit.fence.id
        useLiveNodeOverrides.getState().set(previewId, { features: [hit.feature] })
        useScene.getState().markDirty(previewId)
      }
      return hit
    }
    const commit = (
      point: readonly [number, number],
      host?: FenceNode,
      ray?: GridEvent['localRay'],
    ) => {
      if (finished) return
      const hit = update(point, host, ray)
      if (!hit) return
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
