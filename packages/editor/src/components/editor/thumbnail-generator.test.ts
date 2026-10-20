import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  createTerrainField,
  emitter,
  encodeTerrainField,
  getLevelElevations,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { type SceneViewPose, sceneViewPlan } from '@pascal-app/core/agent-operations'
import {
  BuildingNode,
  CeilingNode,
  LevelNode,
  SiteNode,
  SlabNode,
  WallNode,
} from '@pascal-app/core/schema'
import {
  groundWindowBoxNow,
  hideFromScene,
  SCENE_LAYER,
  SITE_GROUND,
  setGroundWindow,
  useViewer,
} from '@pascal-app/viewer'
import {
  Group,
  Layers,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three'
import { CanvasTarget, ClippingGroup, type WebGPURenderer } from 'three/webgpu'
import hillside from '../../../../core/src/lib/__fixtures__/owner-hillside-grade.json'
import victorSeattle from '../../lib/__fixtures__/owner-victor-seattle-parking.json'
import villaAurelia from '../../lib/__fixtures__/owner-villa-aurelia-basement.json'
import {
  atCaptureSize,
  captureDimensions,
  capturesOrthographically,
  exteriorGroundForCapture,
  interiorCutaway,
  presentFinished,
  presentWhileCapturing,
  pumpFrames,
  tileGrid,
} from './thumbnail-generator'

type FakeCanvas = { width: number; height: number; style: Record<string, string> }

const realDocument = (globalThis as { document?: unknown }).document

beforeEach(() => {
  ;(globalThis as { document?: unknown }).document = {
    createElement: (): FakeCanvas => ({ width: 0, height: 0, style: {} }),
  }
})

afterEach(() => {
  ;(globalThis as { document?: unknown }).document = realDocument
})

/** The part of three's renderer a capture's passes size themselves from. */
function fakeRenderer(canvas: FakeCanvas, pixelRatio: number) {
  const [cssWidth, cssHeight] = [canvas.width / pixelRatio, canvas.height / pixelRatio]
  let target = new CanvasTarget(canvas as unknown as HTMLCanvasElement)
  target.setPixelRatio(pixelRatio)
  target.setSize(cssWidth, cssHeight, false)
  const renderer = {
    getCanvasTarget: () => target,
    setCanvasTarget: (next: CanvasTarget) => {
      target = next
    },
    getDrawingBufferSize: (v: Vector2) => target.getDrawingBufferSize(v),
    get domElement() {
      return target.domElement
    },
  }
  return renderer as unknown as WebGPURenderer & typeof renderer
}

describe('supersampled capture', () => {
  test('an explicit camera renders at the requested resolution and aspect without resizing the pane', () => {
    const live: FakeCanvas = { width: 800, height: 1000, style: {} }
    const renderer = fakeRenderer(live, 1)
    const position: [number, number, number] = [2, 1, 3]
    const target: [number, number, number] = [0, 0, 0]
    for (const pose of [
      { perspective: { position, target, fov: 35 } },
      { ortho: { position, target, viewWidth: 4 } },
    ]) {
      const size = captureDimensions(
        [800, 1000],
        { ...pose, standardSize: { w: 1920, h: 1280 } },
        24_000_000,
      )
      expect(size).toEqual([1920, 1280])
      const buffer = atCaptureSize(renderer, ...size, () =>
        renderer.getDrawingBufferSize(new Vector2()).toArray(),
      )
      expect(buffer).toEqual([1920, 1280])
      expect([live.width, live.height]).toEqual([800, 1000])
    }
    expect(
      captureDimensions([800, 1000], { standardSize: { w: 1920, h: 1280 } }, 24_000_000),
    ).toEqual([800, 1000])
    expect(captureDimensions([800, 1000], { supersample: 2 }, 24_000_000)).toEqual([1600, 2000])
    expect(captureDimensions([6000, 4000], { supersample: 2 }, 6_000_000)).toEqual([3000, 2000])
  })

  test('renders at its own size while the live canvas keeps its size', () => {
    // a 1.5 dpr screen: the old capture resized the live canvas with drawing
    // buffer pixels where CSS pixels were due — 3× during the capture, 1.5×
    // after it, compounding capture after capture
    const live: FakeCanvas = { width: 1156, height: 791, style: {} }
    const renderer = fakeRenderer(live, 1.5)
    const liveTarget = renderer.getCanvasTarget()

    const seen = atCaptureSize(renderer, 2312, 1582, () => {
      expect(live.width).toBe(1156)
      expect(live.height).toBe(791)
      return {
        buffer: renderer.getDrawingBufferSize(new Vector2()).toArray(),
        canvas: [renderer.domElement.width, renderer.domElement.height],
      }
    })

    expect(seen.buffer).toEqual([2312, 1582])
    expect(seen.canvas).toEqual([2312, 1582])
    expect(renderer.getCanvasTarget()).toBe(liveTarget)
    expect([live.width, live.height]).toEqual([1156, 791])
    expect(renderer.getDrawingBufferSize(new Vector2()).toArray()).toEqual([1156, 791])
  })

  test('puts the live canvas target back when the render throws', () => {
    const live: FakeCanvas = { width: 800, height: 600, style: {} }
    const renderer = fakeRenderer(live, 1)
    const liveTarget = renderer.getCanvasTarget()
    expect(() =>
      atCaptureSize(renderer, 1600, 1200, () => {
        throw new Error('pipeline failed')
      }),
    ).toThrow('pipeline failed')
    expect(renderer.getCanvasTarget()).toBe(liveTarget)
    expect([live.width, live.height]).toEqual([800, 600])
  })

  test('a capture at the canvas size renders through the live target', () => {
    const live: FakeCanvas = { width: 800, height: 600, style: {} }
    const renderer = fakeRenderer(live, 1)
    const liveTarget = renderer.getCanvasTarget()
    const during = atCaptureSize(renderer, 800, 600, () => renderer.getCanvasTarget())
    expect(during).toBe(liveTarget)
  })
})

/** R3F's `advance` with `frameloop="never"`: the delta is the timestamp less the clock's elapsed time. */
function fakeLoop(startSeconds: number) {
  const clock = { elapsedTime: startSeconds, oldTime: startSeconds }
  const deltas: number[] = []
  const advance = (timestamp: number) => {
    deltas.push(timestamp - clock.elapsedTime)
    clock.oldTime = clock.elapsedTime
    clock.elapsedTime = timestamp
  }
  return { clock, deltas, advance }
}

describe('frames a capture runs by hand', () => {
  test('never hand the next real frame a delta it did not earn', async () => {
    // the viewer's frame limiter drives R3F's clock in seconds since it
    // mounted; performance.now() is milliseconds since the page loaded
    const loop = fakeLoop(330.62)
    await pumpFrames(loop.advance, loop.clock, 2)
    // the frame limiter's next frame, one 50 fps interval on
    loop.advance(330.64)
    expect(loop.deltas).toHaveLength(3)
    expect(loop.deltas[0]).toBeCloseTo(0.001, 9)
    expect(loop.deltas[1]).toBeCloseTo(0.001, 9)
    expect(loop.deltas[2]).toBeCloseTo(0.02, 9)
    expect(loop.clock.elapsedTime).toBe(330.64)
  })

  test('put the clock back when a frame throws', async () => {
    const loop = fakeLoop(12)
    const failing = () => {
      throw new Error('a system failed')
    }
    await expect(pumpFrames(failing, loop.clock, 1)).rejects.toThrow('a system failed')
    expect(loop.clock.elapsedTime).toBe(12)
  })
})

describe('a sheet capture session', () => {
  test('shows the finished house whatever view the user was in, then puts the view back', () => {
    const viewer = useViewer.getState()
    viewer.setWallMode('down')
    viewer.setLevelMode('exploded')
    viewer.setShading('solid')
    viewer.setTextures(false)
    viewer.setColorPreset('white')
    const view = () => {
      const { wallMode, levelMode, shading, textures, colorPreset } = useViewer.getState()
      return { wallMode, levelMode, shading, textures, colorPreset }
    }
    // the shading stays the user's: the capture brings its own AO

    const restore = presentFinished()
    expect(view()).toEqual({
      wallMode: 'up',
      levelMode: 'stacked',
      shading: 'solid',
      textures: true,
      colorPreset: 'clay',
    })

    restore()
    expect(view()).toEqual({
      wallMode: 'down',
      levelMode: 'exploded',
      shading: 'solid',
      textures: false,
      colorPreset: 'white',
    })
  })

  test('leaves a view already finished untouched', () => {
    const viewer = useViewer.getState()
    viewer.setWallMode('up')
    viewer.setLevelMode('stacked')
    viewer.setTextures(true)
    viewer.setColorPreset('clay')
    let writes = 0
    const unsubscribe = useViewer.subscribe(() => {
      writes++
    })
    presentFinished()()
    unsubscribe()
    expect(writes).toBe(0)
  })

  // A sheet's pictures and an agent's view can overlap: the user's view is the one before the
  // first, never a run's finished presentation.
  test('runs that overlap present once and put the view back after the last', () => {
    const session = (owner: string, active: boolean) =>
      emitter.emit('camera-controls:capture-session', { owner, active })
    const steps: string[] = []
    const stop = presentWhileCapturing(() => {
      steps.push('present')
      return () => steps.push('restore')
    })
    session('sheets-a', true)
    session('view-b', true)
    session('sheets-a', false)
    expect(steps).toEqual(['present'])
    session('nobody', false)
    session('view-b', false)
    expect(steps).toEqual(['present', 'restore'])
    session('view-c', true)
    stop()
    expect(steps).toEqual(['present', 'restore', 'present', 'restore'])
    session('view-c', false)
    expect(steps).toHaveLength(4)
  })

  // The generator mounted while a sheet captures (a remount, the editor opened mid-run): the run's
  // finished presentation from the first frame, the user's view back at its end.
  test('a run already on when the generator mounts is presented at once', () => {
    emitter.emit('camera-controls:capture-session', { owner: 'sheets-early', active: true })
    const steps: string[] = []
    const stop = presentWhileCapturing(() => {
      steps.push('present')
      return () => steps.push('restore')
    })
    expect(steps).toEqual(['present'])
    emitter.emit('camera-controls:capture-session', { owner: 'sheets-early', active: false })
    expect(steps).toEqual(['present', 'restore'])
    stop()
    expect(steps).toEqual(['present', 'restore'])
  })
})

describe('a print-size picture past one render pass', () => {
  test('fits one pass: one tile, the whole picture', () => {
    expect(tileGrid(3209, 2588, 4096)).toEqual([
      { x: 0, y: 0, w: 3209, h: 2588, inner: { x: 0, y: 0, w: 3209, h: 2588 } },
    ])
  })

  test('splits into equal tiles that cover every pixel once, each rendering past its seams', () => {
    // a 200 ppi elevation on Arch D: 22.1 in across
    const width = 4423
    const height = 3567
    const tiles = tileGrid(width, height, 4096)
    expect(tiles).toHaveLength(2)
    let covered = 0
    for (const tile of tiles) {
      expect(tile.w).toBeLessThanOrEqual(4096)
      expect(tile.h).toBeLessThanOrEqual(4096)
      // the rendered rect holds the contributed one, on the picture
      expect(tile.x).toBeLessThanOrEqual(tile.inner.x)
      expect(tile.x + tile.w).toBeGreaterThanOrEqual(tile.inner.x + tile.inner.w)
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.w).toBeLessThanOrEqual(width)
      covered += tile.inner.w * tile.inner.h
    }
    expect(covered).toBe(width * height)
    const [left, right] = tiles as [(typeof tiles)[number], (typeof tiles)[number]]
    expect(left.inner.x + left.inner.w).toBe(right.inner.x)
    // the seam: each side renders the other's first pixels too
    expect(left.x + left.w - (left.inner.x + left.inner.w)).toBeGreaterThan(0)
    expect(right.inner.x - right.x).toBeGreaterThan(0)
  })
})

describe('an interior view of a floor', () => {
  /** A two-storey house as the editor holds it: the scene graph, and each node's object. */
  function house() {
    const ground = LevelNode.parse({ id: 'level_ground', parentId: 'building_h', level: 0 })
    const upper = LevelNode.parse({ id: 'level_upper', parentId: 'building_h', level: 1 })
    const building = BuildingNode.parse({ id: 'building_h', children: [ground.id, upper.id] })
    const wall = WallNode.parse({
      id: 'wall_ground',
      parentId: ground.id,
      start: [0, 0],
      end: [6, 0],
    })
    const ceiling = CeilingNode.parse({
      id: 'ceiling_ground',
      parentId: ground.id,
      polygon: [
        [0, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ],
    })
    ground.children = [wall.id, ceiling.id]
    const nodes = Object.fromEntries(
      [building, ground, upper, wall, ceiling].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    useScene.setState({ nodes } as never)
    const objects = Object.fromEntries(
      [ground, upper, ceiling].map((node) => [node.id, new Group()]),
    ) as Record<string, Group>
    const wallMesh = new Mesh()
    wallMesh.layers.set(SCENE_LAYER)
    objects.level_ground!.add(wallMesh, objects.ceiling_ground!)
    for (const [id, object] of Object.entries({ ...objects, wall_ground: wallMesh }))
      sceneRegistry.nodes.set(id, object)
    return { objects, wallMesh }
  }

  afterEach(() => {
    for (const id of ['level_ground', 'level_upper', 'ceiling_ground', 'wall_ground'])
      sceneRegistry.nodes.delete(id)
  })

  test('leaves the rest of the house out and cuts the floor, for the one render', () => {
    const { objects, wallMesh } = house()
    hideFromScene(wallMesh, 'isolated')
    const restorers: (() => void)[] = []
    interiorCutaway('level_ground', (restore) => restorers.push(restore))

    expect(objects.level_upper!.visible).toBe(false)
    expect(objects.ceiling_ground!.visible).toBe(false)
    const [cut] = objects.level_ground!.children as ClippingGroup[]
    expect(objects.level_ground!.children).toHaveLength(1)
    expect(cut).toBeInstanceOf(ClippingGroup)
    expect(cut!.clipShadows).toBe(true)
    // Walls stand below the plane: y = 0.65 × a 2.5 m storey.
    const [plane] = cut!.clippingPlanes
    expect(plane!.normal.toArray()).toEqual([0, -1, 0])
    expect(plane!.constant).toBeCloseTo(1.625, 6)
    expect(cut!.children).toContain(wallMesh)
    // The user isolated something else: the floor still shows whole.
    expect(wallMesh.layers.test(new Layers())).toBe(true)

    for (const restore of restorers.reverse()) restore()
    expect(objects.level_upper!.visible).toBe(true)
    expect(objects.ceiling_ground!.visible).toBe(true)
    expect(objects.level_ground!.children).toEqual([wallMesh, objects.ceiling_ground!])
    expect(wallMesh.layers.test(new Layers())).toBe(false)
  })

  test('refuses a floor the editor has not built', () => {
    house()
    sceneRegistry.nodes.delete('level_ground')
    expect(() => interiorCutaway('level_ground', () => {})).toThrow('not built yet')
  })
})

// What a capture's own camera sees of the ground, on the owner's scenes (13 and 14 Oct, trimmed to
// their levels, slabs and walls) and a review's plate: the basement's floor and not the lawn, the
// window opened for the frame (and the person's own given back), and nothing opened from the
// garden side. Each test runs the cutaway as the capture does, looks, and restores.
describe('what a capture sees of the ground', () => {
  let previousScene: ReturnType<typeof useScene.getState>
  beforeEach(() => {
    previousScene = useScene.getState()
  })
  afterEach(() => {
    sceneRegistry.clear()
    useScene.setState(previousScene, true)
  })

  /**
   * The scene as the editor holds it: every level's object at its height, a floor in `basement`, and
   * the site's lawn (wider than any frame) with its veil, hidden. The veil is never picked, as
   * GroundVeil mounts it: the ray below sees through it.
   */
  function editorScene(
    nodes: Record<AnyNodeId, AnyNode>,
    basement?: string,
    siteId = 'site_owner',
  ) {
    useScene.setState({ nodes } as never)
    const scene = new Scene()
    for (const [levelId, { baseY }] of getLevelElevations(nodes)) {
      const level = new Group()
      level.position.y = baseY
      scene.add(level)
      sceneRegistry.nodes.set(levelId, level)
    }
    const floor = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2))
    if (basement) sceneRegistry.nodes.get(basement)?.add(floor)
    const ground = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2))
    ground.userData[SITE_GROUND] = 'solid'
    const veil = new Mesh(ground.geometry)
    veil.userData[SITE_GROUND] = 'veil'
    veil.visible = false
    veil.raycast = () => {}
    const lotLine = new Mesh()
    const site = new Group().add(ground, veil, lotLine)
    scene.add(site)
    sceneRegistry.nodes.set(siteId, site)
    sceneRegistry.byType.site?.add(siteId)
    return { scene, floor, ground, veil, lotLine }
  }

  /** Opens the capture's ground cutaway, runs `look`, restores in reverse; returns what `look` returns. */
  function whileCut<T>(open: (add: (restore: () => void) => void) => void, look: () => T): T {
    const restorers: (() => void)[] = []
    open((restore) => restorers.push(restore))
    try {
      return look()
    } finally {
      for (const restore of restorers.reverse()) restore()
    }
  }

  /** The first thing the capture camera draws on the line from its eye to its aim. */
  function firstSeen(scene: Scene, pose: SceneViewPose): Object3D | undefined {
    const eye = new Vector3(...pose.position)
    const ray = new Raycaster(eye, new Vector3(...pose.target).sub(eye).normalize())
    ray.layers.set(SCENE_LAYER)
    scene.updateMatrixWorld(true)
    const drawn = (object: Object3D | null): boolean =>
      !object || (object.visible && drawn(object.parent))
    return ray.intersectObject(scene, true).find((hit) => drawn(hit.object))?.object
  }

  const cameraAt = (position: [number, number, number]) => {
    const camera = new PerspectiveCamera()
    camera.position.set(...position)
    return camera
  }
  const persons = {
    min: [-6, 0, -7] as [number, number, number],
    max: [6, 3, 7] as [number, number, number],
  }

  // The villa's Lower Ground 3.35 m under the lawn, the Victor's parking 2.61 m under it and past
  // its west lot line.
  test.each([
    ['the villa Aurelia', villaAurelia, 'level_68jf2zqaukfjof3m', 'level_ztimtvrgdzzd6c9f'],
    ['the Victor Seattle', victorSeattle, 'level_q209tmgwuzcahwzj', 'level_wj5tz664u03eolux'],
  ] as const)(
    "the agent's picture of %s's basement sees its floor, not the lawn; a floor at grade is pictured on solid ground, even veiled",
    (_, owner, basement, atGrade) => {
      const nodes = owner.nodes as unknown as Record<AnyNodeId, AnyNode>
      const plan = sceneViewPlan(nodes, { target: basement })
      const { scene, floor, ground, veil, lotLine } = editorScene(nodes, basement)
      expect(firstSeen(scene, plan.pose)).toBe(ground)
      whileCut(
        (add) => interiorCutaway(basement, add),
        () => {
          expect(firstSeen(scene, plan.pose)).toBe(floor)
          expect(veil.visible).toBe(true)
          expect(lotLine.layers.isEnabled(SCENE_LAYER)).toBe(true)
        },
      )
      expect(firstSeen(scene, plan.pose)).toBe(ground)
      expect(veil.visible).toBe(false)

      // A floor at grade while the person has the ground veiled and aside.
      hideFromScene(ground, 'ground-aside')
      veil.visible = true
      whileCut(
        (add) => interiorCutaway(atGrade, add),
        () => {
          expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(true)
          expect(veil.visible).toBe(false)
        },
      )
      expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(false)
      expect(veil.visible).toBe(true)
    },
  )

  // The owner's hillside house (14 Oct): no floor buried, a 6 m plateau on the street side. A
  // capture from the street sees the house through the ground window, from its own camera,
  // whatever the person's view holds; from the garden side the ground stands solid.
  describe('on the hillside house', () => {
    const nodes = hillside.nodes as unknown as Record<AnyNodeId, AnyNode>
    const garden = Object.values(nodes).find(
      (node) => node.type === 'level' && node.name === 'Garden level · walk-out',
    )
    if (!garden) throw new Error('the hillside fixture is missing its garden level')

    test('from the street side the window opens for the frame and closes after it, the solid ground staying drawn; from the garden side none opens', () => {
      const { ground, veil } = editorScene(nodes, undefined, 'site_hillside')
      whileCut(
        (add) => interiorCutaway(garden.id, add, cameraAt([0, 7, -20])),
        () => {
          expect(groundWindowBoxNow()).not.toBeNull()
          expect(veil.visible).toBe(true)
          // Its window is cut per fragment, not by hiding it.
          expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(true)
        },
      )
      expect(groundWindowBoxNow()).toBeNull()
      expect(veil.visible).toBe(false)
      whileCut(
        (add) => interiorCutaway(garden.id, add, cameraAt([0, 3, 20])),
        () => {
          expect(groundWindowBoxNow()).toBeNull()
          expect(veil.visible).toBe(false)
        },
      )
    })

    // Both agent lanes ask with a perspective/orthographic pose of their own, not a cameraPose:
    // the posed exterior frame decides its window from its own eye, not the person's closed one.
    test('a posed exterior capture decides its own window and gives the person’s back; an unposed one decides none', () => {
      const { veil } = editorScene(nodes, undefined, 'site_hillside')
      whileCut(
        (add) => exteriorGroundForCapture(add, true, cameraAt([0, 7, -20])),
        () => {
          expect(groundWindowBoxNow()).not.toBeNull()
          expect(veil.visible).toBe(true)
        },
      )
      expect(groundWindowBoxNow()).toBeNull()
      expect(veil.visible).toBe(false)
      // The person's window, open for their eye, closes for a garden-side frame and returns; an
      // unposed capture leaves it alone.
      setGroundWindow(persons)
      whileCut(
        (add) => exteriorGroundForCapture(add, true, cameraAt([0, 3, 20])),
        () => expect(groundWindowBoxNow()).toBeNull(),
      )
      expect(groundWindowBoxNow()).toBe(persons)
      whileCut(
        (add) => exteriorGroundForCapture(add, false, cameraAt([0, 3, 20])),
        () => expect(groundWindowBoxNow()).toBe(persons),
      )
      expect(groundWindowBoxNow()).toBe(persons)
      setGroundWindow(null)
    })
  })

  // The review's plate (14 Oct): [-5,5] × [-4,4] at Y 0.2, terrain 2 m only inside x 0…4, z -3…3.
  // An interior capture from overhead opens the window over the buried eastern rooms: partly below
  // grade has no wholesale veil to fall back on.
  test('from overhead the window opens over the buried rooms of a floor partly below grade, and closes after', () => {
    const field = createTerrainField({ cols: 25, rows: 25, spacing: 1, origin: [-12, -12] })
    const heights = new Int16Array(field.heights)
    for (let row = 0; row < field.rows; row += 1)
      for (let col = 0; col < field.cols; col += 1) {
        const x = field.origin[0] + col * field.spacing
        const z = field.origin[1] + row * field.spacing
        if (x >= 0 && x <= 4 && z >= -3 && z <= 3) heights[row * field.cols + col] = 200
      }
    const list: AnyNode[] = [
      SiteNode.parse({
        id: 'site_a',
        children: ['building_a'],
        terrain: encodeTerrainField({ ...field, heights }),
      }),
      BuildingNode.parse({ id: 'building_a', parentId: 'site_a', children: ['level_0'] }),
      LevelNode.parse({
        id: 'level_0',
        level: 0,
        height: 3,
        parentId: 'building_a',
        children: ['slab_0'],
      }),
      SlabNode.parse({
        id: 'slab_0',
        parentId: 'level_0',
        elevation: 0.2,
        polygon: [
          [-5, -4],
          [5, -4],
          [5, 4],
          [-5, 4],
        ],
      }),
    ]
    const { ground, veil } = editorScene(
      Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>,
      undefined,
      'site_a',
    )
    whileCut(
      (add) => interiorCutaway('level_0', add, cameraAt([0, 15, 0])),
      () => {
        expect(groundWindowBoxNow()).not.toBeNull()
        expect(veil.visible).toBe(true)
        expect(ground.layers.isEnabled(SCENE_LAYER)).toBe(true)
      },
    )
    expect(groundWindowBoxNow()).toBeNull()
    expect(veil.visible).toBe(false)
  })
})

describe("a capture's projection", () => {
  const user = { ortho: new OrthographicCamera(), perspective: new PerspectiveCamera() }
  const view = { position: [8, 6, 8], target: [0, 1, 0] } as never

  test("a perspective view asked for stays perspective under the user's orthographic camera", () => {
    // Else view_scene's planned camera, a look into a floor from 55° or a photo's, would give
    // way to the user's own orthographic view while the result reports the planned one.
    expect(capturesOrthographically({ perspective: view }, user.ortho)).toBe(false)
    expect(capturesOrthographically({ ortho: view }, user.perspective)).toBe(true)
  })

  test("with no view of its own, a capture takes the user's projection", () => {
    expect(capturesOrthographically({}, user.ortho)).toBe(true)
    expect(capturesOrthographically({}, user.perspective)).toBe(false)
    expect(capturesOrthographically({ snapLevels: true }, user.ortho)).toBe(false)
  })
})
