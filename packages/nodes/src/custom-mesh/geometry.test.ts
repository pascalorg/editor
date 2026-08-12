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

  test('maps topology face slots to geometry groups and material-array entries', () => {
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
    expect(Array.isArray(mesh.material)).toBe(true)
    expect(mesh.material).toHaveLength(2)
    expect(mesh.geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 0, 1, 0, 1])
    expect(mesh.userData.slotIds).toEqual(['body', 'accent'])
  })

  test('resolves and previews only the hit material slot', () => {
    const base = CustomMeshNode.parse({
      name: 'Preview mesh',
      slots: { accent: 'library:preset-softwhite' },
    })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: base.topology.faces.map((face, index) => ({
          ...face,
          materialSlot: index === 1 ? 'accent' : 'body',
        })),
      },
    }
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    mesh.userData.__fromGeometry = true
    expect(customMeshPaint.resolveRole({ node, hitObject: mesh, materialIndex: 1 })).toBe('accent')
    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) return
    const previous = mesh.material
    const restore = customMeshPaint.applyPreview({
      node,
      role: 'accent',
      material: {
        preset: 'custom',
        properties: { color: '#c2410c' },
      },
      materialPreset: undefined,
      root: group,
    })

    expect(restore).toBeFunction()
    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) return
    expect(mesh.material[0]).toBe(previous[0])
    expect(mesh.material[1]).not.toBe(previous[1])
    restore?.()
    expect(mesh.material).toBe(previous)
  })

  test('previews body across face slots that render with the body fallback', () => {
    const base = CustomMeshNode.parse({ name: 'Fallback preview mesh' })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: base.topology.faces.map((face, index) => ({
          ...face,
          materialSlot: index === 1 ? 'accent' : 'body',
        })),
      },
    }
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh) || !Array.isArray(mesh.material)) return
    mesh.userData.__fromGeometry = true
    const previous = mesh.material
    expect(previous[1]).toBe(previous[0])

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

    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) return
    expect(mesh.material[1]).toBe(mesh.material[0])
    expect(mesh.material[0]).not.toBe(previous[0])
    restore?.()
    expect(mesh.material).toBe(previous)
  })

  test('previews a face slot when textures-off rendering supplies one material', () => {
    const base = CustomMeshNode.parse({
      name: 'Textures-off preview mesh',
      slots: { accent: 'library:preset-softwhite' },
    })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: base.topology.faces.map((face, index) => ({
          ...face,
          materialSlot: index === 1 ? 'accent' : 'body',
        })),
      },
    }
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh) || !Array.isArray(mesh.material)) return
    mesh.userData.__fromGeometry = true
    const previous = mesh.material[0]!
    mesh.material = previous

    const restore = customMeshPaint.applyPreview({
      node,
      role: 'accent',
      material: {
        preset: 'custom',
        properties: { color: '#c2410c' },
      },
      materialPreset: undefined,
      root: group,
    })

    expect(restore).toBeFunction()
    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) return
    expect(mesh.material).toHaveLength(2)
    expect(mesh.material[0]).toBe(previous)
    expect(mesh.material[1]).not.toBe(previous)
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
