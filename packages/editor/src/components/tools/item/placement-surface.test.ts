import { describe, expect, test } from 'bun:test'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { resolveItemPlacementSurfaceNormal } from './placement-surface'

describe('resolveItemPlacementSurfaceNormal', () => {
  test('uses the full face normal for a sloped block host', () => {
    const normal = new Vector3(0, 0.6, 0.8).normalize()
    const xAxis = new Vector3(1, 0, 0)
    const yAxis = new Vector3().crossVectors(normal, xAxis).normalize()
    const faceQuaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(xAxis, yAxis, normal),
    )

    const resolved = resolveItemPlacementSurfaceNormal(
      'block-face',
      faceQuaternion,
      null,
      new Vector3(),
      'wall',
    )

    expect(resolved.toArray()).toEqual(normal.toArray())
  })

  test('uses the upward host normal for a floor item on a block top face', () => {
    const faceQuaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, 1, 0)),
    )
    const itemQuaternion = faceQuaternion.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    )

    const resolved = resolveItemPlacementSurfaceNormal(
      'block-face',
      itemQuaternion,
      null,
      new Vector3(),
    )

    expect(resolved.toArray().map((value) => Math.round(value))).toEqual([0, 1, 0])
  })

  test('uses the downward host normal for a block ceiling attachment', () => {
    const faceQuaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0)),
    )
    const itemQuaternion = faceQuaternion.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2),
    )

    const resolved = resolveItemPlacementSurfaceNormal(
      'block-face',
      itemQuaternion,
      null,
      new Vector3(),
      'ceiling',
    )

    expect(resolved.toArray().map((value) => Math.round(value))).toEqual([0, -1, 0])
  })
})
