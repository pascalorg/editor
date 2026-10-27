import { emptyConversionReport, keepValidTriangles } from '../geometry-validity'

// keepValidTriangles on a million-triangle grid whose every normal is NaN, so every vertex goes
// through the recompute. Prints the best of five runs as JSON.
const side = 708 // (side - 1)^2 * 2 ≈ 1M triangles
const positions: number[] = []
const normals: number[] = []
for (let z = 0; z < side; z++)
  for (let x = 0; x < side; x++) {
    positions.push(x, Math.sin(x / 10) * Math.cos(z / 10), z)
    normals.push(Number.NaN, Number.NaN, Number.NaN)
  }
const indices: number[] = []
for (let z = 0; z + 1 < side; z++)
  for (let x = 0; x + 1 < side; x++) {
    const a = z * side + x
    indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1)
  }

let best = Number.POSITIVE_INFINITY
let recomputed = 0
for (let run = 0; run < 5; run++) {
  Bun.gc(true)
  const report = emptyConversionReport()
  const started = performance.now()
  keepValidTriangles({ positions, normals: [...normals], indices }, report)
  best = Math.min(best, performance.now() - started)
  recomputed = report.replaced.normals
}
console.log(JSON.stringify({ triangles: indices.length / 3, recomputed, bestMs: Math.round(best) }))
