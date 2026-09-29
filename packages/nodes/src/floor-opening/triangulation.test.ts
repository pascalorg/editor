import { expect, test } from 'bun:test'
import { cutFloorOpening } from '../../../core/src/commands/structure/floor-opening'
import { applyToScratch, structureChangeBatch } from '../../../core/src/commands/structure/shared'
import { area } from '../../../core/src/lib/polygon-boolean'
import { reconcileSceneStructure } from '../../../core/src/lib/structure-reconcile'
import { BuildingNode, LevelNode, WallNode } from '../../../core/src/schema'
import { generateCeilingGeometry } from '../../../viewer/src/systems/ceiling/ceiling-system'

const outline: [number, number][] = [
  [0, 0],
  [6, 0],
  [6, 5],
  [0, 5],
]
let n = 0
const mintId = (kind: string) => `${kind}_triangulation_${n++}`

function house() {
  const building = BuildingNode.parse({ id: 'building_triangulation' })
  const all = [building]
  for (const levelNumber of [0, 1]) {
    const id = `level_triangulation_${levelNumber}`
    const walls = outline.map((start, index) =>
      WallNode.parse({
        id: `wall_triangulation_${levelNumber}_${index}`,
        parentId: id,
        start,
        end: outline[(index + 1) % 4],
      }),
    )
    all.push(
      LevelNode.parse({
        id,
        parentId: building.id,
        level: levelNumber,
        children: walls.map((wall) => wall.id),
      }),
      ...walls,
    )
  }
  return reconcileSceneStructure({
    nodes: Object.fromEntries(all.map((node) => [node.id, node])),
    mintId,
  }).nodes
}

function triangulatedArea(geometry: ReturnType<typeof generateCeilingGeometry>) {
  const positions = geometry.getAttribute('position')
  const indices = geometry.getIndex()
  const count = indices?.count ?? positions.count
  let sum = 0
  for (let i = 0; i < count; i += 3) {
    const a = indices?.getX(i) ?? i
    const b = indices?.getX(i + 1) ?? i + 1
    const c = indices?.getX(i + 2) ?? i + 2
    const ax = positions.getX(a),
      az = positions.getZ(a)
    const bx = positions.getX(b),
      bz = positions.getZ(b)
    const cx = positions.getX(c),
      cz = positions.getZ(c)
    sum += Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2
  }
  geometry.dispose()
  return sum
}

test('ceiling opening strip and edge notch triangulate to their remaining surface area', () => {
  for (const polygon of [
    [
      [2.5, -1],
      [3.5, -1],
      [3.5, 6],
      [2.5, 6],
    ],
    [
      [0, 2],
      [1.5, 2],
      [1.5, 3],
      [0, 3],
    ],
  ] as Array<Array<[number, number]>>) {
    const before = house()
    const plan = cutFloorOpening(before, { levelId: 'level_triangulation_1', polygon, mintId })
    const opened = reconcileSceneStructure({
      nodes: applyToScratch(before, structureChangeBatch(plan.changes)),
      mintId,
    }).nodes
    const ceilings = Object.values(opened).filter(
      (node) => node.type === 'ceiling' && node.parentId === 'level_triangulation_0',
    )
    expect(ceilings.length).toBeGreaterThan(0)
    for (const ceiling of ceilings) {
      if (ceiling.type !== 'ceiling') continue
      const expected = area([{ outer: ceiling.polygon, holes: ceiling.holes }])
      expect(triangulatedArea(generateCeilingGeometry(ceiling))).toBeCloseTo(expected, 3)
      expect(ceiling.openingIds).toContain(plan.openingIds[0])
    }
  }
})
