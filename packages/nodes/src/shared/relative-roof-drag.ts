import {
  type AnyNodeId,
  type RoofEvent,
  type RoofNode,
  type RoofSegmentNode,
  sceneRegistry,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import * as THREE from 'three'
import { type RoofSegmentHit, resolveRoofSegmentHit } from './roof-segment-hit'
import { getSurfaceY } from './roof-surface'

export type RelativeRoofDragTarget = {
  segment: RoofSegmentNode
  localX: number
  localY: number
  localZ: number
  hit: RoofSegmentHit
}

const ROOF_DRAG_SNAP_STEP_M = 0.05

type RelativeRoofDragState = {
  segmentId: string
  anchor: [number, number]
  start: [number, number, number]
  current: [number, number, number]
  surfaceOffsetY: number
}

export function roofSegmentLocalToBuildingLocal(
  segmentId: string,
  position: [number, number, number],
): [number, number, number] {
  const segmentObj = sceneRegistry.nodes.get(segmentId as AnyNodeId)
  if (!segmentObj) return position

  const point = segmentObj.localToWorld(new THREE.Vector3(...position))
  const buildingId = useViewer.getState().selection.buildingId
  const buildingObj = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  if (buildingObj) buildingObj.worldToLocal(point)
  return [point.x, point.y, point.z]
}

export function createRelativeRoofDrag(original: {
  position: [number, number, number]
  roofSegmentId?: string
}): {
  resolve: (event: RoofEvent) => RelativeRoofDragTarget | null
} {
  let state: RelativeRoofDragState | null = null

  const getPositionInSegment = (
    position: [number, number, number],
    fromSegmentId: string | undefined,
    segment: RoofSegmentNode,
  ): [number, number, number] => {
    if (fromSegmentId === segment.id) return position

    const fromSegmentObj = fromSegmentId
      ? sceneRegistry.nodes.get(fromSegmentId as AnyNodeId)
      : null
    const targetSegmentObj = sceneRegistry.nodes.get(segment.id as AnyNodeId)
    if (!(fromSegmentObj && targetSegmentObj)) return position

    const point = fromSegmentObj.localToWorld(new THREE.Vector3(...position))
    targetSegmentObj.worldToLocal(point)
    return [point.x, point.y, point.z]
  }

  const getStartPositionForSegment = (
    segment: RoofSegmentNode,
    previousState: RelativeRoofDragState | null,
  ): [number, number, number] => {
    if (previousState) {
      return getPositionInSegment(previousState.current, previousState.segmentId, segment)
    }

    if (original.roofSegmentId === segment.id) return original.position

    return getPositionInSegment(original.position, original.roofSegmentId, segment)
  }

  return {
    resolve(event) {
      const hit = resolveRoofSegmentHit(
        event.node as RoofNode,
        event.position[0],
        event.position[1],
        event.position[2],
      )
      if (!hit) return null

      if (!state || state.segmentId !== hit.segment.id) {
        const start = getStartPositionForSegment(hit.segment, state)
        state = {
          segmentId: hit.segment.id,
          anchor: [hit.localX, hit.localZ],
          start,
          current: start,
          surfaceOffsetY: start[1] - getSurfaceY(start[0], start[2], hit.segment),
        }
      }

      const localX = state.start[0] + (hit.localX - state.anchor[0])
      const localZ = state.start[2] + (hit.localZ - state.anchor[1])
      const localY = getSurfaceY(localX, localZ, hit.segment) + state.surfaceOffsetY
      state.current = [localX, localY, localZ]
      return {
        segment: hit.segment,
        localX,
        localY,
        localZ,
        hit,
      }
    },
  }
}

export function snapRelativeRoofDragTarget(
  target: RelativeRoofDragTarget,
  bypass = false,
): RelativeRoofDragTarget {
  if (bypass) return target
  const localX = Math.round(target.localX / ROOF_DRAG_SNAP_STEP_M) * ROOF_DRAG_SNAP_STEP_M
  const localZ = Math.round(target.localZ / ROOF_DRAG_SNAP_STEP_M) * ROOF_DRAG_SNAP_STEP_M
  const surfaceOffsetY = target.localY - getSurfaceY(target.localX, target.localZ, target.segment)
  const localY = getSurfaceY(localX, localZ, target.segment) + surfaceOffsetY
  return {
    ...target,
    localX,
    localY,
    localZ,
  }
}
