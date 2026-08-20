import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { exportSceneToPrintStl } from './print-export'
import { compilePrintShellBaseline } from './print-shell-compiler-baseline'

function structuralBox(id: string, x: number): THREE.Group {
  const group = new THREE.Group()
  group.userData = { pascalId: id }
  group.position.x = x
  group.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)))
  return group
}

describe('print shell compiler baseline', () => {
  test('unions overlapping world-space structural meshes into a closed shell', () => {
    const source = new THREE.Group()
    source.add(structuralBox('wall_left', -0.5), structuralBox('wall_right', 0.5))

    const compiled = compilePrintShellBaseline(source)

    expect(compiled.status).toBe('compiled')
    expect(compiled.inputMeshCount).toBe(2)
    expect(compiled.sourceNodeIds).toEqual(['wall_left', 'wall_right'])
    expect(compiled.scene).not.toBeNull()

    const print = exportSceneToPrintStl(compiled.scene!, { scale: 100 })
    expect(print.report.status).toBe('pass')
    expect(print.report.bounds?.width).toBeCloseTo(30, 4)
    expect(print.report.bounds?.depth).toBeCloseTo(20, 4)
    expect(print.report.bounds?.height).toBeCloseTo(20, 4)
    expect(print.report.boundaryEdgeCount).toBe(0)
    expect(print.report.nonManifoldEdgeCount).toBe(0)
    expect(print.report.volumeMm3).toBeCloseTo(12_000, 1)
  })

  test('blocks a structural mesh without Pascal provenance', () => {
    const source = new THREE.Group()
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))

    const compiled = compilePrintShellBaseline(source)

    expect(compiled.status).toBe('blocked')
    expect(compiled.scene).toBeNull()
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing_node_provenance', severity: 'error' }),
    )
  })
})
