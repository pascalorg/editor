import { sceneRegistry, useScene } from '@pascal-app/core'
import * as THREE from 'three'
import {
  batchIndirectIndex,
  instanceIndex,
  ivec2,
  positionWorld,
  textureLoad,
  uniform,
  vec4,
} from 'three/tsl'
import { MeshBasicNodeMaterial, RenderTarget } from 'three/webgpu'
import { BACKGROUND_INDEX, decodeIdReadback, type IdBuffer, type IdEntry } from './id-buffer'
import { SCENE_LAYER } from './layers'
import { materialShows } from './material-shows'

/** An on-demand, non-MSAA surface readback; long side bounded independently of the viewport. */
export const ID_BUFFER_MAX_EDGE = 768

const GLASS = /glass|glaz/i
export function isGlassMaterial(material: THREE.Material | THREE.Material[]): boolean {
  return (Array.isArray(material) ? material : [material]).some(
    (m) =>
      GLASS.test(m.name) ||
      (m.transparent && m.opacity < 0.9 && m.opacity > 0.02) ||
      ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0,
  )
}

const isCollectiveBatch = (object: THREE.Object3D) =>
  object.name === 'item-batch' || object.name === 'wall-batch'

/**
 * Snapshot the registered owners in this scene. Kit instances inherit their semantic owner;
 * multi-node InstancedMesh/BatchedMesh producers may supply userData.nodeIds[instanceId].
 * Collective batches must first release their sources through the thumbnail capture lifecycle.
 */
export function buildIdResolver(scene: THREE.Object3D) {
  const objects = new Set<THREE.Object3D>()
  scene.traverse((object) => objects.add(object))
  const owners = new Map<THREE.Object3D, string>()
  for (const [id, object] of sceneRegistry.nodes) if (objects.has(object)) owners.set(object, id)
  const nodes = useScene.getState().nodes as Record<
    string,
    { type?: string; parentId?: string } | undefined
  >
  const entries: IdEntry[] = [{ index: BACKGROUND_INDEX, kind: 'background' }]
  const byKey = new Map<string, IdEntry>()
  const byObject = new Map<THREE.Object3D, Map<number, number>>()
  const ownerOf = (object: THREE.Object3D): string | undefined => {
    for (let at: THREE.Object3D | null = object; at; at = at.parent) {
      const id = owners.get(at)
      if (id !== undefined) return id
    }
    return undefined
  }
  const resolve = (object: THREE.Object3D, instanceId = -1): number => {
    let cached = byObject.get(object)
    const known = cached?.get(instanceId)
    if (known !== undefined) return known
    const instanceIds = object.userData.nodeIds as readonly string[] | undefined
    let nodeId = instanceId >= 0 && instanceIds ? instanceIds[instanceId] : ownerOf(object)
    let node = nodeId ? nodes[nodeId] : undefined
    const mesh = object as THREE.Mesh
    const glass =
      object.userData.slotId === 'glass' || (mesh.material && isGlassMaterial(mesh.material))
    if (glass) {
      // A glazing component can be registered separately from the opening that owns it.
      for (let at = node; at?.parentId; ) {
        if (at.type === 'window' || at.type === 'door') break
        const parent = nodes[at.parentId]
        if (!parent) break
        if (parent.type === 'window' || parent.type === 'door') {
          nodeId = at.parentId
          node = parent
          break
        }
        at = parent
      }
    }
    const kind =
      isCollectiveBatch(object) || !node
        ? 'unknown'
        : node.type === 'site'
          ? 'ground'
          : glass
            ? 'glass'
            : 'node'
    const semantic = kind === 'node' || kind === 'glass' ? nodeId : undefined
    const key = `${kind}:${semantic ?? ''}`
    let entry = byKey.get(key)
    if (!entry) {
      entry = {
        index: entries.length,
        kind,
        ...(semantic ? { nodeId: semantic, nodeType: node?.type } : {}),
      }
      entries.push(entry)
      byKey.set(key, entry)
    }
    if (kind === 'unknown') {
      entry.objectNames ??= []
      const name = object.name || object.type
      if (entry.objectNames.length < 24 && !entry.objectNames.includes(name))
        entry.objectNames.push(name)
    }
    if (!cached) {
      cached = new Map()
      byObject.set(object, cached)
    }
    cached.set(instanceId, entry.index)
    return entry.index
  }
  return { entries, resolve }
}

export type IdPassRequest = {
  width: number
  height: number
  viewOffset?: {
    fullWidth: number
    fullHeight: number
    x: number
    y: number
    width: number
    height: number
  }
}
export type IdPassStats = {
  meshes: number
  skipped: number
  materials: number
  renderMs: number
  readbackMs: number
  decodeMs: number
  backend: 'webgpu' | 'webgl2'
}
export type IdPassResult = { buffer: IdBuffer; stats: IdPassStats }

type Renderer = {
  render: (scene: THREE.Scene, camera: THREE.Camera) => void
  getRenderTarget: () => unknown
  setRenderTarget: (target: unknown) => void
  getMRT?: () => unknown
  setMRT?: (mrt: unknown) => void
  getClearColor: (target: THREE.Color) => THREE.Color
  getClearAlpha: () => number
  setClearColor: (color: THREE.Color, alpha?: number) => void
  autoClear: boolean
  readRenderTargetPixelsAsync: (
    target: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => Promise<ArrayLike<number>>
  backend?: { isWebGPUBackend?: boolean; device?: unknown }
}

/**
 * Submit synchronously in the caller's capture setup, then read back asynchronously. R is the
 * semantic index and GBA the perspective-correct world position of the depth-winning fragment.
 * This is a world-position readback, not a depth-texture transfer/reconstruction. Glass is opaque
 * evidence of its opening. Helpers and non-surface proxies never occlude their rendered children.
 * All scene/renderer mutations are restored before returning the promise; resources are pass-owned.
 */
export function renderIdBuffer(
  rendererLike: unknown,
  scene: THREE.Scene,
  camera: THREE.Camera,
  request: IdPassRequest,
): Promise<IdPassResult> {
  const renderer = rendererLike as Renderer
  const { width, height } = request
  if (![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= ID_BUFFER_MAX_EDGE))
    throw new Error(`Id-buffer dimensions must be integers between 1 and ${ID_BUFFER_MAX_EDGE}`)
  if (!(camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera))
    throw new Error('Id-buffer capture needs a perspective or orthographic camera')
  const started = performance.now()
  const passCamera = camera.clone()
  camera.updateWorldMatrix(true, false)
  camera.matrixWorld.decompose(passCamera.position, passCamera.quaternion, passCamera.scale)
  passCamera.layers.set(SCENE_LAYER)
  if (request.viewOffset) {
    const v = request.viewOffset
    passCamera.setViewOffset(v.fullWidth, v.fullHeight, v.x, v.y, v.width, v.height)
  }
  passCamera.updateProjectionMatrix()
  passCamera.updateMatrixWorld()
  const { entries, resolve } = buildIdResolver(scene)
  const index = uniform(0).onObjectUpdate(({ object }) => resolve(object as THREE.Object3D))
  const output = vec4(index, positionWorld)
  const materials = new Map<string, MeshBasicNodeMaterial>()
  const textures: THREE.DataTexture[] = []
  const keys = new Map<object, number>()
  const keyOf = (value: object | null | undefined) => {
    if (!value) return 0
    let key = keys.get(value)
    if (key === undefined) {
      key = keys.size + 1
      keys.set(value, key)
    }
    return key
  }
  const noDraw = new MeshBasicNodeMaterial()
  noDraw.visible = false
  const materialFor = (source: THREE.Material, object: THREE.Mesh) => {
    if (!materialShows(source) || isCollectiveBatch(object)) return noDraw
    const from = source as THREE.MeshBasicMaterial & {
      positionNode?: MeshBasicNodeMaterial['positionNode']
      maskNode?: MeshBasicNodeMaterial['maskNode']
    }
    const cut = source.alphaTest > 0
    const instances = object as THREE.InstancedMesh & {
      isBatchedMesh?: boolean
      maxInstanceCount?: number
    }
    const multi = instances.isInstancedMesh || instances.isBatchedMesh
    const key = `${source.side}|${from.wireframe === true}|${keyOf(from.positionNode)}|${keyOf(from.maskNode)}|${keyOf(source.clippingPlanes)}:${source.clipIntersection}|${cut ? `${source.alphaTest}:${source.opacity}:${keyOf(from.map)}:${keyOf(from.alphaMap)}` : '-'}|${multi ? object.uuid : ''}`
    const cached = materials.get(key)
    if (cached) return cached
    const material = new MeshBasicNodeMaterial()
    materials.set(key, material)
    material.side = source.side
    material.wireframe = from.wireframe === true
    material.fog = false
    material.toneMapped = false
    material.blending = THREE.NoBlending
    material.depthTest = true
    material.depthWrite = true
    material.forceSinglePass = true
    material.positionNode = from.positionNode ?? null
    material.maskNode = from.maskNode ?? null
    material.clippingPlanes = source.clippingPlanes
    material.clipIntersection = source.clipIntersection
    if (cut) {
      material.alphaTest = source.alphaTest
      material.opacity = source.opacity
      material.map = from.map
      material.alphaMap = from.alphaMap
    }
    material.outputNode = output
    if (multi) {
      const count = Math.max(
        1,
        instances.isInstancedMesh ? instances.count : (instances.maxInstanceCount ?? 0),
      )
      const textureWidth = Math.min(1024, count)
      const data = new Float32Array(textureWidth * Math.ceil(count / textureWidth) * 4)
      for (let i = 0; i < count; i++) data[i * 4] = resolve(object, i)
      const ids = new THREE.DataTexture(
        data,
        textureWidth,
        Math.ceil(count / textureWidth),
        THREE.RGBAFormat,
        THREE.FloatType,
      )
      ids.needsUpdate = true
      textures.push(ids)
      const at = instances.isBatchedMesh ? batchIndirectIndex : instanceIndex
      material.outputNode = vec4(
        textureLoad(ids, ivec2(at.mod(textureWidth).toInt(), at.div(textureWidth).toInt())).r,
        positionWorld,
      )
    }
    return material
  }
  const target = new RenderTarget(width, height, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    samples: 0,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  })
  const dispose = () => {
    target.dispose()
    noDraw.dispose()
    for (const material of materials.values()) material.dispose()
    for (const texture of textures) texture.dispose()
  }
  const swapped: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] = []
  const previousTarget = renderer.getRenderTarget()
  const previousMRT = renderer.getMRT?.()
  const previousClear = renderer.getClearColor(new THREE.Color())
  const previousAlpha = renderer.getClearAlpha()
  const previousAutoClear = renderer.autoClear
  const previousOverride = scene.overrideMaterial
  const previousBackground = scene.background
  const previousFog = scene.fog
  const sceneNodes = scene as THREE.Scene & { backgroundNode?: unknown; fogNode?: unknown }
  const previousBackgroundNode = sceneNodes.backgroundNode
  const previousFogNode = sceneNodes.fogNode
  let meshes = 0
  let skipped = 0
  try {
    try {
      scene.traverseVisible((object) => {
        if (!passCamera.layers.test(object.layers)) return
        const mesh = object as THREE.Mesh
        if (!mesh.material) return
        const line = object as THREE.Line & { isPoints?: boolean; isSprite?: boolean }
        const lineMaterial = mesh.material as THREE.Material & { isLineMaterial?: boolean }
        const skip =
          line.isLine ||
          line.isPoints ||
          line.isSprite ||
          lineMaterial.isLineMaterial ||
          /Line2/.test(lineMaterial.type)
        if (!mesh.isMesh && !skip) return
        swapped.push({ mesh, material: mesh.material })
        if (skip || isCollectiveBatch(object)) {
          mesh.material = noDraw
          skipped++
          return
        }
        meshes++
        // Classify on the original material, before any shader replacement.
        resolve(object)
        const swap = (source: THREE.Material) => materialFor(source, mesh)
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
      })
      scene.overrideMaterial = null
      scene.background = null
      sceneNodes.backgroundNode = null
      scene.fog = null
      sceneNodes.fogNode = null
      renderer.autoClear = true
      renderer.setClearColor(new THREE.Color(0, 0, 0), 0)
      renderer.setMRT?.(null)
      renderer.setRenderTarget(target)
      renderer.render(scene, passCamera)
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setMRT?.(previousMRT)
      renderer.setClearColor(previousClear, previousAlpha)
      renderer.autoClear = previousAutoClear
      scene.overrideMaterial = previousOverride
      scene.background = previousBackground
      sceneNodes.backgroundNode = previousBackgroundNode
      scene.fog = previousFog
      sceneNodes.fogNode = previousFogNode
      for (const { mesh, material } of swapped) mesh.material = material
    }
    const rendered = performance.now()
    const topDown = renderer.backend?.isWebGPUBackend === true || !!renderer.backend?.device
    return renderer
      .readRenderTargetPixelsAsync(target, 0, 0, width, height)
      .then((raw) => {
        const read = performance.now()
        const data = raw instanceof Float32Array ? raw : new Float32Array(raw)
        const buffer = decodeIdReadback(data, width, height, topDown, entries)
        return {
          buffer,
          stats: {
            meshes,
            skipped,
            materials: materials.size,
            renderMs: rendered - started,
            readbackMs: read - rendered,
            decodeMs: performance.now() - read,
            backend: topDown ? ('webgpu' as const) : ('webgl2' as const),
          },
        }
      })
      .finally(dispose)
  } catch (error) {
    dispose()
    throw error
  }
}
