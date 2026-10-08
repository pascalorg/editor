/**
 * Plate thicknesses of an i-beam column. The flanges span the width (local X)
 * at the front and back faces; the web joins them along the depth (local Z).
 */
export function columnIBeamSection(
  width: number,
  depth: number,
): { flangeThickness: number; webThickness: number } {
  return {
    flangeThickness: Math.max(0.01, depth * 0.1),
    webThickness: Math.max(0.01, width * 0.1),
  }
}

/** Plan outline of an i-beam section centred on the column axis, in local XZ. */
export function columnIBeamOutline(width: number, depth: number): [number, number][] {
  const { flangeThickness, webThickness } = columnIBeamSection(width, depth)
  const x = width / 2
  const z = depth / 2
  const webX = webThickness / 2
  const innerZ = Math.max(0, z - flangeThickness)
  return [
    [-x, -z],
    [x, -z],
    [x, -innerZ],
    [webX, -innerZ],
    [webX, innerZ],
    [x, innerZ],
    [x, z],
    [-x, z],
    [-x, innerZ],
    [-webX, innerZ],
    [-webX, -innerZ],
    [-x, -innerZ],
  ]
}
