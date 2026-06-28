import { afterEach, describe, expect, test } from 'bun:test'
import { type AnyNode, DoorNode, sceneRegistry } from '@pascal-app/core'
import { buildDoorPreviewMesh } from '@pascal-app/viewer'
import * as THREE from 'three'
import { prepareSceneForExport } from './glb-export'

afterEach(() => {
  sceneRegistry.clear()
})

function nodeMaterial(overrides: Record<string, unknown> = {}) {
  // Duck-typed stand-in for the viewer's MeshStandard/LambertNodeMaterial:
  // the exporter keys off `isNodeMaterial` and reads plain PBR props.
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
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  return new THREE.Mesh(geometry, material)
}

describe('prepareSceneForExport', () => {
  test('converts NodeMaterials to classic glTF-standard materials', () => {
    const root = new THREE.Group()
    root.name = 'scene-renderer'
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

  test('shared NodeMaterial instances convert to a single shared material', () => {
    const root = new THREE.Group()
    const shared = nodeMaterial()
    root.add(meshWithNodeMaterial(shared), meshWithNodeMaterial(shared))

    const { scene } = prepareSceneForExport(root, {})

    const meshes = scene.children as THREE.Mesh[]
    expect(meshes[0]!.material).toBe(meshes[1]!.material)
  })

  test('strips editor overlays that live off the scene layer', () => {
    const root = new THREE.Group()
    const realMesh = meshWithNodeMaterial(nodeMaterial())
    const overlay = meshWithNodeMaterial(nodeMaterial())
    overlay.layers.set(1) // OVERLAY_LAYER / EDITOR_LAYER — off scene layer 0
    root.add(realMesh, overlay)

    const { scene } = prepareSceneForExport(root, {})

    const meshes: THREE.Mesh[] = []
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
    })
    expect(meshes).toHaveLength(1)
  })

  test('neutralises an invisible hitbox root but keeps its visible children', () => {
    // Door/window roots are selection hitboxes: a box geometry with an invisible
    // material (object stays visible). Left intact it would plug the wall opening.
    const root = new THREE.Group()
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 0.2),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    const leaf = meshWithNodeMaterial(nodeMaterial())
    hitbox.add(leaf)
    root.add(hitbox)

    const doorId = 'door_hitbox'
    sceneRegistry.nodes.set(doorId, hitbox)
    const nodes: Record<string, AnyNode> = {
      [doorId]: { object: 'node', id: doorId, type: 'door' } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exported = scene.getObjectByProperty('name', doorId) as THREE.Mesh
    expect(exported).toBeDefined()
    // Geometry emptied -> GLTFExporter emits a plain node, no solid block.
    expect(exported.geometry.getAttribute('position')).toBeUndefined()
    // The visible leaf survives as a child.
    const visibleChildren = exported.children.filter((c) => (c as THREE.Mesh).isMesh)
    expect(visibleChildren).toHaveLength(1)
  })

  test('stamps identity from the scene registry and strips other userData', () => {
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const leaf = new THREE.Group()
    leaf.userData.pascalSwingLeaf = { axis: 'y', openRotationY: Math.PI / 2 }
    leaf.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(leaf)
    root.add(doorGroup)

    const doorId = 'door_test'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Front door',
      } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exportedDoor = scene.getObjectByProperty('name', doorId)
    expect(exportedDoor).toBeDefined()
    expect(exportedDoor?.userData).toEqual({
      pascalId: doorId,
      kind: 'door',
      label: 'Front door',
      openable: true,
      clips: ['door_test: open'],
    })

    // The swing-leaf marker must not survive into glTF extras.
    let leafMarkerSurvived = false
    scene.traverse((object) => {
      if (object.userData.pascalSwingLeaf) leafMarkerSurvived = true
    })
    expect(leafMarkerSurvived).toBe(false)
  })

  test('does not flag a door/window openable when no open clip bakes', () => {
    // A cased opening (no swing leaf) / fixed window (no operable sash) builds
    // no movable part, so no clip bakes and the node must not claim openable.
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
    expect(exported?.userData.openable).toBeUndefined()
    expect(exported?.userData.clips).toBeUndefined()
  })

  test('keeps the zone identity node with its polygon and strips the fill mesh', () => {
    const root = new THREE.Group()
    const zoneGroup = new THREE.Group()
    const fill = meshWithNodeMaterial(nodeMaterial())
    fill.layers.set(2) // ZONE_LAYER
    zoneGroup.add(fill)
    zoneGroup.visible = false // the editor often hides zones at export time
    root.add(zoneGroup)

    const zoneId = 'zone_living'
    const polygon: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    sceneRegistry.nodes.set(zoneId, zoneGroup)
    const nodes: Record<string, AnyNode> = {
      [zoneId]: {
        object: 'node',
        id: zoneId,
        type: 'zone',
        name: 'Living Room',
        polygon,
        color: '#ff0000',
      } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes)

    const exported = scene.getObjectByProperty('name', zoneId)
    expect(exported).toBeDefined()
    // Forced visible so GLTFExporter's onlyVisible keeps the metadata node.
    expect(exported?.visible).toBe(true)
    expect(exported?.userData).toEqual({
      pascalId: zoneId,
      kind: 'zone',
      label: 'Living Room',
      polygon,
      color: '#ff0000',
    })
    // The ZONE_LAYER fill mesh must not survive (rebuilt in /viewer instead).
    let hasMesh = false
    exported?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) hasMesh = true
    })
    expect(hasMesh).toBe(false)
  })

  test('bakes a swing door into an open quaternion clip', () => {
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const leaf = new THREE.Group()
    leaf.userData.pascalSwingLeaf = { axis: 'y', openRotationY: Math.PI / 2 }
    leaf.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(leaf)
    root.add(doorGroup)

    const doorId = 'door_swing'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: { object: 'node', id: doorId, type: 'door', name: 'Door' } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const clip = animations[0]!
    expect(clip.name).toBe('door_swing: open')
    expect(clip.duration).toBe(1)
    // Playback intent carried in extras so consumers can play once and hold.
    expect(clip.userData).toEqual({ loop: false })

    const track = clip.tracks[0]!
    expect(track).toBeInstanceOf(THREE.QuaternionKeyframeTrack)
    expect(track.name.endsWith('.quaternion')).toBe(true)
    expect(Array.from(track.times)).toEqual([0, 1])

    // The track must target an object that exists in the exported tree.
    const targetUuid = track.name.replace('.quaternion', '')
    const target = scene.getObjectByProperty('uuid', targetUuid)
    expect(target).toBeDefined()

    // Rest pose is closed: the first keyframe is the identity rotation.
    const closed = new THREE.Quaternion().fromArray(Array.from(track.values).slice(0, 4))
    expect(closed.angleTo(new THREE.Quaternion())).toBeCloseTo(0)
  })

  test('bakes a sliding door into a sampled position clip', () => {
    // Operation doors build their moving parts in a named group posed by
    // `poseDoorMovingParts`; the exporter samples it into keyframes. The active
    // panel group slides along x.
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
    expect(clip.duration).toBe(1)
    expect(clip.userData).toEqual({ loop: false })

    const track = clip.tracks[0]!
    expect(track).toBeInstanceOf(THREE.VectorKeyframeTrack)
    expect(track.name.endsWith('.position')).toBe(true)
    // 16 segments -> 17 keyframes, evenly spaced over the 1s clip.
    expect(track.times.length).toBe(17)
    expect(track.times[0]).toBeCloseTo(0)
    expect(track.times[track.times.length - 1]!).toBeCloseTo(1)

    // Rest pose is closed (first keyframe centred); the panel slides off-centre.
    expect(track.values[0]!).toBeCloseTo(0)
    expect(track.values[1]!).toBeCloseTo(0)
    expect(track.values[2]!).toBeCloseTo(0)
    const lastX = track.values[track.values.length - 3]!
    expect(Math.abs(lastX)).toBeGreaterThan(0.1)

    const target = scene.getObjectByProperty('uuid', track.name.replace('.position', ''))
    expect(target).toBeDefined()

    const exported = scene.getObjectByProperty('name', doorId)
    expect(exported?.userData.openable).toBe(true)
    expect(exported?.userData.clips).toEqual(['door_sliding: open'])
  })

  test('bakes a roll-up curtain into a sampled scale clip', () => {
    // Roll-up geometry can't vanish in a glTF clip, so the bake scales the
    // curtain group up into the lintel instead.
    const root = new THREE.Group()
    const doorGroup = new THREE.Group()
    const curtain = new THREE.Group()
    curtain.name = 'door-rollup-curtain'
    curtain.add(meshWithNodeMaterial(nodeMaterial()))
    doorGroup.add(curtain)
    root.add(doorGroup)

    const doorId = 'door_rollup'
    sceneRegistry.nodes.set(doorId, doorGroup)
    const nodes: Record<string, AnyNode> = {
      [doorId]: {
        object: 'node',
        id: doorId,
        type: 'door',
        name: 'Roll-up',
        doorType: 'garage-rollup',
        width: 2.4,
        height: 2.2,
        frameThickness: 0.05,
      } as unknown as AnyNode,
    }

    const { animations } = prepareSceneForExport(root, nodes)

    expect(animations).toHaveLength(1)
    const scaleTrack = animations[0]!.tracks.find((t) => t.name.endsWith('.scale'))
    expect(scaleTrack).toBeInstanceOf(THREE.VectorKeyframeTrack)
    // Rest pose is closed (full curtain, scale 1); it shrinks toward the header.
    expect(Array.from(scaleTrack!.values).slice(0, 3)).toEqual([1, 1, 1])
    const lastScaleY = scaleTrack!.values[scaleTrack!.values.length - 2]!
    expect(lastScaleY).toBeLessThan(0.1)
  })

  // Regression: a folding door saved in an open state (|fold angle| > π/2) used
  // to bake a 180°-flipped rest pose. The export clones + decomposes the door
  // matrix, which re-derives a gimbal-flipped euler (x=z=π) for the wide Y
  // rotation; the pose reset must zero the full euler triple, not just `.y`.
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
      // Rest quaternion must be identity — no residual π on any axis.
      expect(panel!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-4)
    }
  })
})
