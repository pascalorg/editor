'use client'

import { type AnyNodeId, sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { evaluateRecipe } from '@pascal-app/core/procedural-items'
import {
  computeHeroFraming,
  createSnapshotPipeline,
  GRID_LAYER,
  type HeroFraming,
  heroCameraPose,
  proceduralSlotMeshes,
  setKeyLightDirectionOverride,
  setProceduralEmission,
  setSlotDefaultOverrides,
  temporarilyHideNodeTypes,
  useSceneAtmosphere,
  useViewer,
} from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  Box3,
  CanvasTexture,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial, ShadowNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

// The published-thumbnail look. One look for every project, independent of
// the scene's own display preferences.
const THUMBNAIL_FOV_DEG = 40
const THUMBNAIL_PADDING = 1.12
/** Roofless scenes look down into the rooms; roofed ones show the roofline. */
const THUMBNAIL_ELEVATION_DEG = { roofed: 24, roofless: 35 }
/** Key light relative to the hero camera: 30° off its azimuth, 45° up — both
 *  facades lit, shadows raking across the ground. */
const THUMBNAIL_KEY_AZIMUTH_OFFSET_DEG = 30
const THUMBNAIL_KEY_ELEVATION_DEG = 45
const THUMBNAIL_BACKDROP = { inner: '#FAFAFA', outer: '#E4E4E4' }
const THUMBNAIL_SHADOW_CATCHER_OPACITY = 0.7
/** Soft shade hugging the ground-floor walls so the building never floats. */
const THUMBNAIL_WALL_CONTACT = { opacity: 0.5, spreadM: 0.9 }
/** Unpainted walls render as smooth plaster rather than the screw-dotted
 *  prepared-drywall default, which reads as unfinished at card size. */
const THUMBNAIL_SLOT_DEFAULT_OVERRIDES = {
  'library:concrete-drywall': 'library:concrete-plaster',
} as const
// Past the capture camera's far plane (1000): a catcher edge inside the frame
// leaves an SSGI AO line along its depth discontinuity.
const SHADOW_CATCHER_EXTENT = 4000

/**
 * Forces the published-thumbnail look on the bake page. Call before the scene
 * builds (the finish swap applies as materials are created); the returned
 * cleanup restores the declared finishes.
 */
export function prepareBakeThumbnailLook(): () => void {
  const viewer = useViewer.getState()
  viewer.setSceneTheme('studio')
  viewer.setEdges('soft')
  viewer.setShadows(true)
  setSlotDefaultOverrides(THUMBNAIL_SLOT_DEFAULT_OVERRIDES)
  return () => setSlotDefaultOverrides(null)
}

// Scene-ready fires before every system has finished its geometry: roofs
// rebuild their merged mesh a few frames later (measured: Starter House ridge
// 5.75 m at scene-ready, 6.24 m at capture), so a pose fit at scene-ready
// clips the roof. Re-measure until the framing bounds hold still.
async function settledHeroFraming() {
  const boundsKey = (framing: HeroFraming | null) => {
    if (!framing) return ''
    const union = new Box3()
    for (const box of framing.boxes) union.union(box)
    return [...union.min.toArray(), ...union.max.toArray()].map((v) => v.toFixed(3)).join(',')
  }
  let framing = computeHeroFraming({ sitePlates: false })
  let previous = boundsKey(framing)
  let stableChecks = 0
  for (let i = 0; i < 40 && stableChecks < 3; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    framing = computeHeroFraming({ sitePlates: false })
    const next = boundsKey(framing)
    stableChecks = next === previous ? stableChecks + 1 : 0
    previous = next
  }
  return framing
}

/** The site's own surfaces (ground fill, horizon disc, property ribbons) —
 *  not its registered children (buildings, items), which are groups. */
function siteSurfaces(): Object3D[] {
  const surfaces: Object3D[] = []
  for (const siteId of sceneRegistry.byType.site ?? []) {
    for (const child of sceneRegistry.nodes.get(siteId)?.children ?? []) {
      if (child.visible && !(child.type === 'Group' && child.children.length > 0)) {
        surfaces.push(child)
      }
    }
  }
  return surfaces
}

/**
 * A soft contact shade on the ground along every ground-floor wall: the wall
 * centrelines stroked onto a canvas in the building's facade axes, then
 * blurred. Per wall rather than per footprint, so a walled lot shades its
 * boundary walls and leaves the open courtyard clean.
 */
function wallContactShade(yaw: number, groundY: number): Mesh | null {
  const u = new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
  const v = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw))
  const segments: Array<{ a: [number, number]; b: [number, number]; thickness: number }> = []
  const point = new Vector3()
  // A wall mesh sits at its start, rotated along the run: `start`/`end` are
  // in its parent's (the level's) frame.
  const toUv = (x: number, z: number, object: Object3D): [number, number] => {
    point.set(x, 0, z)
    if (object.parent) point.applyMatrix4(object.parent.matrixWorld)
    return [point.dot(u), point.dot(v)]
  }
  for (const wallId of sceneRegistry.byType.wall ?? []) {
    const object = sceneRegistry.nodes.get(wallId)
    const node = useScene.getState().nodes[wallId as AnyNodeId]
    if (!(object && node?.type === 'wall' && node.visible !== false)) continue
    const bounds = new Box3().setFromObject(object)
    if (bounds.isEmpty() || bounds.min.y > groundY + 0.5) continue
    segments.push({
      a: toUv(node.start[0], node.start[1], object),
      b: toUv(node.end[0], node.end[1], object),
      thickness: node.thickness ?? 0.2,
    })
  }
  if (segments.length === 0) return null

  const { spreadM, opacity } = THUMBNAIL_WALL_CONTACT
  let uMin = Number.POSITIVE_INFINITY
  let uMax = Number.NEGATIVE_INFINITY
  let vMin = Number.POSITIVE_INFINITY
  let vMax = Number.NEGATIVE_INFINITY
  for (const { a, b } of segments) {
    uMin = Math.min(uMin, a[0], b[0])
    uMax = Math.max(uMax, a[0], b[0])
    vMin = Math.min(vMin, a[1], b[1])
    vMax = Math.max(vMax, a[1], b[1])
  }
  const margin = spreadM * 2
  const width = uMax - uMin + margin * 2
  const depth = vMax - vMin + margin * 2
  const scale = 1024 / Math.max(width, depth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(8, Math.round(width * scale))
  canvas.height = Math.max(8, Math.round(depth * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // alphaMap samples the green channel: white strokes on opaque black.
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.filter = `blur(${Math.max(2, spreadM * scale * 0.35)}px)`
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'square'
  for (const { a, b, thickness } of segments) {
    ctx.lineWidth = (thickness + spreadM * 0.6) * scale
    ctx.beginPath()
    ctx.moveTo((a[0] - uMin + margin) * scale, (a[1] - vMin + margin) * scale)
    ctx.lineTo((b[0] - uMin + margin) * scale, (b[1] - vMin + margin) * scale)
    ctx.stroke()
  }

  const shade = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshBasicNodeMaterial({
      color: '#000000',
      alphaMap: new CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      opacity,
    }),
  )
  // Plane x → u; plane y → −v, so the canvas's downward rows run along +v.
  shade.rotation.set(-Math.PI / 2, 0, -yaw)
  shade.position
    .copy(u)
    .multiplyScalar((uMin + uMax) / 2)
    .addScaledVector(v, (vMin + vMax) / 2)
    .setY(groundY - 0.005)
  shade.renderOrder = -1
  return shade
}

function disposeMesh(mesh: Mesh) {
  mesh.removeFromParent()
  mesh.geometry.dispose()
  const material = mesh.material as MeshBasicNodeMaterial
  material.alphaMap?.dispose()
  material.dispose()
}

export function BakeThumbnail({
  active,
  onComplete,
  onError,
}: {
  active: boolean
  onComplete: (blob: Blob, size: { w: number; h: number }) => void
  onError: (message: string) => void
}) {
  const renderer = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const atmosphere = useSceneAtmosphere()
  const doneRef = useRef(false)

  useEffect(() => {
    if (!(active && !doneRef.current)) return
    doneRef.current = true

    const run = async () => {
      const restoreNodeVisibility = temporarilyHideNodeTypes(['scan', 'guide', 'spawn'])
      const priorLights = new Map<string, boolean>()
      const restGroups = new Map<string, [number, number, number]>()
      for (const node of Object.values(useScene.getState().nodes)) {
        if (node.type !== 'procedural-item') continue
        const evaluation = evaluateRecipe(node.recipe, node.parameters)
        if (evaluation.lights.length) {
          priorLights.set(
            node.id,
            useInteractive.getState().procedural[node.id]?.lightsOn ??
              useInteractive.getState().lampDefault,
          )
          useInteractive.getState().setProceduralLights(node.id, true)
        }
        for (const motion of evaluation.motions)
          restGroups.set(`${node.id}:${motion.id}`, motion.pivot)
      }
      const transforms: Array<{
        object: import('three').Object3D
        position: import('three').Vector3
        rotation: import('three').Euler
      }> = []
      const emission = new Map<Material, number>()
      let pipeline: Awaited<ReturnType<typeof createSnapshotPipeline>> = null
      // The studio backdrop replaces the site's ground and horizon: a shadow
      // catcher keeps cast shadows, the wall shade keeps contact. Items the
      // framing leaves out are hidden so what's framed is what's shown.
      const hidden: Object3D[] = []
      const added: Mesh[] = []

      try {
        const framing = await settledHeroFraming()
        if (!framing) {
          onError('scene has no framable content')
          return
        }

        const { width, height } = renderer.domElement
        const aspect = width / height
        const camera = new PerspectiveCamera(THUMBNAIL_FOV_DEG, aspect, 0.1, 1000)
        camera.layers.disable(EDITOR_LAYER)
        camera.layers.disable(GRID_LAYER)
        const hasRoof = (sceneRegistry.byType.roof?.size ?? 0) > 0
        const elevationDeg = hasRoof
          ? THUMBNAIL_ELEVATION_DEG.roofed
          : THUMBNAIL_ELEVATION_DEG.roofless
        const pose = heroCameraPose({
          boxes: framing.boxes,
          aim: framing.aim,
          azimuthRad: framing.azimuthRad,
          aspect,
          fovDeg: THUMBNAIL_FOV_DEG,
          elevationRad: (elevationDeg * Math.PI) / 180,
          padding: THUMBNAIL_PADDING,
          tightFit: true,
        })
        camera.position.set(pose.position[0], pose.position[1], pose.position[2])
        camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
        camera.updateMatrixWorld()

        const keyAzimuth = framing.azimuthRad + (THUMBNAIL_KEY_AZIMUTH_OFFSET_DEG * Math.PI) / 180
        const keyElevation = (THUMBNAIL_KEY_ELEVATION_DEG * Math.PI) / 180
        setKeyLightDirectionOverride([
          Math.sin(keyAzimuth) * Math.cos(keyElevation),
          Math.sin(keyElevation),
          Math.cos(keyAzimuth) * Math.cos(keyElevation),
        ])

        for (const object of [
          ...siteSurfaces(),
          ...framing.detachedItemIds.flatMap((id) => sceneRegistry.nodes.get(id) ?? []),
        ]) {
          if (!object.visible) continue
          object.visible = false
          hidden.push(object)
        }
        const union = new Box3()
        for (const box of framing.boxes) union.union(box)
        const groundY = Math.max(0, union.min.y)
        const catcher = new Mesh(
          new PlaneGeometry(SHADOW_CATCHER_EXTENT, SHADOW_CATCHER_EXTENT),
          new ShadowNodeMaterial({ opacity: THUMBNAIL_SHADOW_CATCHER_OPACITY }),
        )
        catcher.rotation.x = -Math.PI / 2
        catcher.position.set(framing.aim[0], groundY - 0.01, framing.aim[2])
        catcher.receiveShadow = true
        added.push(catcher)
        const contact = wallContactShade(Math.PI / 4 - framing.azimuthRad, groundY)
        if (contact) added.push(contact)
        for (const mesh of added) scene.add(mesh)

        // Backdrop centred on the building's mid-height, where it's lightest.
        const center = new Vector3(
          framing.aim[0],
          (groundY + framing.aim[1]) / 2,
          framing.aim[2],
        ).project(camera)
        pipeline = await createSnapshotPipeline({
          renderer: renderer as unknown as WebGPURenderer,
          scene,
          camera,
          atmosphere,
          studioBackdrop: {
            ...THUMBNAIL_BACKDROP,
            center: [(center.x + 1) / 2, (1 - center.y) / 2],
          },
        })
        if (!pipeline) {
          onError('thumbnail pipeline failed to build')
          return
        }

        pipeline.applyEnvironment({
          theme: useViewer.getState().sceneTheme,
          transparent: false,
          grade: true,
          edges: useViewer.getState().edges,
          camera,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        for (const node of Object.values(useScene.getState().nodes)) {
          if (node.type !== 'procedural-item') continue
          const slots = new Set(
            evaluateRecipe(node.recipe, node.parameters).lights.flatMap((light) =>
              light.emissiveSlot ? [light.emissiveSlot] : [],
            ),
          )
          const object = sceneRegistry.nodes.get(node.id)
          for (const mesh of object ? proceduralSlotMeshes(object, slots) : []) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const material of materials) {
              const current = material as Material & { emissiveIntensity?: number }
              if (typeof current.emissiveIntensity !== 'number') continue
              emission.set(material, current.emissiveIntensity)
              setProceduralEmission(material, true)
            }
          }
        }
        scene.traverse((object) => {
          const motion = object.userData.proceduralMotion as
            | { nodeId?: string; groupId?: string }
            | undefined
          if (!motion) return
          const pivot = restGroups.get(`${motion.nodeId}:${motion.groupId}`)
          if (!pivot) return
          transforms.push({
            object,
            position: object.position.clone(),
            rotation: object.rotation.clone(),
          })
          object.position.set(...pivot)
          object.rotation.set(0, 0, 0)
        })
        scene.updateMatrixWorld(true)
        const { blob, outW, outH } = await pipeline.capture({ captureMode: 'standard' })
        onComplete(blob, { w: outW, h: outH })
      } catch (error) {
        console.error(
          '[bake-thumbnail]',
          error instanceof Error ? (error.stack ?? error.message) : error,
        )
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        pipeline?.dispose()
        setKeyLightDirectionOverride(null)
        for (const mesh of added) disposeMesh(mesh)
        for (const object of hidden) object.visible = true
        for (const [material, intensity] of emission)
          (material as Material & { emissiveIntensity: number }).emissiveIntensity = intensity
        for (const { object, position, rotation } of transforms) {
          object.position.copy(position)
          object.rotation.copy(rotation)
        }
        scene.updateMatrixWorld(true)
        for (const [id, on] of priorLights)
          useInteractive
            .getState()
            .setProceduralLights(id as import('@pascal-app/core').AnyNodeId, on)
        restoreNodeVisibility()
      }
    }

    void run()
  }, [active, atmosphere, onComplete, onError, renderer, scene])

  return null
}
