import { describe, expect, test } from 'bun:test'
import { CustomMeshNode } from '@pascal-app/core'
import { createSurfaceRoleMaterial } from '@pascal-app/viewer'
import { Mesh, Ray, Vector3, type Vector3Tuple } from 'three'
import { applyCustomMeshCommand } from './commands'
import { buildCustomMeshGeometry } from './geometry'
import { customMeshPaint } from './paint'

describe('buildCustomMeshGeometry', () => {
  test('uses the active theme role when the body material cannot resolve', () => {
    const node = CustomMeshNode.parse({
      name: 'Themed mesh',
      slots: { body: 'scene:missing' },
    })
    const group = buildCustomMeshGeometry(node, undefined, 'rendered', true, 'blueprint', 'studio')
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh) || !Array.isArray(mesh.material)) return
    expect(mesh.material[0]).toBe(
      createSurfaceRoleMaterial('wall', 'blueprint', undefined, 'studio'),
    )
  })

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

  test('resolves every default-box surface to its stable topology face', () => {
    const node = CustomMeshNode.parse({ name: 'Raycast mesh' })
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    const rays: Array<[string, Vector3Tuple, Vector3Tuple]> = [
      ['f-bottom', [0, -10, 0], [0, 1, 0]],
      ['f-top', [0, 10, 0], [0, -1, 0]],
      ['f-front', [0, 1.2, -10], [0, 0, 1]],
      ['f-right', [10, 1.2, 0], [-1, 0, 0]],
      ['f-back', [0, 1.2, 10], [0, 0, -1]],
      ['f-left', [-10, 1.2, 0], [1, 0, 0]],
    ]

    for (const [faceId, origin, direction] of rays) {
      expect(
        customMeshPaint.resolveRole({
          node,
          hitObject: mesh,
          materialIndex: 0,
          ray: new Ray(new Vector3(...origin), new Vector3(...direction)),
        }),
      ).toBe(`face_${faceId}`)
    }
  })

  test('resolves a face through the rendered mesh world transform', () => {
    const node = CustomMeshNode.parse({ name: 'Transformed raycast mesh' })
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    group.position.set(3, 2, -4)
    group.rotation.y = Math.PI / 2
    group.updateMatrixWorld(true)
    const origin = new Vector3(0, 1.2, -10).applyMatrix4(group.matrixWorld)
    const direction = new Vector3(0, 0, 1).transformDirection(group.matrixWorld)

    expect(
      customMeshPaint.resolveRole({
        node,
        hitObject: mesh,
        materialIndex: 0,
        ray: new Ray(origin, direction),
      }),
    ).toBe('face_f-front')
  })

  test('omits malformed faces from geometry and paint hit metadata', () => {
    const base = CustomMeshNode.parse({ name: 'Malformed topology mesh' })
    const node = {
      ...base,
      topology: {
        ...base.topology,
        faces: [
          ...base.topology.faces,
          { id: 'f-malformed', vertexIds: ['v0', 'v1', 'missing'], materialSlot: 'body' },
        ],
      },
    }
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.geometry.getAttribute('position').count).toBe(36)
    expect(mesh.geometry.userData.customMeshFaces).toHaveLength(6)
    expect(
      mesh.geometry.userData.customMeshFaces.some(
        (range: { faceId: string }) => range.faceId === 'f-malformed',
      ),
    ).toBe(false)
  })

  test('resolves and previews only the hit topology face', () => {
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
    const role = customMeshPaint.resolveRole({
      node,
      hitObject: mesh,
      materialIndex: 1,
      ray: new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0)),
    })
    expect(role).toBe('face_f-top')
    expect(Array.isArray(mesh.material)).toBe(true)
    if (!Array.isArray(mesh.material)) return
    const previous = mesh.material
    const previousGroupIndices = mesh.geometry.groups.map((group) => group.materialIndex)
    const restore = customMeshPaint.applyPreview({
      node,
      role: role!,
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
    expect(mesh.material.slice(0, previous.length)).toEqual(previous)
    expect(mesh.material).toHaveLength(previous.length + 1)
    expect(mesh.geometry.groups[0]?.materialIndex).toBe(previousGroupIndices[0])
    expect(mesh.geometry.groups[1]?.materialIndex).toBe(previous.length)
    restore?.()
    expect(mesh.material).toBe(previous)
    expect(mesh.geometry.groups.map((group) => group.materialIndex)).toEqual(previousGroupIndices)
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
    const previousGroupIndices = mesh.geometry.groups.map((group) => group.materialIndex)

    const restore = customMeshPaint.applyPreview({
      node,
      role: 'face_f-top',
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
    expect(mesh.material).toHaveLength(3)
    expect(mesh.material[0]).toBe(previous)
    expect(mesh.material[1]).toBe(previous)
    expect(mesh.material[2]).not.toBe(previous)
    expect(mesh.geometry.groups[1]?.materialIndex).toBe(2)
    restore?.()
    expect(mesh.material).toBe(previous)
    expect(mesh.geometry.groups.map((group) => group.materialIndex)).toEqual(previousGroupIndices)
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
