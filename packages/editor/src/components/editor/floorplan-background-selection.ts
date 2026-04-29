'use client'

import type { Point2D, ZoneNode as ZoneNodeType } from '@pascal-app/core'
import { isPointInsidePolygon } from '../../lib/floorplan'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'

type ModifierKeys = {
  meta: boolean
  ctrl: boolean
}

type ZoneHitEntry = {
  zone: {
    id: ZoneNodeType['id']
  }
  polygon: Point2D[]
}

type ResolveFloorplanBackgroundSelectionArgs = {
  canSelectElementFloorplanGeometry: boolean
  canSelectFloorplanZones: boolean
  currentSelectedIds: string[]
  getFloorplanHitIdAtPoint: (planPoint: WallPlanPoint) => string | null
  isWallBuildActive: boolean
  modifierKeys: ModifierKeys
  planPoint: WallPlanPoint
  structureLayer: string
  toPoint2D: (point: WallPlanPoint) => Point2D
  visibleZonePolygons: ZoneHitEntry[]
}

export type FloorplanBackgroundSelectionResult =
  | {
      handled: true
      kind: 'select-zone'
      zoneId: ZoneNodeType['id']
    }
  | {
      handled: true
      kind: 'select-elements'
      selectedIds: string[]
    }
  | {
      handled: true
      kind: 'clear-zones'
    }
  | {
      handled: true
      kind: 'clear-elements'
      preserveSelection: boolean
    }
  | {
      handled: false
    }

export function resolveFloorplanBackgroundSelection({
  canSelectElementFloorplanGeometry,
  canSelectFloorplanZones,
  currentSelectedIds,
  getFloorplanHitIdAtPoint,
  isWallBuildActive,
  modifierKeys,
  planPoint,
  structureLayer,
  toPoint2D,
  visibleZonePolygons,
}: ResolveFloorplanBackgroundSelectionArgs): FloorplanBackgroundSelectionResult {
  if (canSelectFloorplanZones) {
    const zoneHit = visibleZonePolygons.find(({ polygon }) =>
      isPointInsidePolygon(toPoint2D(planPoint), polygon),
    )
    if (zoneHit) {
      return {
        handled: true,
        kind: 'select-zone',
        zoneId: zoneHit.zone.id,
      }
    }
  }

  if (canSelectElementFloorplanGeometry) {
    const hitId = getFloorplanHitIdAtPoint(planPoint)
    if (hitId) {
      return {
        handled: true,
        kind: 'select-elements',
        selectedIds:
          modifierKeys.meta || modifierKeys.ctrl
            ? currentSelectedIds.includes(hitId)
              ? currentSelectedIds.filter((selectedId) => selectedId !== hitId)
              : [...currentSelectedIds, hitId]
            : [hitId],
      }
    }
  }

  if (!isWallBuildActive) {
    if (structureLayer === 'zones') {
      return {
        handled: true,
        kind: 'clear-zones',
      }
    }

    return {
      handled: true,
      kind: 'clear-elements',
      preserveSelection: modifierKeys.meta || modifierKeys.ctrl,
    }
  }

  return { handled: false }
}
