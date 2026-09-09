import { DuctFittingNode } from '@pascal-app/core'
import { Euler, Matrix4, Vector3 } from 'three'
import { fittingLegLength } from '../duct-fitting/ports'
import { rectSectionAxes } from '../duct-segment/geometry'
import { type DuctProfile, profileDiameterIn } from './auto-fitting'
import type { ScenePort } from './ports'

export function ductProfilesMatch(a: DuctProfile, b: DuctProfile): boolean {
  return (
    a.shape === b.shape &&
    (a.shape === 'round'
      ? Math.abs(a.diameter - b.diameter) < 1e-5
      : Math.abs(a.width - b.width) < 1e-5 && Math.abs(a.height - b.height) < 1e-5)
  )
}

export function planDuctAdapter(
  port: ScenePort,
  source: DuctProfile,
  target: DuctProfile,
  widthAxis?: Vector3,
): { fitting: DuctFittingNode; collarPoint: [number, number, number] } | null {
  if (ductProfilesMatch(source, target)) return null
  const axis = new Vector3(...port.direction).normalize()
  if (axis.lengthSq() < 1e-10) return null
  const width = widthAxis?.clone() ?? rectSectionAxes(axis).width
  const height = new Vector3().crossVectors(width, axis).normalize()
  const rotation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(axis, height, width))
  const diameter = profileDiameterIn(source)
  const leg = fittingLegLength(diameter)
  const position = new Vector3(...port.position).addScaledVector(axis, leg)
  const fittingType = source.shape === target.shape ? 'reducer' : 'transition'
  const fitting = DuctFittingNode.parse({
    fittingType,
    name: fittingType === 'reducer' ? 'Reducer' : 'Transition',
    position: position.toArray(),
    rotation: [rotation.x, rotation.y, rotation.z],
    inletShape: source.shape,
    outletShape: target.shape,
    shape: source.shape,
    shape2: target.shape,
    diameter,
    diameter2: profileDiameterIn(target),
    width: source.width,
    height: source.height,
    width2: target.width,
    height2: target.height,
    system: port.system === 'return' ? 'return' : 'supply',
  })
  return { fitting, collarPoint: position.addScaledVector(axis, leg).toArray() }
}
