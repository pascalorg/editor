import {
  type AnyNodeId,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
} from '@pascal-app/core'
import { consumePlacementDragRelease, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createRelativeRoofDrag } from '../shared/relative-roof-drag'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import { DORMER_PLACEMENT_ROTATION_STEP, DORMER_PLACEMENT_SNAP_M } from './geometry'

const tmpMatrix = new THREE.Matrix4()
const tmpInv = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()

export type DormerSegmentTransform = {
  position: [number, number, number]
  quaternion: [number, number, number, number]
}

export type DormerPlacementHit = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
}

/**
 * Shared placement-tool plumbing for fresh-place and duplicate/move
 * tools. Owns:
 *   - cursor → roof-segment hit resolution (delegated to the host
 *     RoofNode pointer events)
 *   - building-local segment transform extraction (for ghost mounting)
 *   - 5cm grid snap + SFX cue
 *   - keyboard rotate (R / Shift+R, ±15°)
 *
 * Does NOT own:
 *   - the ghost mesh (caller renders `<DormerPreview>`)
 *   - any node-lifecycle state (caller passes an `onCommit` that
 *     decides between createNode / updateNode / etc.)
 *
 * Returns the segment transform + cursor hit so the caller can mount
 * the ghost, plus the live ghost rotation (driven by R / Shift+R).
 */
export function useDormerPlacement(opts: {
  initialRotation?: number
  relativeStart?: {
    position: [number, number, number]
    roofSegmentId?: string
  }
  onCommit: (hit: DormerPlacementHit, rotation: number) => void
}): {
  activeBuildingId: string | undefined
  clearPreview: () => void
  segmentXform: DormerSegmentTransform | null
  hitSegment: RoofSegmentNode | null
  hitLocal: [number, number, number] | null
  ghostRotation: number
} {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)

  const [segmentXform, setSegmentXform] = useState<DormerSegmentTransform | null>(null)
  const [hitSegment, setHitSegment] = useState<RoofSegmentNode | null>(null)
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const [ghostRotation, setGhostRotation] = useState(opts.initialRotation ?? 0)
  const lastSnapRef = useRef<[number, number] | null>(null)
  // Mirror of `ghostRotation` so the click handler (registered once
  // inside useEffect) can read the latest value at commit time.
  const ghostRotationRef = useRef(opts.initialRotation ?? 0)
  const relativeStartRef = useRef(opts.relativeStart)
  // Latest commit callback, captured via ref so the useEffect doesn't
  // need it in its dep list (we don't want to re-register listeners
  // every time the parent rerenders).
  const onCommitRef = useRef(opts.onCommit)
  onCommitRef.current = opts.onCommit

  const clearPreview = () => {
    setSegmentXform(null)
    setHitSegment(null)
    setHitLocal(null)
  }

  useEffect(() => {
    if (!activeBuildingId) return

    const computeSegmentXform = (segmentId: string): DormerSegmentTransform | null => {
      const buildingObj = sceneRegistry.nodes.get(activeBuildingId as AnyNodeId)
      const segObj = sceneRegistry.nodes.get(segmentId as AnyNodeId)
      if (!(buildingObj && segObj)) return null
      buildingObj.updateWorldMatrix(true, false)
      segObj.updateWorldMatrix(true, false)
      tmpInv.copy(buildingObj.matrixWorld).invert()
      tmpMatrix.multiplyMatrices(tmpInv, segObj.matrixWorld)
      tmpMatrix.decompose(tmpPos, tmpQuat, tmpScale)
      return {
        position: [tmpPos.x, tmpPos.y, tmpPos.z],
        quaternion: [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w],
      }
    }

    const roofDrag = relativeStartRef.current
      ? createRelativeRoofDrag(relativeStartRef.current)
      : null
    let committed = false
    let lastRelativeHit: DormerPlacementHit | null = null

    const resolvePlacementHit = (event: RoofEvent): DormerPlacementHit | null => {
      if (roofDrag) return roofDrag.resolve(event)
      return resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
    }

    const updatePreview = (event: RoofEvent) => {
      const wx = event.position[0]
      const wz = event.position[2]

      const sx = Math.round(wx / DORMER_PLACEMENT_SNAP_M) * DORMER_PLACEMENT_SNAP_M
      const sz = Math.round(wz / DORMER_PLACEMENT_SNAP_M) * DORMER_PLACEMENT_SNAP_M
      const prev = lastSnapRef.current
      if (event.nativeEvent?.shiftKey !== true && (!prev || prev[0] !== sx || prev[1] !== sz)) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [sx, sz]
      }

      const hit = resolvePlacementHit(event)
      if (!hit) return
      if (roofDrag) lastRelativeHit = hit
      const xform = computeSegmentXform(hit.segment.id)
      if (!xform) return
      setSegmentXform(xform)
      setHitSegment(hit.segment)
      // Lift the ghost to the actual roof-surface Y at the cursor so
      // it tracks the mouse along the slope. The CSG inside
      // `generateDormerGeometry` carves the dormer against the host
      // roof regardless of `position[1]` — anchoring at the cursor
      // height is purely a visual alignment.
      setHitLocal([hit.localX, hit.localY, hit.localZ])
      event.stopPropagation()
    }

    const onClick = (event: RoofEvent) => {
      if (committed) return
      const hit = roofDrag
        ? (lastRelativeHit ?? resolvePlacementHit(event))
        : resolvePlacementHit(event)
      if (!hit) return
      committed = true
      onCommitRef.current(hit, ghostRotationRef.current)
      triggerSFX('sfx:item-place')
      event.stopPropagation()
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (committed) return
      if (!consumePlacementDragRelease(event)) return
      const hit = roofDrag ? lastRelativeHit : null
      if (!hit) return
      committed = true
      onCommitRef.current(hit, ghostRotationRef.current)
      triggerSFX('sfx:item-place')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      const dir = e.shiftKey ? -1 : 1
      ghostRotationRef.current += dir * DORMER_PLACEMENT_ROTATION_STEP
      setGhostRotation(ghostRotationRef.current)
      e.preventDefault()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [activeBuildingId])

  return {
    activeBuildingId: activeBuildingId ?? undefined,
    clearPreview,
    segmentXform,
    hitSegment,
    hitLocal,
    ghostRotation,
  }
}
