import { afterEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
  sceneRegistry,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { runWallBuildFrame } from '@pascal-app/viewer'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareSceneForExport } from './glb-export'

function triangles(geometry: THREE.BufferGeometry): THREE.Vector3[][] {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const count = index?.count ?? position.count
  const out: THREE.Vector3[][] = []
  for (let offset = 0; offset < count; offset += 3) {
    out.push(
      [0, 1, 2].map((corner) =>
        new THREE.Vector3().fromBufferAttribute(
          position,
          index ? index.getX(offset + corner) : offset + corner,
        ),
      ),
    )
  }
  return out
}

function countTJunctions(geometry: THREE.BufferGeometry): number {
  const tris = triangles(geometry)
  const vertices = tris.flat()
  const line = new THREE.Line3()
  const closest = new THREE.Vector3()
  let count = 0
  for (const tri of tris) {
    for (let k = 0; k < 3; k += 1) {
      line.set(tri[k]!, tri[(k + 1) % 3]!)
      const length = line.distance()
      if (length < 1e-4) continue
      for (const vertex of vertices) {
        const t = line.closestPointToPointParameter(vertex, false)
        if (t * length < 1e-4 || (1 - t) * length < 1e-4) continue
        line.at(t, closest)
        if (closest.distanceTo(vertex) < 1e-6) count += 1
      }
    }
  }
  return count
}

function area(geometry: THREE.BufferGeometry): number {
  return triangles(geometry).reduce(
    (sum, [a, b, c]) => sum + new THREE.Triangle(a, b, c).getArea(),
    0,
  )
}

async function exportGlb(scene: THREE.Object3D): Promise<ArrayBuffer> {
  const originalFileReader = globalThis.FileReader
  class ExportFileReader {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
  }
  globalThis.FileReader = ExportFileReader as unknown as typeof FileReader
  try {
    return (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer
  } finally {
    globalThis.FileReader = originalFileReader
  }
}

async function parseGlb(buffer: ArrayBuffer): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return gltf.scene
}

afterEach(() => {
  sceneRegistry.clear()
})

describe('deferred wall T-junction repair on export (#1273)', () => {
  test('live walls stay deferred while exported GLB repairs T-junctions without touching the live mesh', async () => {
    const previousScene = useScene.getState()
    const level = LevelNode.parse({ id: 'level_tj', level: 0, parentId: 'building_tj' })
    const windowNode = WindowNode.parse({
      id: 'window_tj',
      wallId: 'wall_tj_main',
      parentId: 'wall_tj_main',
      position: [2.5, 1.4, 0],
      width: 1.2,
      height: 1.2,
    })
    const mainWall = WallNode.parse({
      id: 'wall_tj_main',
      parentId: level.id,
      children: [windowNode.id],
      start: [0, 0],
      end: [6, 0],
      height: 2.6,
      thickness: 0.2,
    })
    const crossWall = WallNode.parse({
      id: 'wall_tj_cross',
      parentId: level.id,
      start: [3, 0],
      end: [3, 4],
      height: 2.6,
      thickness: 0.2,
    })
    const building = BuildingNode.parse({
      id: 'building_tj',
      parentId: 'site_tj',
      children: [level.id],
    })
    const site = SiteNode.parse({
      id: 'site_tj',
      children: [building.id],
    })
    const nodes: Record<string, AnyNode> = {
      [site.id]: site,
      [building.id]: building,
      [level.id]: { ...level, children: [mainWall.id, crossWall.id] },
      [mainWall.id]: mainWall,
      [crossWall.id]: crossWall,
      [windowNode.id]: windowNode,
    }

    const root = new THREE.Group()
    const wallMaterial = [
      new THREE.MeshStandardMaterial({ color: '#cccccc', name: 'base' }),
      new THREE.MeshStandardMaterial({ color: '#dddddd', name: 'front' }),
      new THREE.MeshStandardMaterial({ color: '#eeeeee', name: 'back' }),
    ]
    const mainMesh = new THREE.Mesh(new THREE.BufferGeometry(), wallMaterial)
    mainMesh.name = mainWall.id
    const crossMesh = new THREE.Mesh(new THREE.BufferGeometry(), wallMaterial)
    crossMesh.name = crossWall.id
    root.add(mainMesh, crossMesh)
    sceneRegistry.nodes.set(mainWall.id, mainMesh)
    sceneRegistry.nodes.set(crossWall.id, crossMesh)

    useScene.setState({
      nodes: nodes as never,
      dirtyNodes: new Set([mainWall.id, crossWall.id] as never),
    })

    let prepared: ReturnType<typeof prepareSceneForExport> | null = null
    try {
      runWallBuildFrame()

      // Live wall mesh defers T-junction repair.
      expect(mainMesh.geometry.userData.wallTJunctions).toBe('deferred')
      const liveTJunctions = countTJunctions(mainMesh.geometry)
      expect(liveTJunctions).toBeGreaterThan(0)
      const liveArea = area(mainMesh.geometry)

      // Export preparation repairs the cloned wall meshes without mutating the live mesh.
      prepared = prepareSceneForExport(root, nodes, { onlyVisible: false })
      expect(mainMesh.geometry.userData.wallTJunctions).toBe('deferred')
      expect(countTJunctions(mainMesh.geometry)).toBe(liveTJunctions)

      const exportedMain = prepared.scene.getObjectByName(mainWall.id) as THREE.Mesh
      expect(exportedMain).toBeDefined()
      expect(exportedMain.geometry.userData.wallTJunctions).toBeUndefined()
      expect(countTJunctions(exportedMain.geometry)).toBe(0)
      expect(area(exportedMain.geometry)).toBeCloseTo(liveArea, 5)
      expect(exportedMain.geometry.getAttribute('normal')).toBeDefined()
      expect(exportedMain.geometry.getAttribute('uv')).toBeDefined()
      expect(exportedMain.geometry.getAttribute('uv2')).toBeDefined()

      // Round-trip through GLTFExporter and GLTFLoader: exported GLB has 0 T-junctions.
      const glb = await exportGlb(prepared.scene)
      const loaded = await parseGlb(glb)
      let loadedMeshCount = 0
      loaded.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.geometry) {
          loadedMeshCount += 1
          expect(countTJunctions(obj.geometry)).toBe(0)
        }
      })
      expect(loadedMeshCount).toBeGreaterThanOrEqual(2)
    } finally {
      prepared?.dispose()
      mainMesh.geometry.dispose()
      crossMesh.geometry.dispose()
      for (const m of wallMaterial) m.dispose()
      useScene.setState(previousScene)
    }
  })
})
