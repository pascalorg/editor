import type { AnyNode, ItemNode, StairNode, StairSegmentNode } from '../schema'
import type { Point2D } from '../systems/wall/wall-mitering'

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
