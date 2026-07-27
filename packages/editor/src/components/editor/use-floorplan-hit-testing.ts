'use client'

import { type RefObject, useCallback } from 'react'
import type { FloorplanSelectionBounds } from '../../lib/floorplan/types'
import {
  type Point2 as MarqueePoint2,
  polygonsIntersect,
  segmentIntersectsPolygon,
} from '../tools/select/marquee-geometry'
import { collectSelectableCandidateIds } from '../tools/select/select-candidates'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'

const REGISTRY_ENTRY_SELECTOR = '.floorplan-registry-base .floorplan-registry-entry[data-node-id]'
const REGISTRY_GEOMETRY_SELECTOR = 'path, polygon, polyline, rect, circle, line, image'
const POINT_HIT_EPSILON = 1e-4

type FloorplanHitTestingOptions = {
  sceneRef: RefObject<SVGGElement | null>
}

function boundsPolygon(bounds: FloorplanSelectionBounds): MarqueePoint2[] {
  return [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
  ]
}

function transformElementBoxToScene(
  element: SVGGraphicsElement,
  scene: SVGGElement,
): MarqueePoint2[] | null {
  const elementMatrix = element.getScreenCTM()
  const sceneMatrix = scene.getScreenCTM()
  const svg = scene.ownerSVGElement
  if (!(elementMatrix && sceneMatrix && svg)) {
    return null
  }

  let box: DOMRect
  try {
    box = element.getBBox()
  } catch {
    return null
  }

  const inverseSceneMatrix = sceneMatrix.inverse()
  const corners: MarqueePoint2[] = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ]
  return corners.map(([x, y]) => {
    const point = svg.createSVGPoint()
    point.x = x
    point.y = y
    const screenPoint = point.matrixTransform(elementMatrix)
    const scenePoint = screenPoint.matrixTransform(inverseSceneMatrix)
    return [scenePoint.x, scenePoint.y] as MarqueePoint2
  })
}

function elementIntersectsPlanPolygon(
  element: SVGGraphicsElement,
  scene: SVGGElement,
  selectionPolygon: MarqueePoint2[],
): boolean {
  const polygon = transformElementBoxToScene(element, scene)
  if (!polygon) {
    return false
  }

  const [first, second, third] = polygon
  if (!(first && second && third)) {
    return false
  }

  const width = Math.hypot(second[0] - first[0], second[1] - first[1])
  const height = Math.hypot(third[0] - second[0], third[1] - second[1])
  if (width <= POINT_HIT_EPSILON || height <= POINT_HIT_EPSILON) {
    const end = width >= height ? second : third
    return segmentIntersectsPolygon(first, end, selectionPolygon)
  }

  return polygonsIntersect(polygon, selectionPolygon)
}

export function collectRegistrySelectionIdsInBounds(
  scene: SVGGElement,
  bounds: FloorplanSelectionBounds,
  candidateIds = collectSelectableCandidateIds(),
): string[] {
  const candidateIdSet = new Set(candidateIds)
  const selectionPolygon = boundsPolygon(bounds)
  const hitIds = new Set<string>()

  for (const entry of scene.querySelectorAll<SVGGElement>(REGISTRY_ENTRY_SELECTOR)) {
    const nodeId = entry.dataset.nodeId
    if (!nodeId || !candidateIdSet.has(nodeId)) {
      continue
    }

    const geometry = entry.querySelectorAll<SVGGraphicsElement>(REGISTRY_GEOMETRY_SELECTOR)
    const elements = geometry.length > 0 ? Array.from(geometry) : [entry]
    if (
      elements.some((element) => elementIntersectsPlanPolygon(element, scene, selectionPolygon))
    ) {
      hitIds.add(nodeId)
    }
  }

  return candidateIds.filter((id) => hitIds.has(id))
}

export function getRegistryHitIdAtPlanPoint(
  scene: SVGGElement,
  planPoint: WallPlanPoint,
  candidateIds = collectSelectableCandidateIds(),
): string | null {
  const sceneMatrix = scene.getScreenCTM()
  const svg = scene.ownerSVGElement
  if (!(sceneMatrix && svg)) {
    return null
  }

  const point = svg.createSVGPoint()
  point.x = planPoint[0]
  point.y = planPoint[1]
  const screenPoint = point.matrixTransform(sceneMatrix)
  const candidateIdSet = new Set(candidateIds)

  if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
    for (const element of document.elementsFromPoint(screenPoint.x, screenPoint.y)) {
      const entry = element.closest<SVGGElement>('.floorplan-registry-entry[data-node-id]')
      const nodeId = entry?.dataset.nodeId
      if (entry && nodeId && candidateIdSet.has(nodeId) && scene.contains(entry)) {
        return nodeId
      }
    }
  }

  const hits = collectRegistrySelectionIdsInBounds(
    scene,
    {
      minX: planPoint[0] - POINT_HIT_EPSILON,
      maxX: planPoint[0] + POINT_HIT_EPSILON,
      minY: planPoint[1] - POINT_HIT_EPSILON,
      maxY: planPoint[1] + POINT_HIT_EPSILON,
    },
    candidateIds,
  )
  return hits.at(-1) ?? null
}

export function useFloorplanHitTesting({ sceneRef }: FloorplanHitTestingOptions) {
  const getFloorplanHitIdAtPoint = useCallback(
    (planPoint: WallPlanPoint) => {
      const scene = sceneRef.current
      return scene ? getRegistryHitIdAtPlanPoint(scene, planPoint) : null
    },
    [sceneRef],
  )

  const getFloorplanSelectionIdsInBounds = useCallback(
    (bounds: FloorplanSelectionBounds) => {
      const scene = sceneRef.current
      return scene ? collectRegistrySelectionIdsInBounds(scene, bounds) : []
    },
    [sceneRef],
  )

  return {
    getFloorplanHitIdAtPoint,
    getFloorplanSelectionIdsInBounds,
  }
}
