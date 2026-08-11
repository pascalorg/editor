import { describe, expect, test } from 'bun:test'
import { exportFloorplanPdf, type FloorplanExportScope } from '@pascal-app/editor'

// Compile-time smoke assertion for the package-entry re-export (plan U2 /
// issue #619): if the entry stops re-exporting `exportFloorplanPdf` or the
// `FloorplanExportScope` type, this import fails `check-types` and the test
// fails, instead of the regression passing silently. Runtime coverage of the
// export pipeline itself lives in @pascal-app/editor's floorplan tests; here
// we only pin the public surface.
describe('package entry floorplan export surface', () => {
  test('exportFloorplanPdf accepts every scope member including routing', () => {
    const scopes: FloorplanExportScope[] = ['full', 'structure', 'routing']
    expect(scopes).toContain('routing')
    expect(typeof exportFloorplanPdf).toBe('function')
  })
})
