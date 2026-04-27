import type { AnyNode, ItemNode, Point2D, StairNode, StairSegmentNode } from '@pascal-app/core'

export type FloorplanNodeTransform = {
  position: Point2D
  rotation: number
}

export type FloorplanLineSegment = {
  start: Point2D
  end: Point2D
}

export type FloorplanItemEntry = {
  item: ItemNode
  polygon: Point2D[]
  usesRealMesh: boolean
}

export type FloorplanStairSegmentEntry = {
  centerLine: FloorplanLineSegment | null
  innerPolygon: Point2D[]
  segment: StairSegmentNode
  polygon: Point2D[]
  treadBars: Point2D[][]
  treadThickness: number
}

export type FloorplanStairArrowEntry = {
  head: Point2D[]
  polyline: Point2D[]
}

export type FloorplanStairEntry = {
  arrow: FloorplanStairArrowEntry | null
  hitPolygons: Point2D[][]
  stair: StairNode
  segments: FloorplanStairSegmentEntry[]
}

export type FloorplanSelectionBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type StairSegmentTransform = {
  position: [number, number, number]
  rotation: number
}

export type LevelDescendantMap = ReadonlyMap<string, AnyNode>
