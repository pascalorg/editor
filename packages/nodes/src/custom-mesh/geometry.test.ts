import { describe, expect, test } from 'bun:test'
import { CustomMeshNode } from '@pascal-app/core'
import { Mesh, type Vector3Tuple } from 'three'
import { applyCustomMeshCommand } from './commands'
import { buildCustomMeshGeometry } from './geometry'
import { customMeshPaint } from './paint'

describe('buildCustomMeshGeometry', () => {
  test('derives a render mesh from persistent topology', () => {
    const node = CustomMeshNode.parse({ name: 'Box' })
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.geometry.getAttribute('position').count).toBe(36)
    expect(mesh.geometry.getAttribute('normal').count).toBe(36)
    expect(mesh.geometry.getAttribute('uv').count).toBe(36)
    expect(mesh.geometry.userData.customMeshFaces).toHaveLength(6)
  })

  test('uses the whole-mesh body material for every topology face slot', () => {
    const base = CustomMeshNode.parse({
      name: 'Painted mesh',
      slots: {
        body: 'library:metal-steel',
        accent: 'library:preset-softwhite',
      },
    })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: base.topology.faces.map((face, index) => ({
          ...face,
          materialSlot: index % 2 === 0 ? 'body' : 'accent',
        })),
      },
    }
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    expect(Array.isArray(mesh.material)).toBe(false)
    expect(new Set(materials).size).toBe(1)
    expect(mesh.userData.slotId).toBe('body')
  })

  test('previews the selected paint material across the whole mesh', () => {
    const node = CustomMeshNode.parse({ name: 'Preview mesh' })
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    mesh.userData.__fromGeometry = true
    const previous = mesh.material
    const restore = customMeshPaint.applyPreview({
      node,
      role: 'body',
      material: {
        preset: 'custom',
        properties: { color: '#c2410c' },
      },
      materialPreset: undefined,
      root: group,
    })

    expect(restore).toBeFunction()
    expect(mesh.material).not.toBe(previous)
    restore?.()
    expect(mesh.material).toBe(previous)
  })

  test('rebuilds the extruded topology into additional face triangles', () => {
    const node = CustomMeshNode.parse({ name: 'Box' })
    const result = applyCustomMeshCommand(node.topology, {
      type: 'extrude-face',
      faceId: 'f-top',
      distance: 0.25,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const group = buildCustomMeshGeometry({ ...node, topology: result.topology })
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.geometry.getAttribute('position').count).toBe(60)
    expect(mesh.geometry.userData.customMeshFaces).toHaveLength(10)
  })

  test('smooths rounded bevel bands without softening the original box corners', () => {
    const node = CustomMeshNode.parse({ name: 'Box' })
    const result = applyCustomMeshCommand(node.topology, {
      type: 'bevel-edge',
      edgeId: 'e0',
      width: 0.2,
      segments: 6,
      profile: 0.5,
      clampOverlap: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const group = buildCustomMeshGeometry({ ...node, topology: result.topology })
    const mesh = group.getObjectByName('custom-mesh-body')
    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return

    const railPosition = result.topology.vertices.find((vertex) => vertex.id === 'v10')!.position
    const position = mesh.geometry.getAttribute('position')
    const normal = mesh.geometry.getAttribute('normal')
    const normalsAt = (target: Vector3Tuple) => {
      const matches: Vector3Tuple[] = []
      for (let index = 0; index < position.count; index += 1) {
        if (
          Math.hypot(
            position.getX(index) - target[0],
            position.getY(index) - target[1],
            position.getZ(index) - target[2],
          ) < 1e-6
        ) {
          matches.push([normal.getX(index), normal.getY(index), normal.getZ(index)])
        }
      }
      return matches
    }
    const roundedNormals = normalsAt(railPosition).filter(([x]) => Math.abs(x) < 0.5)
    const roundedNormalKeys = new Set(
      roundedNormals.map((values) => values.map((value) => value.toFixed(5)).join(',')),
    )
    expect(roundedNormals.length).toBeGreaterThan(1)
    expect(roundedNormalKeys.size).toBe(1)

    const hardCornerNormalKeys = new Set(
      normalsAt([1, 0, 1]).map((values) => values.map((value) => value.toFixed(5)).join(',')),
    )
    expect(hardCornerNormalKeys.size).toBe(3)
  })
})
