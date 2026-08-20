import { type Brush, type Evaluator, SUBTRACTION } from 'three-bvh-csg'
import { prepareBrushForCSG } from '../../lib/csg-utils'

export function subtractRoofInterior(layer: Brush, interior: Brush, evaluator: Evaluator): Brush {
  const result = evaluator.evaluate(layer, interior, SUBTRACTION) as Brush
  prepareBrushForCSG(result)
  return result
}
