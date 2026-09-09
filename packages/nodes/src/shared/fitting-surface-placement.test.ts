import { expect, test } from 'bun:test'
import { DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { Box3, Euler, Mesh, Quaternion, Vector3 } from 'three'
import { buildDuctFittingGeometry } from '../duct-fitting/geometry'
import { resolvePlacement as placeDuct } from '../duct-fitting/tool'
import { buildPipeFittingGeometry } from '../pipe-fitting/geometry'
import { resolvePlacement as placePipe } from '../pipe-fitting/tool'

test('a balancing damper rests above the floor instead of sinking through the grid', () => {
  const node = DuctFittingNode.parse({ fittingType: 'damper' })
  const placement = placeDuct([0, 0, 0], node, 0.5, new Quaternion(), false)
  const geometry = buildDuctFittingGeometry(node)
  geometry.position.set(...placement.position)
  expect(new Box3().setFromObject(geometry).min.y).toBeGreaterThanOrEqual(-0.000001)
})
test('a pipe elbow rests above the floor', () => {
  const node = PipeFittingNode.parse({ fittingType: 'elbow' })
  const placement = placePipe([0, 0, 0], node, 0, new Quaternion(), false)
  const geometry = buildPipeFittingGeometry(node)
  geometry.position.set(...placement.position)
  expect(new Box3().setFromObject(geometry).min.y).toBeGreaterThanOrEqual(-0.000001)
})

for (const family of ['duct', 'pipe'] as const) {
  const variants =
    family === 'duct'
      ? [
          'elbow',
          'tee',
          'cross',
          'reducer',
          'transition',
          'end-cap',
          'damper',
          'access-panel',
          'coupling',
        ]
      : ['elbow', 'wye', 'sanitary-tee', 'cross', 'end-cap', 'cleanout', 'reducer', 'coupling']
  for (const fittingType of variants) {
    test(`${family} ${fittingType} stays outside floor, wall and ceiling surfaces after rotation`, () => {
      for (const normal of [
        [0, 1, 0],
        [1, 0, 0],
        [0, -1, 0],
        [0.6, 0.8, 0],
      ] as [number, number, number][]) {
        for (const step of [0, 0.5]) {
          const raw: [number, number, number] = [1.23, 2.34, 3.45]
          const quaternion = new Quaternion().setFromEuler(new Euler(0.7, 0.4, 1.1))
          const node =
            family === 'duct'
              ? DuctFittingNode.parse({ fittingType })
              : PipeFittingNode.parse({ fittingType, cleanoutStyle: 'inline' })
          const placement =
            node.type === 'duct-fitting'
              ? placeDuct(raw, node, step, quaternion, true, normal)
              : placePipe(raw, node, step, quaternion, true, normal)
          const geometry =
            node.type === 'duct-fitting'
              ? buildDuctFittingGeometry({ ...node, rotation: placement.rotation })
              : buildPipeFittingGeometry({ ...node, rotation: placement.rotation })
          geometry.position.set(...placement.position)
          geometry.rotation.set(...placement.rotation)
          geometry.updateMatrixWorld(true)
          let minimum = Infinity
          geometry.traverse((object) => {
            if (!(object instanceof Mesh)) return
            const points = object.geometry.getAttribute('position')
            for (let i = 0; i < points.count; i++) {
              const point = new Vector3()
                .fromBufferAttribute(points, i)
                .applyMatrix4(object.matrixWorld)
              minimum = Math.min(
                minimum,
                point.sub(new Vector3(...raw)).dot(new Vector3(...normal)),
              )
            }
            object.geometry.dispose()
          })
          expect(minimum).toBeCloseTo(0.001, 5)
        }
      }
    })
  }
}
