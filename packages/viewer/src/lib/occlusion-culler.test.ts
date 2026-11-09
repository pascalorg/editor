// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { SCENE_LAYER } from './layers'
import { attachOcclusionCuller, createOcclusionCuller } from './occlusion-culler'
import { renderWithSceneMatrices } from './scene-matrices'
import { hideFromScene } from './scene-visibility'

const opaque = new THREE.MeshStandardMaterial()

function owned(kind: string, mesh: THREE.Mesh, id = `${kind}_${mesh.id}`) {
  const owner = new THREE.Group()
  owner.userData = { kind, pascalId: id }
  owner.add(mesh)
  return owner
}

/** A 10×10 m wall at z = 0 between the camera (z = 10) and whatever stands behind it. */
function scene(wallMaterial: THREE.Material = opaque) {
  const root = new THREE.Group()
  const level = new THREE.Group()
  level.userData = { kind: 'level', pascalId: 'level_0' }
  root.add(level)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 0.2), wallMaterial)
  level.add(owned('wall', wall))
  const item = (x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), opaque)
    mesh.position.set(x, 0, z)
    level.add(owned('item', mesh))
    return mesh
  }
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  const update = () => {
    root.updateMatrixWorld(true)
    camera.updateMatrixWorld()
  }
  return { root, level, wall, item, camera, update }
}

describe('occlusion culler', () => {
  test('culls what is wholly behind a wall, keeps what peeks past it or stands in front', () => {
    const s = scene()
    const behind = s.item(0, -3)
    const beside = s.item(8, -3)
    const front = s.item(0, 3)
    s.update()
    const culled = createOcclusionCuller(s.root).cull(s.camera)
    expect(culled.has(behind)).toBe(true)
    expect(culled.has(beside)).toBe(false)
    expect(culled.has(front)).toBe(false)
    expect(culled.has(s.wall)).toBe(false)
  })

  test('glass and hidden walls hide nothing', () => {
    const glass = scene(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }))
    const behindGlass = glass.item(0, -3)
    glass.update()
    expect(createOcclusionCuller(glass.root).cull(glass.camera).has(behindGlass)).toBe(false)

    const hidden = scene()
    const behindHidden = hidden.item(0, -3)
    hidden.wall.parent!.visible = false
    hidden.update()
    expect(createOcclusionCuller(hidden.root).cull(hidden.camera).has(behindHidden)).toBe(false)
  })

  test('a merged wall still occludes, unless its level is held back', () => {
    const s = scene()
    const behind = s.item(0, -3)
    hideFromScene(s.wall, 'batched')
    s.update()
    expect(createOcclusionCuller(s.root).cull(s.camera).has(behind)).toBe(true)
    hideFromScene(s.wall, 'shadow-only')
    expect(createOcclusionCuller(s.root).cull(s.camera).has(behind)).toBe(false)
  })

  test('a hole in the wall shows what is behind it', () => {
    const s = scene()
    // Rebuild the wall as four panels around a 2×2 m opening.
    const panels = [
      [10, 4, 0, 3],
      [10, 4, 0, -3],
      [4, 2, -3, 0],
      [4, 2, 3, 0],
    ] as const
    s.wall.parent!.removeFromParent()
    for (const [w, h, x, y] of panels) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), opaque)
      panel.position.set(x, y, 0)
      s.level.add(owned('wall', panel, 'wall_hole'))
    }
    const throughHole = s.item(0, -3)
    const behindPanel = s.item(-3.5, -1)
    s.update()
    const culled = createOcclusionCuller(s.root).cull(s.camera)
    expect(culled.has(throughHole)).toBe(false)
    expect(culled.has(behindPanel)).toBe(true)
  })

  test('a box reaching behind the eye is always drawn', () => {
    const s = scene()
    const around = s.item(0, 9.9)
    around.scale.setScalar(4)
    s.update()
    expect(createOcclusionCuller(s.root).cull(s.camera).has(around)).toBe(false)
    expect(around.layers.isEnabled(SCENE_LAYER)).toBe(true)
  })

  test('culls only renders through its camera, through the pipeline, until detached', () => {
    const s = scene()
    const behind = s.item(0, -3)
    s.update()
    const world = new THREE.Scene()
    world.add(s.root)
    const pipeline = { isCulled: (_object: THREE.Object3D, _camera: THREE.Camera) => false }
    const detach = attachOcclusionCuller({
      scene: world,
      pipeline,
      culler: createOcclusionCuller(s.root),
      getCamera: () => s.camera,
    })
    const render = (camera: THREE.Camera) => {
      const args = [null, world, camera, null, null, null] as unknown as Parameters<
        THREE.Scene['onBeforeRender']
      >
      world.onBeforeRender(...args)
      const result = {
        behind: pipeline.isCulled(behind, camera),
        wall: pipeline.isCulled(s.wall, camera),
      }
      world.onAfterRender(...args)
      return result
    }
    expect(render(s.camera)).toEqual({ behind: true, wall: false })
    // Outside a render, and through another camera (the sun's shadow, a capture), nothing is.
    expect(pipeline.isCulled(behind, s.camera)).toBe(false)
    expect(render(s.camera.clone()).behind).toBe(false)
    expect(behind.layers.isEnabled(SCENE_LAYER)).toBe(true)
    detach()
    expect(render(s.camera).behind).toBe(false)
  })

  test('a single-sided plane occludes from its front only', () => {
    const s = scene()
    s.wall.geometry = new THREE.PlaneGeometry(10, 10)
    const behind = s.item(0, -3)
    s.update()
    expect(createOcclusionCuller(s.root).cull(s.camera).has(behind)).toBe(true)
    s.wall.rotation.y = Math.PI
    s.update()
    expect(createOcclusionCuller(s.root).cull(s.camera).has(behind)).toBe(false)
  })

  test('an item behind the near part of a wall seen at an angle is culled', () => {
    const s = scene()
    s.wall.rotation.y = 0.9
    const behind = s.item(-2.33, 0.41)
    behind.scale.setScalar(0.5)
    s.update()
    expect(createOcclusionCuller(s.root).cull(s.camera).has(behind)).toBe(true)
  })

  test('works through an orthographic camera', () => {
    const s = scene()
    const behind = s.item(0, -3)
    const beside = s.item(7, -3)
    const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    s.update()
    camera.updateMatrixWorld()
    const culled = createOcclusionCuller(s.root).cull(camera)
    expect(culled.has(behind)).toBe(true)
    expect(culled.has(beside)).toBe(false)
  })

  test('merged walls set aside for the render still occlude', () => {
    const s = scene()
    const behind = s.item(0, -3)
    hideFromScene(s.wall, 'batched')
    s.update()
    const culler = createOcclusionCuller(s.root)
    let culled = false
    let setAside = false
    renderWithSceneMatrices(s.root, () => {
      setAside = !s.wall.parent!.visible
      culled = culler.cull(s.camera).has(behind)
    })
    expect(setAside).toBe(true)
    expect(culled).toBe(true)
  })
})
