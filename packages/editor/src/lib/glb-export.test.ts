import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { type AnyNode, DoorNode, sceneRegistry } from '@pascal-app/core'
import * as THREE from 'three'

let buildDoorPreviewMesh: (node: DoorNode) => THREE.Mesh
let prepareSceneForExport: typeof import('./glb-export').prepareSceneForExport

beforeAll(async () => {
  const poseDoorMovingParts = (node: DoorNode, mesh: THREE.Object3D | undefined, value: number) => {
    if (!mesh) return false
    if (node.doorType === 'sliding') {
      const group = mesh.getObjectByName('door-sliding-active')
      if (!group) return false
      group.position.x = -0.44 * (node.width - 2 * node.frameThickness) * value
      return true
    }
    if (node.doorType === 'folding') {
      let posed = false
      for (let index = 0; index < (node.leafCount === 2 ? 2 : 4); index++) {
        const group = mesh.getObjectByName(`door-fold-${index}`)
        if (!group) continue
        posed = true
        group.rotation.set(0, value * 0.1 * (index % 2 === 0 ? 1 : -1), 0)
      }
      return posed
    }
    return false
  }

  mock.module('@pascal-app/viewer', () => {
    return {
      poseDoorMovingParts,
      poseWindowMovingParts: () => false,
      SCENE_LAYER: 0,
      snapLevelsToTruePositions: () => () => {},
    }
  })

  buildDoorPreviewMesh = (node: DoorNode) => {
    const mesh = new THREE.Mesh()
    for (let index = 0; index < (node.leafCount === 2 ? 2 : 4); index++) {
      const panel = new THREE.Group()
      panel.name = `door-fold-${index}`
      panel.add(meshWithNodeMaterial(nodeMaterial()))
      mesh.add(panel)
    }
    return mesh
  }
  const glbExport = await import('./glb-export')
  prepareSceneForExport = glbExport.prepareSceneForExport
})

afterAll(() => {
  mock.restore()
})

afterEach(() => {
  sceneRegistry.clear()
})

function nodeMaterial(overrides: Record<string, unknown> = {}) {
  return {
    isNodeMaterial: true,
    name: 'painted',
    color: new THREE.Color('#cc3300'),
    roughness: 0.3,
    metalness: 0.7,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    alphaTest: 0,
    depthWrite: true,
    depthTest: true,
    vertexColors: false,
    toneMapped: true,
    ...overrides,
  } as unknown as THREE.Material
}

function meshWithNodeMaterial(material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)
}

describe('prepareSceneForExport', () => {
  test('converts NodeMaterials to classic glTF-standard materials', () => {
    const root = new THREE.Group()
    const mesh = meshWithNodeMaterial(nodeMaterial())
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})

    const exported = scene.children[0] as THREE.Mesh
    const material = exported.material as THREE.MeshStandardMaterial
    expect(material.isMeshStandardMaterial).toBe(true)
    expect(material.roughness).toBeCloseTo(0.3)
    expect(material.metalness).toBeCloseTo(0.7)
    expect(material.color.getHexString()).toBe('cc3300')
  })

  test('does not flag a door openable when no open clip bakes', () => {
    const root = new THREE.Group()
    const openingGroup = new THREE.Group()
    openingGroup.add(meshWithNodeMaterial(nodeMaterial()))
    root.add(openingGroup)

    const openingId = 'door_opening'
    sceneRegistry.nodes.set(openingId, openingGroup)
    const nodes: Record<string, AnyNode> = {
      [openingId]: {
        object: 'node',
        id: openingId,
        type: 'door',
        name: 'Cased opening',
      } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(0)
    const exported = scene.getObjectByProperty('name', openingId)
    expect(exported?.userData).toEqual({
      pascalId: openingId,
      kind: 'door',
      label: 'Cased opening',
    })
  })

  test('bakes a sliding door into a sampled position clip', () => {
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const activePanel = new THREE.Group()
    activePanel.name = 'door-sliding-active'
    activePanel.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(activePanel)
    root.add(doorGroup)

    const doorId = 'door_sliding'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Slider',
        doorType: 'sliding',
        slideDirection: 'left',
        width: 1,
        height: 2.1,
        frameThickness: 0.05,
      } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const clip = animations[0]!
    expect(clip.name).toBe('door_sliding: open')
    expect(clip.userData).toEqual({ loop: false })

    const track = clip.tracks[0]!
    expect(track).toBeInstanceOf(THREE.VectorKeyframeTrack)
    expect(track.name.endsWith('.position')).toBe(true)
    expect(track.times.length).toBe(17)
    expect(track.times[0]).toBeCloseTo(0)
    expect(track.times[track.times.length - 1]!).toBeCloseTo(1)

    expect(track.values[0]!).toBeCloseTo(0)
    const lastX = track.values[track.values.length - 3]!
    expect(Math.abs(lastX)).toBeGreaterThan(0.1)
    expect(scene.getObjectByProperty('uuid', track.name.replace('.position', ''))).toBeDefined()
  })

  test('bakes an identity rest pose for an open folding door', () => {
    const node = DoorNode.parse({
      id: 'door_folding',
      doorType: 'folding',
      leafCount: 4,
      operationState: 0.65,
    })
    const mesh = buildDoorPreviewMesh(node)
    const root = new THREE.Group()
    root.add(mesh)
    sceneRegistry.nodes.set(node.id, mesh)

    const { scene, animations } = prepareSceneForExport(root, {
      [node.id]: node as unknown as AnyNode,
    })

    expect(animations).toHaveLength(1)
    for (let index = 0; index < 4; index++) {
      const panel = scene.getObjectByName(`door-fold-${index}`)
      expect(panel).toBeDefined()
      expect(panel!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-4)
    }
  })
})
