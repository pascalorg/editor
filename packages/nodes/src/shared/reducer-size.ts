const DUCT_SIZES = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 48]
const PIPE_SIZES = [1.25, 1.5, 2, 3, 4, 6, 8, 10, 12, 16]

export function reducerOutletDiameter(
  kind: 'duct-fitting' | 'pipe-fitting',
  inlet: number,
  outlet: number,
): number {
  if (Math.abs(inlet - outlet) > 0.000001) return outlet
  const sizes = kind === 'duct-fitting' ? DUCT_SIZES : PIPE_SIZES
  for (let i = sizes.length - 1; i >= 0; i--) {
    if (sizes[i]! < inlet) return sizes[i]!
  }
  return sizes.find((size) => size > inlet) ?? outlet
}
