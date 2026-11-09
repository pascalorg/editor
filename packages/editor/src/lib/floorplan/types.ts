import type { AnyNode, ItemNode, Point2D } from '@pascal-app/core'

export type FloorplanNodeTransform = {
  position: Point2D
  rotation: number
}

export type FloorplanLineSegment = {
  start: Point2D
  end: Point2D
}

export type FloorplanItemEntry = {
  dimensionPolygon: Point2D[]
  item: ItemNode
  polygon: Point2D[]
  usesRealMesh: boolean
  center: Point2D
  rotation: number
  width: number
  depth: number
}

export type FloorplanSelectionBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type LevelDescendantMap = ReadonlyMap<string, AnyNode>
