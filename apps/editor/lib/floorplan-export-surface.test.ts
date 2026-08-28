import { describe, expect, test } from 'bun:test'
import { exportFloorplanPdf, type FloorplanExportScope } from '@pascal-app/editor'

// Runtime smoke assertion for the package-entry re-export (plan U2 / issue
// #619): this test imports the whole @pascal-app/editor barrel, so if the
// entry stops re-exporting `exportFloorplanPdf` or the `FloorplanExportScope`
// type, the import fails at test-run time (and `check-types`) instead of the
// regression passing silently. Runtime coverage of the export pipeline
// itself lives in @pascal-app/editor's floorplan tests; here we only pin the
// public surface.
describe('package entry floorplan export surface', () => {
  test('exportFloorplanPdf accepts every scope member', () => {
    const scopes: FloorplanExportScope[] = ['full', 'structure']
    expect(scopes).toEqual(['full', 'structure'])
    expect(typeof exportFloorplanPdf).toBe('function')
  })
})
