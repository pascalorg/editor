import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// `drawsLines`: the file renders line geometry, which must go through the
// WebGPU node material. The Divide preview draws a strip mesh like the wall
// draft instead, so it only has to stay clear of drei fat lines.
for (const [file, drawsLines] of [
  ['./room-controls.tsx', false],
  ['./room-highlight.tsx', true],
  ['../../../../nodes/src/separator/renderer.tsx', true],
] as const) {
  test(`${file} uses WebGPU node materials instead of drei fat lines`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const dreiImports = source.matchAll(
      /import\s+([\w\s{},*]+)\s+from\s+['"]@react-three\/drei['"]/g,
    )
    for (const [, bindings] of dreiImports) {
      expect(bindings).not.toMatch(/\bLine\b|\*/)
    }
    expect(source).not.toMatch(/<Line\b|<lineBasicMaterial\b|\bLineMaterial\b/)
    if (!drawsLines) return
    expect(source).toMatch(
      /import\s*\{[^}]*\bLineBasicNodeMaterial\b[^}]*\}\s*from\s*['"]three\/webgpu['"]/,
    )
    expect(source).toContain('<lineSegments')
  })
}
