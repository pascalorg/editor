import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeDefinition,
  DoorNode,
  type GeometryContext,
  loadPlugin,
  nodeRegistry,
  registerNode,
  SiteNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  buildDoorPreviewMesh,
  markViewerPresentationTextureBorrowed,
  type ViewerPresentationContribution,
  viewerPresentationRegistry,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import type { GLTFWriter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  prepareSceneForExport,
  prepareSceneForExportAsync,
  writeTextureReferenceExtras,
} from './glb-export'

// The reference module reads the storage origin lazily on first use, so
// setting the env here (before any validation call) pins it for the file.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://test-storage.supabase.co'
const STORAGE_ORIGIN = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin

afterEach(() => {
  sceneRegistry.clear()
})

function nodeMaterial(overrides: Record<string, unknown> = {}): THREE.Material {
  const material = new MeshStandardNodeMaterial({
    color: '#cc3300',
    roughness: 0.3,
    metalness: 0.7,
  })
  material.name = 'painted'
  Object.assign(material, overrides)
  return material
}

function meshWithNodeMaterial(material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  return new THREE.Mesh(geometry, material)
}

function sceneWithVisibleAndHiddenBoxes(): {
  root: THREE.Group
  nodes: Record<string, AnyNode>
} {
  const root = new THREE.Group()
  const nodes: Record<string, AnyNode> = {}

  for (const [id, visible, x] of [
    ['item_visible', true, 0],
    ['item_hidden', false, 2],
  ] as const) {
    const group = new THREE.Group()
    const mesh = meshWithNodeMaterial(nodeMaterial())
    mesh.position.x = x
    group.add(mesh)
    root.add(group)
    sceneRegistry.nodes.set(id, group)
    nodes[id] = {
      object: 'node',
      id,
      type: 'item',
      parentId: null,
      visible,
    } as unknown as AnyNode
  }

  return { root, nodes }
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

  test('replaces only the cloned registered subtree with bake-only geometry', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      let receivedParentId: string | null | undefined
      registerNode({
        kind: 'test:bake-geometry',
        schemaVersion: 1,
        schema: DoorNode,
        category: 'utility',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometry: (_node, context) => {
          receivedParentId = context.parent?.id
          const group = new THREE.Group()
          const instances = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.1, 1, 0.1),
            new THREE.MeshStandardMaterial({ color: '#228833' }),
            1,
          )
          instances.name = 'baked-instance'
          instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(4, 0, 2))
          group.add(instances)
          return group
        },
      } as AnyNodeDefinition)

      const root = new THREE.Group()
      const liveGroup = new THREE.Group()
      liveGroup.position.set(2, 0, 3)
      const liveMesh = meshWithNodeMaterial(nodeMaterial())
      liveMesh.name = 'live-procedural-candidate'
      liveGroup.add(liveMesh)
      const before = meshWithNodeMaterial(nodeMaterial())
      before.name = 'before-bake-replacement'
      const after = meshWithNodeMaterial(nodeMaterial())
      after.name = 'after-bake-replacement'
      root.add(before, liveGroup, after)

      const siteId = 'site_bake'
      const grassId = 'grass_bake'
      sceneRegistry.nodes.set(grassId, liveGroup)
      const nodes = {
        [siteId]: {
          object: 'node',
          id: siteId,
          type: 'site',
          parentId: null,
          children: [grassId],
        } as unknown as AnyNode,
        [grassId]: {
          object: 'node',
          id: grassId,
          type: 'test:bake-geometry',
          parentId: siteId,
          visible: true,
        } as unknown as AnyNode,
      }

      const { scene } = prepareSceneForExport(root, nodes)
      const exported = scene.getObjectByName(grassId)
      const baked = exported?.getObjectByName('baked-instance')

      expect(receivedParentId).toBe(siteId)
      expect(liveGroup.getObjectByName('live-procedural-candidate')).toBe(liveMesh)
      expect(scene.getObjectByName('live-procedural-candidate')).toBeUndefined()
      expect(exported?.position.toArray()).toEqual([2, 0, 3])
      expect(scene.children.map((child) => child.name)).toEqual([
        'before-bake-replacement',
        grassId,
        'after-bake-replacement',
      ])
      expect((baked as THREE.InstancedMesh | undefined)?.isInstancedMesh).toBe(true)
      expect((baked as THREE.InstancedMesh | undefined)?.count).toBe(1)
      expect(((baked as THREE.InstancedMesh).material as THREE.Material).isMaterial).toBe(true)
    } finally {
      restoreRegistry()
    }
  })

  test.each([
    'sync',
    'portable-sync',
    'portable-async',
  ] as const)('bakes Site bounds and same-kind sibling reservations through %s hooks', async (mode) => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      const kind = 'test:site-context-bake'
      const nodeId = 'site_context_bake'
      const site = SiteNode.parse({
        polygon: {
          type: 'polygon',
          points: [
            [0, 0],
            [12, 0],
            [12, 8],
            [0, 8],
          ],
        },
        children: [nodeId, 'declared_sibling', 'linked_sibling', 'other_kind'],
      })
      const otherSite = SiteNode.parse({
        polygon: {
          type: 'polygon',
          points: [
            [0, 0],
            [30, 0],
            [30, 4],
            [0, 4],
          ],
        },
        children: ['other_site_sibling'],
      })
      const buildGeometry = (context: GeometryContext) => {
        const points = (context.parent as SiteNode | null)?.polygon?.points ?? [[0, 0]]
        const xs = points.map(([x]) => x)
        const zs = points.map(([, z]) => z)
        const reservedWidth = context.siblings.reduce(
          (width, sibling) => width + Number(sibling.metadata?.reservedWidth ?? 0),
          0,
        )
        return new THREE.Mesh(
          new THREE.BoxGeometry(
            Math.max(...xs) - Math.min(...xs) - reservedWidth,
            1,
            Math.max(...zs) - Math.min(...zs),
          ),
          new THREE.MeshStandardMaterial(),
        )
      }
      registerNode({
        kind,
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        ...(mode === 'portable-async'
          ? { bakeGeometryAsync: async (_node, context) => buildGeometry(context) }
          : { bakeGeometry: (_node, context) => buildGeometry(context) }),
      } as AnyNodeDefinition)
      const nodes = {
        [site.id]: site,
        [otherSite.id]: otherSite,
        [nodeId]: {
          id: nodeId,
          type: kind,
          parentId: null,
          visible: true,
          metadata: { reservedWidth: 100 },
        },
        declared_sibling: {
          id: 'declared_sibling',
          type: kind,
          parentId: null,
          metadata: { reservedWidth: 2 },
        },
        pointer_sibling: {
          id: 'pointer_sibling',
          type: kind,
          parentId: site.id,
          metadata: { reservedWidth: 3 },
        },
        linked_sibling: {
          id: 'linked_sibling',
          type: kind,
          parentId: site.id,
          metadata: { reservedWidth: 1 },
        },
        other_kind: {
          id: 'other_kind',
          type: 'test:other-kind',
          parentId: site.id,
          metadata: { reservedWidth: 100 },
        },
        other_site_sibling: {
          id: 'other_site_sibling',
          type: kind,
          parentId: otherSite.id,
          metadata: { reservedWidth: 4 },
        },
      } as unknown as Record<string, AnyNode>
      const root = new THREE.Group()
      const source = new THREE.Group()
      root.add(source)
      sceneRegistry.nodes.set(nodeId, source)
      const prepare = mode === 'sync' ? prepareSceneForExport : prepareSceneForExportAsync
      const exportedSize = async () => {
        const prepared = await prepare(root, nodes)
        try {
          const exported = prepared.scene.getObjectByName(nodeId)!
          return new THREE.Box3().setFromObject(exported).getSize(new THREE.Vector3()).toArray()
        } finally {
          prepared.dispose()
        }
      }

      expect(await exportedSize()).toEqual([6, 1, 8])
      nodes[nodeId]!.parentId = otherSite.id
      expect(await exportedSize()).toEqual([26, 1, 4])
      nodes[nodeId]!.parentId = null
      site.children = site.children.filter((id) => id !== nodeId)
      expect(await exportedSize()).toEqual([0, 1, 0])
    } finally {
      restoreRegistry()
    }
  })

  test('selective exports omit a procedural kind without changing the live scene or later exports', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      const kind = 'test:optional-ground-cover'
      registerNode({
        kind,
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometry: () =>
          new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: '#228833' }),
          ),
      } as AnyNodeDefinition)
      const root = new THREE.Group()
      const building = meshWithNodeMaterial(nodeMaterial())
      const grass = new THREE.Group()
      const water = meshWithNodeMaterial(nodeMaterial())
      root.add(building, grass, water)
      const nodes: Record<string, AnyNode> = {}
      for (const [id, type, object] of [
        ['building_export', 'building', building],
        ['grass_export', kind, grass],
        ['water_export', 'test:water', water],
      ] as const) {
        sceneRegistry.nodes.set(id, object)
        nodes[id] = { id, type, visible: true } as unknown as AnyNode
      }

      const complete = prepareSceneForExport(root, nodes)
      const selected = prepareSceneForExport(root, nodes, {
        excludedNodeTypes: [kind],
        onlyVisible: false,
      })
      const stl = new STLExporter()
      expect(stl.parse(complete.scene, { binary: true }).getUint32(80, true)).toBe(36)
      expect(stl.parse(selected.scene, { binary: true }).getUint32(80, true)).toBe(24)
      const obj = new OBJExporter().parse(selected.scene)
      expect(obj).not.toContain('grass_export')
      expect(obj).toContain('building_export')
      expect(obj).toContain('water_export')
      expect(selected.scene.getObjectByName('grass_export')).toBeUndefined()
      expect(root.children).toEqual([building, grass, water])
      expect(grass.visible).toBe(true)
      expect(nodes.grass_export?.visible).toBe(true)
      const later = prepareSceneForExport(root, nodes)
      expect(stl.parse(later.scene, { binary: true }).getUint32(80, true)).toBe(36)
    } finally {
      restoreRegistry()
    }
  })

  test('excluding a parent skips descendant bake failures and animation tracks', () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      registerNode({
        kind: 'test:unavailable-bake',
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bakeGeometry: () => {
          throw new Error('Procedural content unavailable')
        },
      } as AnyNodeDefinition)
      const root = new THREE.Group()
      const excluded = new THREE.Group()
      const procedural = new THREE.Group()
      const door = new THREE.Group()
      const leaf = meshWithNodeMaterial(nodeMaterial())
      leaf.userData.pascalSwingLeaf = { axis: 'y', openRotationY: Math.PI / 2 }
      door.add(leaf)
      excluded.add(procedural, door)
      root.add(excluded, meshWithNodeMaterial(nodeMaterial()))
      const nodes: Record<string, AnyNode> = {}
      for (const [id, type, object, parentId] of [
        ['procedural_child', 'test:unavailable-bake', procedural, 'excluded_parent'],
        ['door_child', 'door', door, 'excluded_parent'],
        ['excluded_parent', 'test:optional-parent', excluded, null],
      ] as const) {
        sceneRegistry.nodes.set(id, object)
        nodes[id] = { id, type, parentId, visible: true } as unknown as AnyNode
      }

      expect(() => prepareSceneForExport(root, nodes)).toThrow('Procedural content unavailable')
      const selected = prepareSceneForExport(root, nodes, {
        excludedNodeTypes: ['test:optional-parent'],
      })
      expect(new STLExporter().parse(selected.scene, { binary: true }).getUint32(80, true)).toBe(12)
      expect(selected.animations).toEqual([])
      expect(selected.scene.getObjectByName('door_child')).toBeUndefined()
      expect(excluded.children).toEqual([procedural, door])
    } finally {
      restoreRegistry()
    }
  })

  test('shared NodeMaterial instances convert to a single shared material', () => {
    const root = new THREE.Group()
    const shared = nodeMaterial()
    root.add(meshWithNodeMaterial(shared), meshWithNodeMaterial(shared))

    const { scene } = prepareSceneForExport(root, {})

    const meshes = scene.children as THREE.Mesh[]
    expect(meshes[0]!.material).toBe(meshes[1]!.material)
  })

  test('reference mode swaps stamped compressed textures and leaves unstamped textures embedded', () => {
    const root = new THREE.Group()
    const stamped = new THREE.CompressedTexture([], 4, 4)
    stamped.wrapS = THREE.MirroredRepeatWrapping
    stamped.wrapT = THREE.ClampToEdgeWrapping
    stamped.repeat.set(2, 3)
    stamped.offset.set(0.25, 0.5)
    stamped.center.set(0.5, 0.5)
    stamped.rotation = 0.75
    stamped.flipY = false
    stamped.colorSpace = THREE.SRGBColorSpace
    stamped.updateMatrix()
    stamped.userData.pascalTextureRef = {
      v: 1,
      kind: 'library-material',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/materials/user/material/oak_basecolor_512.ktx2`,
      map: 'basecolor',
      colorSpace: 'srgb',
    }
    const unstamped = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
    root.add(
      meshWithNodeMaterial(nodeMaterial({ map: stamped, normalMap: unstamped })),
      meshWithNodeMaterial(nodeMaterial({ map: stamped })),
    )

    const { scene } = prepareSceneForExport(root, {}, { textures: 'reference' })

    const material = (scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
    const placeholder = material.map as THREE.DataTexture
    expect(placeholder).not.toBe(stamped)
    expect(placeholder.isDataTexture).toBe(true)
    expect(
      (placeholder as THREE.DataTexture & { isCompressedTexture?: boolean }).isCompressedTexture,
    ).toBeUndefined()
    expect(placeholder.image.width).toBe(1)
    expect(placeholder.image.height).toBe(1)
    expect(Array.from(placeholder.image.data!)).toEqual([255, 255, 255, 255])
    expect(placeholder.wrapS).toBe(stamped.wrapS)
    expect(placeholder.wrapT).toBe(stamped.wrapT)
    expect(placeholder.repeat.toArray()).toEqual(stamped.repeat.toArray())
    expect(placeholder.offset.toArray()).toEqual(stamped.offset.toArray())
    expect(placeholder.center.toArray()).toEqual(stamped.center.toArray())
    expect(placeholder.rotation).toBe(stamped.rotation)
    expect(placeholder.flipY).toBe(stamped.flipY)
    expect(placeholder.colorSpace).toBe(stamped.colorSpace)
    expect(placeholder.userData.pascalTextureRef).toEqual(stamped.userData.pascalTextureRef)
    expect(material.normalMap).toBeInstanceOf(THREE.DataTexture)
    expect(Array.from((material.normalMap as THREE.DataTexture).image.data as Uint8Array)).toEqual([
      128, 128, 255, 255,
    ])
    expect(material.normalMap?.userData.pascalTextureRef).toBeUndefined()
    const sharedMaterial = (scene.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial
    expect(sharedMaterial.map).toBe(placeholder)
  })

  test('writes identical texture-reference extras to the texture and image definitions', () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    const ref = {
      v: 1,
      kind: 'item-glb',
      src: `${STORAGE_ORIGIN}/storage/v1/object/public/items/system/chair/models/chair.glb`,
      imageIndex: 3,
      map: 'normal',
      colorSpace: 'linear',
    }
    texture.userData.pascalTextureRef = ref
    const imageDef: { extras?: Record<string, unknown> } = {}
    const textureDef: { source: number; extras?: Record<string, unknown> } = { source: 0 }
    const writer = { json: { images: [imageDef] } } as unknown as GLTFWriter

    writeTextureReferenceExtras(writer, texture, textureDef)

    expect(textureDef.extras?.pascalTextureRef).toEqual(ref)
    expect(imageDef.extras?.pascalTextureRef).toEqual(ref)
    expect(textureDef.extras?.pascalTextureRef).toEqual(imageDef.extras?.pascalTextureRef)
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

  test('strips presentation-only geometry marked by its renderer', () => {
    const root = new THREE.Group()
    const siteGround = meshWithNodeMaterial(nodeMaterial())
    const horizonDisc = meshWithNodeMaterial(nodeMaterial())
    horizonDisc.userData.pascalExport = 'strip'
    root.add(siteGround, horizonDisc)

    const { scene } = prepareSceneForExport(root, {})

    const meshes: THREE.Mesh[] = []
    scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh)
    })
    expect(meshes).toHaveLength(1)
  })

  test('excludes hidden scene nodes and descendants by default', () => {
    const root = new THREE.Group()
    const levelGroup = new THREE.Group()
    const itemGroup = new THREE.Group()
    itemGroup.add(meshWithNodeMaterial(nodeMaterial()))
    levelGroup.add(itemGroup)
    root.add(levelGroup)

    const levelId = 'level_hidden'
    const itemId = 'item_visible_child'
    sceneRegistry.nodes.set(levelId, levelGroup)
    sceneRegistry.nodes.set(itemId, itemGroup)
    const nodes: Record<string, AnyNode> = {
      [levelId]: {
        object: 'node',
        id: levelId,
        type: 'level',
        parentId: null,
        visible: false,
      } as unknown as AnyNode,
      [itemId]: {
        object: 'node',
        id: itemId,
        type: 'item',
        parentId: levelId,
        visible: true,
      } as unknown as AnyNode,
    }

    const { scene, animations } = prepareSceneForExport(root, nodes)

    expect(scene.getObjectByName(levelId)).toBeUndefined()
    expect(scene.getObjectByName(itemId)).toBeUndefined()
    expect(animations).toHaveLength(0)
  })

  test('can include hidden scene nodes when visible-only export is disabled', () => {
    const root = new THREE.Group()
    const itemGroup = new THREE.Group()
    itemGroup.add(meshWithNodeMaterial(nodeMaterial()))
    root.add(itemGroup)

    const itemId = 'item_hidden'
    sceneRegistry.nodes.set(itemId, itemGroup)
    const nodes: Record<string, AnyNode> = {
      [itemId]: {
        object: 'node',
        id: itemId,
        type: 'item',
        parentId: null,
        visible: false,
      } as unknown as AnyNode,
    }

    const { scene } = prepareSceneForExport(root, nodes, { onlyVisible: false })

    expect(scene.getObjectByName(itemId)?.userData).toMatchObject({
      pascalId: itemId,
      kind: 'item',
    })
  })

  test('traditional binary STL excludes hidden nodes by default and can include them', () => {
    const { root, nodes } = sceneWithVisibleAndHiddenBoxes()

    const visibleScene = prepareSceneForExport(root, nodes).scene
    const completeScene = prepareSceneForExport(root, nodes, { onlyVisible: false }).scene
    const visibleStl = new STLExporter().parse(visibleScene, { binary: true })
    const completeStl = new STLExporter().parse(completeScene, { binary: true })

    expect(visibleStl.getUint32(80, true)).toBe(12)
    expect(completeStl.getUint32(80, true)).toBe(24)
  })

  test('traditional OBJ excludes hidden nodes by default and can include them', () => {
    const { root, nodes } = sceneWithVisibleAndHiddenBoxes()

    const visibleScene = prepareSceneForExport(root, nodes).scene
    const completeScene = prepareSceneForExport(root, nodes, { onlyVisible: false }).scene
    const visibleObj = new OBJExporter().parse(visibleScene)
    const completeObj = new OBJExporter().parse(completeScene)
    const vertexCount = (obj: string) => obj.match(/^v /gm)?.length ?? 0

    expect(vertexCount(visibleObj)).toBe(24)
    expect(vertexCount(completeObj)).toBe(48)
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

  test('fills undefined slots in an array material so no undefined survives the prune', () => {
    // Multi-material / group geometry where one slot was never assigned:
    // `mesh.material = [validMat, undefined]`. The scalar-null guard doesn't
    // catch this (an array is never `== null`), so the undefined slot used to
    // reach GLTFExporter and crash on `material.isShaderMaterial`.
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
    mesh.material = [nodeMaterial(), undefined as unknown as THREE.Material]
    root.add(mesh)

    const { scene } = prepareSceneForExport(root, {})

    const exported = scene.children[0] as THREE.Mesh
    const materials = exported.material as THREE.Material[]
    expect(Array.isArray(materials)).toBe(true)
    expect(materials).toHaveLength(2)
    // No undefined/null slot survives; every slot is a real material.
    expect(materials.every((m) => m != null)).toBe(true)
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

  test('bakes registry-owned open clips and stamps the node openable', () => {
    const root = new THREE.Group()
    const nodeGroup = new THREE.Group()
    const movingPart = new THREE.Group()
    movingPart.add(meshWithNodeMaterial(nodeMaterial()))
    nodeGroup.add(movingPart)
    root.add(nodeGroup)

    const kind = `test-openable-${crypto.randomUUID()}`
    const nodeId = 'registry_openable'
    registerNode({
      kind,
      schemaVersion: 1,
      category: 'fixtures',
      defaults: () => ({}),
      capabilities: {},
      exportAnimation: ({ node, object }: { node: AnyNode; object: THREE.Object3D }) => {
        const target = object.children[0]!
        const clip = new THREE.AnimationClip(`${node.id}: open`, 1, [
          new THREE.VectorKeyframeTrack(`${target.uuid}.position`, [0, 1], [0, 0, 0, 0, 0, 1]),
        ])
        clip.userData = { loop: false }
        return clip
      },
    } as never)
    sceneRegistry.nodes.set(nodeId, nodeGroup)

    const { scene, animations } = prepareSceneForExport(root, {
      [nodeId]: {
        object: 'node',
        id: nodeId,
        type: kind,
        name: 'Custom openable',
      } as unknown as AnyNode,
    })

    expect(animations).toHaveLength(1)
    expect(animations[0]!.name).toBe('registry_openable: open')
    const exported = scene.getObjectByProperty('name', nodeId)
    expect(exported?.userData).toMatchObject({
      pascalId: nodeId,
      kind,
      label: 'Custom openable',
      openable: true,
      clips: ['registry_openable: open'],
    })
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

  describe('requireSynchronousBake', () => {
    test('rejects a retained async-only kind instead of returning its proxy', () => {
      const restoreRegistry = nodeRegistry._snapshot()
      try {
        const kind = 'test:async-only-synchronous-export'
        const nodeId = 'async_only_synchronous_export'
        registerNode({
          kind,
          schemaVersion: 1,
          schema: DoorNode,
          category: 'furnish',
          defaults: () => ({}) as never,
          capabilities: {},
          bake: 'replace',
          bakeGeometryAsync: async () =>
            new THREE.Mesh(new THREE.BoxGeometry(4, 5, 6), new THREE.MeshStandardMaterial()),
        } as AnyNodeDefinition)

        const proxyGeometry = new THREE.BoxGeometry(0.25, 0.5, 0.75)
        const proxyMaterial = new THREE.MeshStandardMaterial()
        let sourceGeometryDisposals = 0
        let sourceMaterialDisposals = 0
        proxyGeometry.addEventListener('dispose', () => {
          sourceGeometryDisposals += 1
        })
        proxyMaterial.addEventListener('dispose', () => {
          sourceMaterialDisposals += 1
        })
        const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial)
        proxy.name = 'async-only-proxy'
        const source = new THREE.Group()
        source.add(proxy)
        const root = new THREE.Group()
        root.add(source)
        sceneRegistry.nodes.set(nodeId, source)
        const nodes = {
          [nodeId]: { id: nodeId, type: kind, visible: true },
        } as unknown as Record<string, AnyNode>

        const compatible = prepareSceneForExport(root, nodes)
        expect(compatible.scene.getObjectByName('async-only-proxy')).toBeDefined()
        compatible.dispose()

        let rejection: unknown
        try {
          prepareSceneForExport(root, nodes, { requireSynchronousBake: true })
        } catch (error) {
          rejection = error
        }

        expect(rejection).toBeInstanceOf(Error)
        const message = rejection instanceof Error ? rejection.message : ''
        expect(message).toContain(kind)
        expect(message).toMatch(/\bGLB\b/)
        expect(message).toMatch(/\bUSDZ\b/)
        expect(message).toMatch(/exclud/i)
        expect(sourceGeometryDisposals).toBe(0)
        expect(sourceMaterialDisposals).toBe(0)
        expect(root.children).toEqual([source])
        expect(source.children).toEqual([proxy])
      } finally {
        restoreRegistry()
      }
    })

    test('allows a valid model when every async-only kind is pruned', async () => {
      const restoreRegistry = nodeRegistry._snapshot()
      const { installedPlugins, hasExplicitPluginInstallState } = useScene.getState()
      try {
        const excludedKind = 'test:excluded-synchronous-export'
        const hiddenKind = 'test:hidden-synchronous-export'
        const descendantKind = 'test:descendant-synchronous-export'
        const disabledKind = 'test:disabled-synchronous-export'
        const disabledPluginId = 'test:disabled-synchronous-export-plugin'
        const asyncOnlyDefinition = (kind: string): AnyNodeDefinition =>
          ({
            kind,
            schemaVersion: 1,
            schema: DoorNode,
            category: 'furnish',
            defaults: () => ({}) as never,
            capabilities: {},
            bake: 'replace',
            bakeGeometryAsync: async () => {
              throw new Error(`Pruned async-only builder ran for ${kind}`)
            },
          }) as AnyNodeDefinition

        for (const kind of [excludedKind, hiddenKind, descendantKind]) {
          registerNode(asyncOnlyDefinition(kind))
        }
        await loadPlugin({
          id: disabledPluginId,
          apiVersion: 1,
          nodes: [asyncOnlyDefinition(disabledKind)],
        })
        useScene.getState().setInstalledPlugins([], { explicit: true })

        const valid = new THREE.Mesh(
          new THREE.BoxGeometry(2, 3, 4),
          new THREE.MeshStandardMaterial(),
        )
        valid.name = 'valid-model'
        const excluded = new THREE.Group()
        const hidden = new THREE.Group()
        const disabled = new THREE.Group()
        const excludedParent = new THREE.Group()
        const descendant = new THREE.Group()
        excludedParent.add(descendant)
        const root = new THREE.Group()
        root.add(valid, excluded, hidden, disabled, excludedParent)

        const excludedId = 'excluded_async_only'
        const hiddenId = 'hidden_async_only'
        const disabledId = 'disabled_async_only'
        const excludedParentId = 'excluded_async_only_parent'
        const descendantId = 'descendant_async_only'
        sceneRegistry.nodes.set(excludedId, excluded)
        sceneRegistry.nodes.set(hiddenId, hidden)
        sceneRegistry.nodes.set(disabledId, disabled)
        sceneRegistry.nodes.set(excludedParentId, excludedParent)
        sceneRegistry.nodes.set(descendantId, descendant)
        const nodes = {
          [excludedId]: { id: excludedId, type: excludedKind, visible: true },
          [hiddenId]: { id: hiddenId, type: hiddenKind, visible: false },
          [disabledId]: { id: disabledId, type: disabledKind, visible: true },
          [excludedParentId]: {
            id: excludedParentId,
            type: 'test:excluded-synchronous-export-parent',
            visible: true,
            children: [descendantId],
          },
          [descendantId]: {
            id: descendantId,
            type: descendantKind,
            parentId: excludedParentId,
            visible: true,
          },
        } as unknown as Record<string, AnyNode>

        const prepared = prepareSceneForExport(root, nodes, {
          excludedNodeTypes: [excludedKind, 'test:excluded-synchronous-export-parent'],
          requireSynchronousBake: true,
        })

        const validModel = prepared.scene.getObjectByName('valid-model')
        expect(validModel).toBeDefined()
        const size = new THREE.Box3().setFromObject(validModel!).getSize(new THREE.Vector3())
        expect(size.toArray()).toEqual([2, 3, 4])
        for (const id of [excludedId, hiddenId, disabledId, excludedParentId, descendantId]) {
          expect(prepared.scene.getObjectByName(id)).toBeUndefined()
        }
        prepared.dispose()
      } finally {
        useScene
          .getState()
          .setInstalledPlugins(installedPlugins, { explicit: hasExplicitPluginInstallState })
        restoreRegistry()
      }
    })

    test('uses synchronous geometry when a retained kind provides both hooks', () => {
      const restoreRegistry = nodeRegistry._snapshot()
      try {
        const kind = 'test:dual-hook-synchronous-export'
        const nodeId = 'dual_hook_synchronous_export'
        registerNode({
          kind,
          schemaVersion: 1,
          schema: DoorNode,
          category: 'furnish',
          defaults: () => ({}) as never,
          capabilities: {},
          bake: 'replace',
          bakeGeometry: () =>
            new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial()),
          bakeGeometryAsync: async () =>
            new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshStandardMaterial()),
        } as AnyNodeDefinition)

        const source = new THREE.Group()
        source.add(
          new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 0.75), new THREE.MeshStandardMaterial()),
        )
        const root = new THREE.Group()
        root.add(source)
        sceneRegistry.nodes.set(nodeId, source)
        const nodes = {
          [nodeId]: { id: nodeId, type: kind, visible: true },
        } as unknown as Record<string, AnyNode>

        const prepared = prepareSceneForExport(root, nodes, {
          requireSynchronousBake: true,
        })

        const exported = prepared.scene.getObjectByName(nodeId)
        expect(exported).toBeDefined()
        const size = new THREE.Box3().setFromObject(exported!).getSize(new THREE.Vector3())
        expect(size.toArray()).toEqual([2, 3, 4])
        expect(root.children).toEqual([source])
        prepared.dispose()
      } finally {
        restoreRegistry()
      }
    })
  })

  test('awaits async bake geometry with full semantic context after selection', async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      const retainedKind = 'test:async-context-bake'
      let asyncCalls = 0
      let syncCalls = 0
      registerNode({
        kind: retainedKind,
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometry: () => {
          syncCalls += 1
          throw new Error('sync builder must not run when async geometry is available')
        },
        bakeGeometryAsync: async (_node, context) => {
          asyncCalls += 1
          await Promise.resolve()
          const obstacle = context.resolve<{ metadata?: { acceptanceWidth?: number } }>(
            'door_obstacle_async_context',
          )
          return new THREE.Mesh(
            new THREE.BoxGeometry(obstacle?.metadata?.acceptanceWidth ?? 0, 1, 1),
            new THREE.MeshStandardMaterial(),
          )
        },
      } as AnyNodeDefinition)
      const root = new THREE.Group()
      const source = new THREE.Group()
      const obstacle = new THREE.Group()
      root.add(source, obstacle)
      sceneRegistry.nodes.set('async_context_node', source)
      sceneRegistry.nodes.set('door_obstacle_async_context', obstacle)
      const nodes = {
        async_context_node: {
          id: 'async_context_node',
          type: retainedKind,
          visible: true,
        },
        door_obstacle_async_context: {
          id: 'door_obstacle_async_context',
          type: 'test:excluded-obstacle',
          visible: true,
          metadata: { acceptanceWidth: 2 },
        },
      } as unknown as Record<string, AnyNode>

      const prepared = await prepareSceneForExportAsync(root, nodes, {
        excludedNodeTypes: ['test:excluded-obstacle'],
      })
      const baked = prepared.scene.children.find((child) => child instanceof THREE.Mesh)
      expect(asyncCalls).toBe(1)
      expect(syncCalls).toBe(0)
      expect(baked).toBeInstanceOf(THREE.Mesh)
      if (baked instanceof THREE.Mesh) {
        baked.geometry.computeBoundingBox()
        expect(baked.geometry.boundingBox?.getSize(new THREE.Vector3()).x).toBeCloseTo(2)
      }
      expect(prepared.animations).toEqual([])
      expect(root.children).toEqual([source, obstacle])
      prepared.dispose()
    } finally {
      restoreRegistry()
    }
  })

  test('does not invoke async builders for excluded or invisible nodes', async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      let calls = 0
      for (const kind of ['test:excluded-async-bake', 'test:hidden-async-bake']) {
        registerNode({
          kind,
          schemaVersion: 1,
          schema: DoorNode,
          category: 'furnish',
          defaults: () => ({}) as never,
          capabilities: {},
          bake: 'replace',
          bakeGeometryAsync: async () => {
            calls += 1
            throw new Error('unselected async builder ran')
          },
        } as AnyNodeDefinition)
      }
      const root = new THREE.Group()
      const excluded = new THREE.Group()
      const hidden = new THREE.Group()
      const retained = meshWithNodeMaterial(nodeMaterial())
      root.add(excluded, hidden, retained)
      sceneRegistry.nodes.set('excluded_async_node', excluded)
      sceneRegistry.nodes.set('hidden_async_node', hidden)
      const nodes = {
        excluded_async_node: {
          id: 'excluded_async_node',
          type: 'test:excluded-async-bake',
          visible: true,
        },
        hidden_async_node: {
          id: 'hidden_async_node',
          type: 'test:hidden-async-bake',
          visible: false,
        },
      } as unknown as Record<string, AnyNode>

      const prepared = await prepareSceneForExportAsync(root, nodes, {
        excludedNodeTypes: ['test:excluded-async-bake'],
        onlyVisible: true,
      })
      expect(calls).toBe(0)
      expect(prepared.scene.children).toHaveLength(1)
      prepared.dispose()
    } finally {
      restoreRegistry()
    }
  })

  test('disposes only export-owned resources when a later async builder fails', async () => {
    const restoreRegistry = nodeRegistry._snapshot()
    try {
      const ownedGeometry = new THREE.BoxGeometry()
      const ownedMaterial = new THREE.MeshStandardMaterial()
      const sourceGeometry = new THREE.BoxGeometry()
      const sourceMaterial = new THREE.MeshStandardMaterial()
      let ownedGeometryDisposals = 0
      let ownedMaterialDisposals = 0
      let sourceGeometryDisposals = 0
      let sourceMaterialDisposals = 0
      ownedGeometry.addEventListener('dispose', () => {
        ownedGeometryDisposals += 1
      })
      ownedMaterial.addEventListener('dispose', () => {
        ownedMaterialDisposals += 1
      })
      sourceGeometry.addEventListener('dispose', () => {
        sourceGeometryDisposals += 1
      })
      sourceMaterial.addEventListener('dispose', () => {
        sourceMaterialDisposals += 1
      })
      registerNode({
        kind: 'test:first-owned-async-bake',
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometryAsync: async () => new THREE.Mesh(ownedGeometry, ownedMaterial),
      } as AnyNodeDefinition)
      registerNode({
        kind: 'test:later-failing-async-bake',
        schemaVersion: 1,
        schema: DoorNode,
        category: 'furnish',
        defaults: () => ({}) as never,
        capabilities: {},
        bake: 'replace',
        bakeGeometryAsync: async () => {
          throw new Error('acceptance injected async failure')
        },
      } as AnyNodeDefinition)
      const root = new THREE.Group()
      const first = new THREE.Group()
      const failing = new THREE.Group()
      const source = new THREE.Mesh(sourceGeometry, sourceMaterial)
      root.add(first, failing, source)
      sceneRegistry.nodes.set('first_owned_async_node', first)
      sceneRegistry.nodes.set('later_failing_async_node', failing)
      const nodes = {
        first_owned_async_node: {
          id: 'first_owned_async_node',
          type: 'test:first-owned-async-bake',
          visible: true,
        },
        later_failing_async_node: {
          id: 'later_failing_async_node',
          type: 'test:later-failing-async-bake',
          visible: true,
        },
      } as unknown as Record<string, AnyNode>

      await expect(prepareSceneForExportAsync(root, nodes)).rejects.toThrow(
        'acceptance injected async failure',
      )
      expect(ownedGeometryDisposals).toBe(1)
      expect(ownedMaterialDisposals).toBe(1)
      expect(sourceGeometryDisposals).toBe(0)
      expect(sourceMaterialDisposals).toBe(0)
      expect(root.children).toEqual([first, failing, source])
    } finally {
      restoreRegistry()
    }
  })

  test('includes a registered static presentation only when explicitly selected', async () => {
    const priorPresentations = viewerPresentationRegistry.getSnapshot()
    viewerPresentationRegistry.reset()
    try {
      const contribution: ViewerPresentationContribution = {
        id: 'test:static-export-presentation',
        component: async () => ({ default: () => null }),
        staticExport: {
          label: 'Acceptance surroundings',
          build: async ({ nodes, onlyVisible, excludedNodeTypes }) => {
            const semantic = nodes.semantic_context_node as
              | { metadata?: { acceptanceDimensions?: [number, number, number] } }
              | undefined
            const dimensions = semantic?.metadata?.acceptanceDimensions ?? [0, 0, 0]
            return new THREE.Mesh(
              new THREE.BoxGeometry(
                dimensions[0],
                onlyVisible ? 0 : dimensions[1],
                excludedNodeTypes.includes('test:excluded-context') ? dimensions[2] : 0,
              ),
              new THREE.MeshStandardMaterial({ color: '#4a6b3d' }),
            )
          },
        },
      }
      viewerPresentationRegistry.register(contribution)
      const root = new THREE.Group()
      root.add(meshWithNodeMaterial(nodeMaterial()))
      const nodes = {
        semantic_context_node: {
          id: 'semantic_context_node',
          type: 'test:semantic-context',
          visible: true,
          metadata: { acceptanceDimensions: [3, 1, 2] },
        },
      } as unknown as Record<string, AnyNode>

      const defaultArtifact = await prepareSceneForExportAsync(root, nodes, {
        onlyVisible: false,
      })
      expect(
        defaultArtifact.scene.getObjectByProperty('name', 'test:static-export-presentation'),
      ).toBeUndefined()
      defaultArtifact.dispose()

      const selectedArtifact = await prepareSceneForExportAsync(root, nodes, {
        excludedNodeTypes: ['test:excluded-context'],
        includedPresentationIds: [contribution.id],
        onlyVisible: false,
      })
      const presentation = selectedArtifact.scene.getObjectByProperty('name', contribution.id)
      expect(presentation?.userData).toMatchObject({
        label: 'Acceptance surroundings',
        pascalPresentationId: contribution.id,
      })
      const bounds = new THREE.Box3().setFromObject(presentation!)
      expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([3, 1, 2])
      selectedArtifact.dispose()
    } finally {
      viewerPresentationRegistry.reset()
      for (const contribution of priorPresentations) {
        viewerPresentationRegistry.register(contribution)
      }
    }
  })

  test('preserves marked borrowed presentation textures and disposes owned maps', async () => {
    await withCanvasCapture(async (canvasPixels) => {
      const priorPresentations = viewerPresentationRegistry.getSnapshot()
      viewerPresentationRegistry.reset()
      const borrowed = new THREE.DataTexture(new Uint8Array([20, 40, 60, 255]), 1, 1)
      const owned = new THREE.DataTexture(new Uint8Array([80, 100, 120, 255]), 1, 1)
      const borrowedOnFailure = new THREE.DataTexture(new Uint8Array([140, 160, 180, 255]), 1, 1)
      const ownedOnFailure = new THREE.DataTexture(new Uint8Array([200, 220, 240, 255]), 1, 1)
      markViewerPresentationTextureBorrowed(borrowed)
      markViewerPresentationTextureBorrowed(borrowedOnFailure)
      const disposals = {
        borrowed: 0,
        owned: 0,
        borrowedOnFailure: 0,
        ownedOnFailure: 0,
      }
      for (const [texture, key] of [
        [borrowed, 'borrowed'],
        [owned, 'owned'],
        [borrowedOnFailure, 'borrowedOnFailure'],
        [ownedOnFailure, 'ownedOnFailure'],
      ] as const) {
        texture.addEventListener('dispose', () => {
          disposals[key] += 1
        })
      }
      const textureContribution = (
        id: string,
        texture: THREE.Texture,
      ): ViewerPresentationContribution => ({
        id,
        component: async () => ({ default: () => null }),
        staticExport: {
          label: id,
          build: () =>
            new THREE.Mesh(
              new THREE.PlaneGeometry(1, 1),
              new THREE.MeshStandardMaterial({ map: texture }),
            ),
        },
      })
      try {
        viewerPresentationRegistry.register(
          textureContribution('test:borrowed-presentation-texture', borrowed),
        )
        viewerPresentationRegistry.register(
          textureContribution('test:owned-presentation-texture', owned),
        )
        const success = await prepareSceneForExportAsync(
          new THREE.Group(),
          {},
          {
            includedPresentationIds: [
              'test:borrowed-presentation-texture',
              'test:owned-presentation-texture',
            ],
          },
        )
        const generatedTextures: THREE.Texture[] = []
        success.scene.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return
          const mesh = object as THREE.Mesh
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of materials) {
            const map = (material as THREE.MeshStandardMaterial).map
            if (map) generatedTextures.push(map)
          }
        })
        expect(generatedTextures).toHaveLength(2)
        expect(
          generatedTextures.every((texture) => (texture as THREE.CanvasTexture).isCanvasTexture),
        ).toBe(true)
        expect(generatedTextures.map(canvasPixels).sort()).toEqual(
          [
            [20, 40, 60, 255],
            [80, 100, 120, 255],
          ].sort(),
        )
        let generatedTextureDisposals = 0
        for (const texture of generatedTextures) {
          texture.addEventListener('dispose', () => {
            generatedTextureDisposals += 1
          })
        }
        success.dispose()
        expect(generatedTextureDisposals).toBe(2)
        expect(disposals).toMatchObject({ borrowed: 0, owned: 1 })
        expect(Array.from(borrowed.image.data as Uint8Array)).toEqual([20, 40, 60, 255])

        viewerPresentationRegistry.register(
          textureContribution('test:borrowed-presentation-texture-failure', borrowedOnFailure),
        )
        viewerPresentationRegistry.register(
          textureContribution('test:owned-presentation-texture-failure', ownedOnFailure),
        )
        viewerPresentationRegistry.register({
          id: 'test:failing-presentation-after-textures',
          component: async () => ({ default: () => null }),
          staticExport: {
            label: 'Injected failure after texture ownership',
            build: () => {
              throw new Error('acceptance presentation texture failure')
            },
          },
        })
        await expect(
          prepareSceneForExportAsync(
            new THREE.Group(),
            {},
            {
              includedPresentationIds: [
                'test:borrowed-presentation-texture-failure',
                'test:owned-presentation-texture-failure',
                'test:failing-presentation-after-textures',
              ],
            },
          ),
        ).rejects.toThrow('acceptance presentation texture failure')
        expect(disposals).toEqual({
          borrowed: 0,
          owned: 1,
          borrowedOnFailure: 0,
          ownedOnFailure: 1,
        })
        expect(Array.from(borrowedOnFailure.image.data as Uint8Array)).toEqual([140, 160, 180, 255])
      } finally {
        viewerPresentationRegistry.reset()
        for (const contribution of priorPresentations) {
          viewerPresentationRegistry.register(contribution)
        }
      }
    })
  })
})

async function withCanvasCapture(
  run: (pixels: (texture: THREE.Texture) => number[]) => Promise<void>,
): Promise<void> {
  const globals = globalThis as unknown as { document?: Document }
  const previousDocument = globals.document
  const pixelsByCanvas = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>()
  globals.document = {
    createElement: (tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`Unexpected element request: ${tagName}`)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) =>
            ({
              colorSpace: 'srgb',
              data: new Uint8ClampedArray(width * height * 4),
              height,
              width,
            }) as ImageData,
          putImageData: (image: ImageData) => {
            pixelsByCanvas.set(canvas, new Uint8ClampedArray(image.data))
          },
        }),
      } as unknown as HTMLCanvasElement
      return canvas
    },
  } as unknown as Document

  try {
    await run((texture) => {
      const pixels = pixelsByCanvas.get(texture.image as HTMLCanvasElement)
      if (!pixels) throw new Error('Generated canvas texture has no captured pixels')
      return Array.from(pixels)
    })
  } finally {
    if (previousDocument) globals.document = previousDocument
    else delete globals.document
  }
}
