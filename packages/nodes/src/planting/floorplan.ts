import {
  type FloorplanGeometry,
  floorplanGeometryMetadata,
  type GeometryContext,
  type PlantingNode,
  planPlanting,
  plantingEdgeDistance,
} from '@pascal-app/core'
import { plantingContext } from './context'

/** The generated outline and the actual accepted population, not a second decorative scatter. */
export function buildPlantingFloorplan(
  node: PlantingNode,
  ctx: GeometryContext,
): FloorplanGeometry | null {
  const { ground, accept } = plantingContext(node, ctx)
  const plan = planPlanting(node, ground, accept)
  if (plan.outline.length < 3) return null
  const view = ctx.viewState
  const marked = view?.selected || view?.highlighted
  const stroke = marked ? (view?.palette?.selectedStroke ?? '#0ea5e9') : '#526443'
  const outline: FloorplanGeometry = {
    kind: 'polygon',
    points: plan.outline,
    fill: marked
      ? (view?.palette?.selectedFill ?? '#dbeafe')
      : node.ground === 'none'
        ? 'transparent'
        : node.ground === 'soil'
          ? '#9b8062'
          : '#b29b79',
    fillOpacity: 0.5,
    stroke,
    strokeWidth: node.edging === 'none' ? 1 : 1.5,
    vectorEffect: 'non-scaling-stroke',
    strokeLinejoin: 'round',
    metadata: floorplanGeometryMetadata({ annotationObstacle: 'outline' }),
  }
  const dots: FloorplanGeometry[] = plan.placements.map((plant) => ({
    kind: 'circle',
    cx: plant.x,
    cy: plant.z,
    // The plan reads Site XZ directly: +Z is the seen/front side, not the back.
    // Inscribed symbols also work in concave beds without renderer-specific SVG clipping.
    r: Math.min(
      (node.plants[plant.species]!.spread * plant.scale) / 2,
      plantingEdgeDistance(plan.outline, plant.x, plant.z),
    ),
    fill: marked
      ? (view?.palette?.selectedFill ?? '#dbeafe')
      : node.plants[plant.species]!.leafColor,
    fillOpacity: 0.8,
    stroke: 'none',
    pointerEvents: 'none',
  }))
  return { kind: 'group', children: [outline, ...dots] }
}
