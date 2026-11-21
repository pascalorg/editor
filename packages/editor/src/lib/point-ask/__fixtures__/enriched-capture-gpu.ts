import { type AnyNode, sceneRegistry, useScene } from '@pascal-app/core'
import {
  buildIdResolver,
  type IdBuffer,
  OVERLAY_LAYER,
  renderIdBuffer,
  visibleShares,
  worldAt,
} from '@pascal-app/viewer'
import * as THREE from 'three'
import { positionLocal } from 'three/tsl'
import { MeshBasicNodeMaterial, WebGPURenderer } from 'three/webgpu'
import { rankInRegion } from '../region'

// Browser-only acceptance, deliberately NOT a Bun test or a CPU stand-in for rasterization.
// Call with an initialized real renderer, once per WebGPU and forced WebGL2 backend, in an
// otherwise idle throwaway scene. The caller owns renderer lifetime and saves the returned
// witnesses. A full rendered house and capture/map UI remain separate integration scenarios.
// Analytical planar geometry fixes the expected visibility before candidate execution.
const WIDTH = 63
const HEIGHT = 48

type Witness = {
  name: string
  backend: 'webgpu' | 'webgl2'
  width: number
  height: number
  ids: number[]
  entries: IdBuffer['entries']
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function runEnrichedCaptureGpuAcceptance(
  renderer: Parameters<typeof renderIdBuffer>[0],
  witnesses: Witness[] = [],
): Promise<Witness[]> {
  const previousNodes = useScene.getState().nodes
  const previousRegistry = new Map(sceneRegistry.nodes)
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const instances: THREE.InstancedMesh[] = []
  const camera = new THREE.PerspectiveCamera(90, WIDTH / HEIGHT, 0.1, 20)
  camera.position.set(0, 0, 2)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const project = (x: number, y: number, z: number) => {
    const point = new THREE.Vector3(x, y, z).project(camera)
    return { x: (point.x + 1) * WIDTH / 2, y: (1 - point.y) * HEIGHT / 2 }
  }

  const register = (id: string, type: string, object?: THREE.Object3D) => {
    useScene.setState({
      nodes: { ...useScene.getState().nodes, [id]: { id, type } as AnyNode },
    })
    if (object) sceneRegistry.nodes.set(id, object)
  }
  const plane = (
    width: number,
    height: number,
    material: THREE.Material = new THREE.MeshBasicMaterial(),
  ) => {
    const geometry = new THREE.PlaneGeometry(width, height)
    geometries.push(geometry)
    materials.push(material)
    return new THREE.Mesh(geometry, material)
  }
  const capture = async (name: string, scene: THREE.Scene) => {
    scene.updateMatrixWorld(true)
    const { buffer, stats } = await renderIdBuffer(renderer, scene, camera, {
      width: WIDTH,
      height: HEIGHT,
    })
    requireValue(buffer.width === WIDTH && buffer.height === HEIGHT, `${name}: dimensions`)
    requireValue(buffer.ids.length === WIDTH * HEIGHT, `${name}: readback size`)
    const shares = visibleShares(buffer)
    requireValue(shares.length > 0, `${name}: empty readback`)
    requireValue(
      Math.abs(shares.reduce((sum, share) => sum + share.share, 0) - 1) < 1e-12,
      `${name}: shares do not exhaust the pixels`,
    )
    requireValue(!shares.some((share) => share.kind === 'unknown'), `${name}: unknown pixels`)
    witnesses.push({
      name,
      backend: stats.backend,
      width: buffer.width,
      height: buffer.height,
      ids: Array.from(buffer.ids),
      entries: buffer.entries,
    })
    return buffer
  }
  const entryAt = (buffer: IdBuffer, x: number, y: number) =>
    buffer.entries.find((entry) => entry.index === buffer.ids[y * buffer.width + x])

  try {
    const occlusion = new THREE.Scene()
    const rear = plane(2, 2)
    const front = plane(2, 2)
    front.position.z = 1
    occlusion.add(rear, front)
    register('wall_gpu_back', 'wall', rear)
    register('wall_gpu_front', 'wall', front)
    const projected = (z: number) => {
      const a = project(-1, 1, z)
      const b = project(1, -1, z)
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
    }
    // Both projected boxes overlap the crop; rankInRegion has no depth information.
    const ranked = rankInRegion([
      { id: 'wall_gpu_back', rect: projected(0) },
      { id: 'wall_gpu_front', rect: projected(1) },
    ], { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT })
    requireValue(ranked.ids.includes('wall_gpu_back'), 'occlusion: ranking witness absent')
    const hidden = await capture('occluded wall', occlusion)
    const visibleIds = visibleShares(hidden).map((share) => share.nodeId)
    requireValue(visibleIds.includes('wall_gpu_front'), 'occlusion: front wall missing')
    requireValue(!visibleIds.includes('wall_gpu_back'), 'occlusion: hidden wall associated')
    requireValue(entryAt(hidden, 31, 24)?.nodeId === 'wall_gpu_front', 'occlusion: center id')
    requireValue(Math.abs((worldAt(hidden, 31, 24)?.[2] ?? Infinity) - 1) < 1e-4,
      'occlusion: front world depth')

    // A changed scene must produce a fresh readback, not a cached map or a CPU box ranking.
    front.visible = false
    const revealed = await capture('revealed wall freshness', occlusion)
    requireValue(entryAt(revealed, 31, 24)?.nodeId === 'wall_gpu_back', 'freshness: stale id')
    requireValue(Math.abs(worldAt(revealed, 31, 24)?.[2] ?? Infinity) < 1e-4,
      'freshness: stale world depth')

    const open = new THREE.Scene()
    // A lower-half site surface is an analytical ground/sky image, not a terrain model.
    const ground = plane(4, 2)
    ground.position.y = -1
    open.add(ground)
    register('site_gpu_ground', 'site', ground)
    const empty = await capture('ground and sky', open)
    const openShares = visibleShares(empty)
    requireValue(openShares.length === 2, 'ground/sky: expected two classes')
    requireValue(openShares.every((share) => share.kind === 'ground' || share.kind === 'background'),
      'ground/sky: an ordinary node was associated')
    requireValue(entryAt(empty, 31, 5)?.kind === 'background', 'ground/sky: top row inverted')
    requireValue(entryAt(empty, 31, 42)?.kind === 'ground', 'ground/sky: bottom row inverted')
    requireValue(worldAt(empty, 31, 5) === null, 'ground/sky: invented sky depth')

    // The foreground covers both samples geometrically, but its mask discards one half.
    // Opposite masks on otherwise identical materials must not share an ID-pass silhouette.
    // Samples are well away from x=0: exact semantic ids need no edge tolerance.
    const masked = new THREE.Scene()
    const backWall = plane(4, 4)
    register('wall_gpu_under_mask', 'wall', backWall)
    const rightMask = new MeshBasicNodeMaterial()
    rightMask.maskNode = positionLocal.x.greaterThan(0)
    const leftMask = new MeshBasicNodeMaterial()
    leftMask.maskNode = positionLocal.x.lessThan(0)
    materials.push(leftMask)
    const maskedGround = plane(4, 4, rightMask)
    maskedGround.position.z = 0.5
    register('site_gpu_masked', 'site', maskedGround)
    masked.add(backWall, maskedGround)
    const rightHalf = await capture('ground mask keeps right half', masked)
    requireValue(entryAt(rightHalf, 15, 24)?.nodeId === 'wall_gpu_under_mask',
      'mask: discarded left half covered the wall')
    requireValue(entryAt(rightHalf, 47, 24)?.kind === 'ground',
      'mask: kept right half disappeared')
    requireValue(maskedGround.material === rightMask, 'mask: source material was not restored')

    maskedGround.material = leftMask
    const leftHalf = await capture('distinct ground mask keeps left half', masked)
    requireValue(entryAt(leftHalf, 15, 24)?.kind === 'ground',
      'mask identity: left half used the previous silhouette')
    requireValue(entryAt(leftHalf, 47, 24)?.nodeId === 'wall_gpu_under_mask',
      'mask identity: discarded right half covered the wall')
    requireValue(maskedGround.material === leftMask, 'mask identity: source material was not restored')

    const opening = new THREE.Scene()
    const proxy = plane(3, 3, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }))
    const glazing = plane(1, 1, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 }))
    glazing.material.name = 'glass'
    const behind = plane(2, 2)
    behind.position.z = -1
    proxy.add(glazing)
    opening.add(proxy, behind)
    register('window_gpu_opening', 'window', proxy)
    register('wall_gpu_behind_glass', 'wall', behind)
    const glass = await capture('glass under invisible pick root', opening)
    requireValue(entryAt(glass, 31, 24)?.kind === 'glass', 'glass: missing glazing class')
    requireValue(entryAt(glass, 31, 24)?.nodeId === 'window_gpu_opening', 'glass: lost opening id')
    requireValue(entryAt(glass, 3, 3)?.kind === 'background', 'glass: pick proxy drew')
    requireValue(proxy.visible && glazing.parent === proxy, 'glass: hierarchy was not restored')
    requireValue(glazing.material.transparent && glazing.material.opacity === 0.35,
      'glass: original material was not restored')

    const wireframe = new THREE.Scene()
    const placeholder = plane(2, 2, new THREE.MeshBasicMaterial({ wireframe: true }))
    const wall = plane(2, 2)
    wall.position.z = -1
    wireframe.add(placeholder, wall)
    register('item_gpu_placeholder', 'item', placeholder)
    register('wall_gpu_through_wire', 'wall', wall)
    const wire = await capture('wireframe silhouette', wireframe)
    requireValue(entryAt(wire, 25, 21)?.nodeId === 'wall_gpu_through_wire',
      'wireframe: placeholder was filled')
    requireValue(visibleShares(wire).some((share) => share.nodeId === 'item_gpu_placeholder'),
      'wireframe: placeholder lines disappeared')

    const instanced = new THREE.Scene()
    const geometry = new THREE.PlaneGeometry(0.8, 0.8)
    const material = new THREE.MeshBasicMaterial()
    geometries.push(geometry)
    materials.push(material)
    const items = new THREE.InstancedMesh(geometry, material, 2)
    instances.push(items)
    items.userData.nodeIds = ['item_gpu_upper', 'item_gpu_lower']
    items.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1, 1, 0))
    items.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, -1, 0))
    items.instanceMatrix.needsUpdate = true
    register('item_gpu_upper', 'item')
    register('item_gpu_lower', 'item')
    instanced.add(items)
    // An unregistered foreground helper must not introduce unknown pixels or cover either item.
    const helper = plane(4, 4)
    helper.position.z = 1.5
    helper.layers.set(OVERLAY_LAYER)
    instanced.add(helper)
    const resolver = buildIdResolver(instanced)
    const upperId = resolver.resolve(items, 0)
    const lowerId = resolver.resolve(items, 1)
    requireValue(upperId !== lowerId, 'instances: resolver collapsed identities')
    const instanceBuffer = await capture('instance ids and scene layer', instanced)
    const upper = project(-1, 1, 0)
    const lower = project(1, -1, 0)
    requireValue(entryAt(instanceBuffer, Math.floor(upper.x), Math.floor(upper.y))?.nodeId === 'item_gpu_upper',
      'instances: upper id')
    requireValue(entryAt(instanceBuffer, Math.floor(lower.x), Math.floor(lower.y))?.nodeId === 'item_gpu_lower',
      'instances: lower id')
    requireValue(visibleShares(instanceBuffer).filter((share) => share.kind === 'node').length === 2,
      'instances: collapsed node identities')

    return witnesses
  } finally {
    useScene.setState({ nodes: previousNodes })
    sceneRegistry.nodes.clear()
    for (const [id, object] of previousRegistry) sceneRegistry.nodes.set(id, object)
    for (const instance of instances) instance.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
}

// Bundle this file as an IIFE and inject it into a browser page. Nothing renders on import.
// Then await globalThis.runEnrichedCaptureGpuProbe(false), followed by (...true), sequentially.
export async function runEnrichedCaptureGpuProbe(forceWebGL = false) {
  const requestedBackend = forceWebGL ? 'webgl2' : 'webgpu'
  const witnesses: Witness[] = []
  const renderer = new WebGPURenderer({ forceWebGL, antialias: false })
  try {
    await renderer.init()
    renderer.setSize(WIDTH, HEIGHT)
    await runEnrichedCaptureGpuAcceptance(renderer, witnesses)
    requireValue(witnesses.every((witness) => witness.backend === requestedBackend),
      `requested ${requestedBackend}, got a different backend`)
    return { status: 'PASS' as const, requestedBackend, witnesses }
  } catch (error) {
    return {
      status: 'FAIL' as const,
      requestedBackend,
      witnesses,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    }
  } finally {
    renderer.dispose()
  }
}

const browser = globalThis as typeof globalThis & {
  runEnrichedCaptureGpuProbe?: typeof runEnrichedCaptureGpuProbe
  enrichedCaptureGpuResult?: Awaited<ReturnType<typeof runEnrichedCaptureGpuProbe>>
}
browser.runEnrichedCaptureGpuProbe = async (forceWebGL = false) => {
  const result = await runEnrichedCaptureGpuProbe(forceWebGL)
  browser.enrichedCaptureGpuResult = result
  return result
}
