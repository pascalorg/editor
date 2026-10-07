import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('the floor region preview draws with WebGPU node materials, not drei fat lines', () => {
  const source = readFileSync(new URL('./floor-region-controls.tsx', import.meta.url), 'utf8')
  expect(source).not.toMatch(/@react-three\/drei/)
  expect(source).not.toMatch(/<Line\b|<lineBasicMaterial\b|<meshBasicMaterial\b|\bLineMaterial\b/)
  expect(source).toMatch(
    /import\s*\{[^}]*\bLineBasicNodeMaterial\b[^}]*\bMeshBasicNodeMaterial\b[^}]*\}\s*from\s*['"]three\/webgpu['"]/,
  )
  expect(source).toContain('<lineSegments')
})
