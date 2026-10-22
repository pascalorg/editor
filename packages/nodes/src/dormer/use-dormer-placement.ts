import {
  type AnyNodeId,
  type DormerNode,
  emitter,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { getRoofOuterSurfaceFrameAtPoint, useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { createRelativeRoofDrag } from '../shared/relative-roof-drag'
import { resolveRoofSegmentHit } from '../shared/roof-segment-hit'
import { getDownSlopeYaw } from '../shared/roof-surface'
import {
  clearRoofSurfacePlacementGuides,
  snapRoofSurfaceNodeTarget,
} from '../shared/roof-surface-placement-guides'
import { DORMER_PLACEMENT_ROTATION_STEP } from './geometry'
import { resolveDormerPlacement } from './placement'

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
 *   - visible snap mode, footprint validation and SFX cue
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
  node: DormerNode
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
  valid: boolean
} {
  const activeBuildingId = useViewer((s) => s.selection.buildingId)

  const [segmentXform, setSegmentXform] = useState<DormerSegmentTransform | null>(null)
  const [hitSegment, setHitSegment] = useState<RoofSegmentNode | null>(null)
  const [hitLocal, setHitLocal] = useState<[number, number, number] | null>(null)
  const [ghostRotation, setGhostRotation] = useState(opts.initialRotation ?? 0)
  const [valid, setValid] = useState(true)
  const nodeRef = useRef(opts.node)
  nodeRef.current = opts.node
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

  const clearPreview = useCallback(() => {
    setSegmentXform(null)
    setHitSegment(null)
    setHitLocal(null)
    clearRoofSurfacePlacementGuides()
  }, [])

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

    const resolvePlacementHit = (event: RoofEvent): DormerPlacementHit | null => {
      if (roofDrag) return roofDrag.resolve(event)
      return resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
    }

    let lastEvent: RoofEvent | null = null
    let resolvedRotation = ghostRotationRef.current
    let canPlace = false
    const originalSegment = relativeStartRef.current?.roofSegmentId
      ? (useScene.getState().nodes[relativeStartRef.current.roofSegmentId as AnyNodeId] as
          | RoofSegmentNode
          | undefined)
      : undefined
    const surfaceOffset =
      originalSegment && relativeStartRef.current
        ? relativeStartRef.current.position[1] -
          getRoofOuterSurfaceFrameAtPoint(
            originalSegment,
            relativeStartRef.current.position[0],
            relativeStartRef.current.position[2],
          ).point.y
        : 0

    const resolve = (event: RoofEvent, force = event.nativeEvent?.altKey === true) => {
      const hit = resolvePlacementHit(event)
      if (!hit) return null
      resolvedRotation =
        ghostRotationRef.current +
        (roofDrag ? 0 : getDownSlopeYaw(hit.localX, hit.localZ, hit.segment))
      const placedNode = { ...nodeRef.current, rotation: resolvedRotation }
      let placement = resolveDormerPlacement(hit.segment, placedNode, hit.localX, hit.localZ, {
        gridStep: !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        surfaceOffset,
      })
      if (!force && isMagneticSnapActive()) {
        const snapped = snapRoofSurfaceNodeTarget({
          target: {
            ...hit,
            hit: 'hit' in hit ? (hit.hit as ReturnType<typeof resolveRoofSegmentHit> & {}) : hit,
            localX: placement.position[0],
            localY: placement.position[1],
            localZ: placement.position[2],
          },
          node: placedNode,
        })
        placement = resolveDormerPlacement(
          hit.segment,
          placedNode,
          snapped.localX,
          snapped.localZ,
          { surfaceOffset },
        )
      }
      canPlace = force || placement.valid
      setValid(canPlace)
      setGhostRotation(resolvedRotation)
      return {
        ...hit,
        localX: placement.position[0],
        localY: placement.position[1],
        localZ: placement.position[2],
      }
    }
    const leave = () => {
      lastEvent = null
      clearPreview()
    }
    const updatePreview = (event: RoofEvent) => {
      lastEvent = event
      const hit = resolve(event)
      if (!hit) {
        leave()
        return
      }
      const xform = computeSegmentXform(hit.segment.id)
      if (!xform) {
        leave()
        return
      }
      setSegmentXform(xform)
      setHitSegment(hit.segment)
      setHitLocal([hit.localX, hit.localY, hit.localZ])
      const prev = lastSnapRef.current
      if (
        !event.nativeEvent?.altKey &&
        (isGridSnapActive() || isMagneticSnapActive()) &&
        (!prev || prev[0] !== hit.localX || prev[1] !== hit.localZ)
      ) {
        triggerSFX('sfx:grid-snap')
        lastSnapRef.current = [hit.localX, hit.localZ]
      }
      event.stopPropagation()
    }
    const commit = (hit: DormerPlacementHit | null) => {
      if (!hit || !canPlace || committed) return
      committed = true
      onCommitRef.current(hit, resolvedRotation)
      triggerSFX('sfx:item-place')
      leave()
    }
    const onClick = (event: RoofEvent) => {
      commit(resolve(event))
      event.stopPropagation()
    }
    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      if (lastEvent) commit(resolve(lastEvent, event.altKey))
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
      if (lastEvent) updatePreview(lastEvent)
      else setGhostRotation(ghostRotationRef.current)
      e.preventDefault()
    }

    emitter.on('roof:move', updatePreview)
    emitter.on('roof:enter', updatePreview)
    emitter.on('roof:click', onClick)
    emitter.on('roof:leave', leave)
    emitter.on('tool:cancel', leave)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      emitter.off('roof:move', updatePreview)
      emitter.off('roof:enter', updatePreview)
      emitter.off('roof:click', onClick)
      emitter.off('roof:leave', leave)
      emitter.off('tool:cancel', leave)
      clearRoofSurfacePlacementGuides()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [activeBuildingId, clearPreview])

  return {
    activeBuildingId: activeBuildingId ?? undefined,
    clearPreview,
    segmentXform,
    hitSegment,
    hitLocal,
    ghostRotation,
    valid,
  }
}
