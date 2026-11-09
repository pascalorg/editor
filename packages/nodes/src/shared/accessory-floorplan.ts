import type {
  DuctFittingNode,
  FloorplanGeometry,
  GeometryContext,
  PipeFittingNode,
} from '@pascal-app/core'
import { Euler, type Group, Mesh, Vector3 } from 'three'

type Point = [number, number]
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
function hull(points: Point[]): Point[] {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const chain = (list: Point[]) => {
    const result: Point[] = []
    for (const p of list) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, p) <= 0) result.pop()
      result.push(p)
    }
    return result.slice(0, -1)
  }
  return [...chain(points), ...chain([...points].reverse())]
}

export function accessoryFloorplan(
  group: Group,
  node: DuctFittingNode | PipeFittingNode,
  ctx: GeometryContext,
): FloorplanGeometry {
  group.updateMatrixWorld(true)
  const euler = new Euler(...node.rotation)
  const selected = ctx.viewState?.selected || ctx.viewState?.highlighted
  const stroke = selected ? (ctx.viewState?.palette?.selectedStroke ?? '#6366f1') : '#475569'
  const children: FloorplanGeometry[] = []
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const positions = object.geometry.getAttribute('position')
    const points: Point[] = []
    for (let i = 0; i < positions.count; i++) {
      const p = new Vector3()
        .fromBufferAttribute(positions, i)
        .applyMatrix4(object.matrixWorld)
        .applyEuler(euler)
      points.push([p.x + node.position[0], p.z + node.position[2]])
    }
    const outline = hull(points)
    if (outline.length >= 3)
      children.push({
        kind: 'polygon',
        points: outline,
        fill: '#cbd5e1',
        stroke,
        strokeWidth: 1,
        vectorEffect: 'non-scaling-stroke',
      })
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      material.dispose()
  })
  if (selected) children.push({ kind: 'move-handle', point: [node.position[0], node.position[2]] })
  return { kind: 'group', children }
}
