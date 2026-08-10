'use client'

import type { ZoneNode as ZoneNodeType } from '@pascal-app/core'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'

type ModifierKeys = {
  meta: boolean
  ctrl: boolean
  shift: boolean
  /** Alt alone: select one session-group member without expanding. */
  alt: boolean
}

type ResolveFloorplanBackgroundSelectionArgs = {
  canSelectElementFloorplanGeometry: boolean
  canSelectFloorplanZones: boolean
  currentSelectedIds: string[]
  /** Session-group expand on plain click (not on modifier/Alt). */
  expandIdsForNode?: (nodeId: string) => string[] | null
  getFloorplanHitIdAtPoint: (planPoint: WallPlanPoint) => string | null
  isWallBuildActive: boolean
  modifierKeys: ModifierKeys
  planPoint: WallPlanPoint
  structureLayer: string
}

function hasToggleModifier(modifierKeys: ModifierKeys): boolean {
  return modifierKeys.meta || modifierKeys.ctrl || modifierKeys.shift
}

function resolveHitSelection(
  hitId: string,
  currentSelectedIds: string[],
  modifierKeys: ModifierKeys,
  expandIdsForNode?: (nodeId: string) => string[] | null,
): string[] {
  if (hasToggleModifier(modifierKeys)) {
    return currentSelectedIds.includes(hitId)
      ? currentSelectedIds.filter((selectedId) => selectedId !== hitId)
      : [...currentSelectedIds, hitId]
  }
  if (modifierKeys.alt) return [hitId]
  const expanded = expandIdsForNode?.(hitId)
  return expanded && expanded.length > 1 ? expanded : [hitId]
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
  expandIdsForNode,
  getFloorplanHitIdAtPoint,
  isWallBuildActive,
  modifierKeys,
  planPoint,
  structureLayer,
}: ResolveFloorplanBackgroundSelectionArgs): FloorplanBackgroundSelectionResult {
  if (canSelectFloorplanZones) {
    const zoneId = getFloorplanHitIdAtPoint(planPoint)
    if (zoneId) {
      return {
        handled: true,
        kind: 'select-zone',
        zoneId: zoneId as ZoneNodeType['id'],
      }
    }
  }

  if (canSelectElementFloorplanGeometry) {
    const hitId = getFloorplanHitIdAtPoint(planPoint)
    if (hitId) {
      return {
        handled: true,
        kind: 'select-elements',
        selectedIds: resolveHitSelection(hitId, currentSelectedIds, modifierKeys, expandIdsForNode),
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
      preserveSelection: hasToggleModifier(modifierKeys),
    }
  }

  return { handled: false }
}
