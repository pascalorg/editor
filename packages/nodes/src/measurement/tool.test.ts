import { afterEach, describe, expect, test } from 'bun:test'
import { sceneRegistry, useScene } from '@pascal-app/core'
import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import {
  buildMeasurementDraftLinePositions,
  castVisibleMeasurementSurface,
  closestMeasurementExtrusionHeight,
  collectMeasurementSurfaceRoots,
  isMeasurementSurfaceMaterialVisible,
  localNormalToPreviewFrame,
  measurementIntersectionWorldNormal,
  measurementVertexSnapAnchors,
  parseMeasurementExtrusionHeight,
  projectMeasurementPointToAxes,
  resolveSurfacePoint,
  selectAxisCandidateForSurfaceVerification,
  selectClosestMeasurementVertexIndex,
  selectClosestVerifiedAxisProjection,
} from './tool'

afterEach(() => {
  sceneRegistry.clear()
  useScene.setState({ nodes: {} } as never)
})

function createRegisteredMeasurementSurface() {
  const scene = new Group()
  const level = new Group()
  const geometry = new PlaneGeometry(10, 10)
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const surface = new Mesh(geometry, material)

  level.position.set(3, 4, -2)
  level.rotation.set(0.2, 0.7, -0.1)
  surface.position.set(1, 2, 0)
  level.add(surface)
  scene.add(level)
  scene.updateMatrixWorld(true)

  sceneRegistry.nodes.set('wall_surface', surface)
  useScene.setState({ nodes: { wall_surface: { type: 'wall' } } } as never)

  const center = surface.localToWorld(new Vector3())
  const worldNormal = new Vector3(0, 0, 1).applyQuaternion(
    surface.getWorldQuaternion(new Quaternion()),
  )
  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.copy(center.clone().addScaledVector(worldNormal, 10))
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  return {
    camera,
    canvas: {
      getBoundingClientRect: () => ({ height: 200, left: 0, top: 0, width: 200 }),
    } as unknown as HTMLCanvasElement,
    cleanup: () => {
      geometry.dispose()
      material.dispose()
    },
    event: { clientX: 100, clientY: 100 } as PointerEvent,
    level,
    scene,
  }
}

describe('measurement surface visibility', () => {
  test('rejects invisible raycast proxy materials', () => {
    const proxy = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    )

    expect(isMeasurementSurfaceMaterialVisible(proxy)).toBe(false)

    proxy.geometry.dispose()
    proxy.material.dispose()
  })

  test('checks the material used by the intersected face', () => {
    const hidden = new MeshBasicMaterial({ colorWrite: false })
    const rendered = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), [hidden, rendered])

    expect(isMeasurementSurfaceMaterialVisible(mesh, 0)).toBe(false)
    expect(isMeasurementSurfaceMaterialVisible(mesh, 1)).toBe(true)
    rendered.depthTest = false
    expect(isMeasurementSurfaceMaterialVisible(mesh, 1)).toBe(false)

    mesh.geometry.dispose()
    hidden.dispose()
    rendered.dispose()
  })

  test('accepts visible scene geometry without a registered node owner', () => {
    const scene = new Group()
    const registeredRoot = new Group()
    const editorHelperRig = new Group()
    const proxy = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    )
    const editorHelper = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    const systemMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    proxy.position.z = 1.5
    editorHelper.position.z = 1
    editorHelperRig.userData.measurementSurface = false
    systemMesh.userData.measurementSurface = true
    registeredRoot.add(proxy)
    editorHelperRig.add(editorHelper)
    registeredRoot.add(editorHelperRig)
    scene.add(registeredRoot)
    scene.add(systemMesh)
    scene.updateMatrixWorld(true)

    const roots = collectMeasurementSurfaceRoots(scene, [registeredRoot])
    expect(roots).toContain(systemMesh)

    const hit = castVisibleMeasurementSurface(
      new Raycaster(new Vector3(0, 0, 2), new Vector3(0, 0, -1)),
      { ownerByObject: new Map(), roots },
    )

    expect(hit?.intersection.object).toBe(systemMesh)
    expect(hit?.targetNodeId).toBeNull()

    proxy.geometry.dispose()
    proxy.material.dispose()
    editorHelper.geometry.dispose()
    editorHelper.material.dispose()
    systemMesh.geometry.dispose()
    systemMesh.material.dispose()
  })

  test('transforms normals by the intersected instance matrix', () => {
    const geometry = new PlaneGeometry(1, 1)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new InstancedMesh(geometry, material, 1)
    mesh.setMatrixAt(0, new Matrix4().makeRotationY(Math.PI / 2))
    mesh.instanceMatrix.needsUpdate = true
    mesh.updateMatrixWorld(true)

    const intersection = new Raycaster(new Vector3(2, 0, 0), new Vector3(-1, 0, 0)).intersectObject(
      mesh,
    )[0]
    expect(intersection).toBeDefined()
    if (!intersection) return

    const normal = measurementIntersectionWorldNormal(intersection)
    expect(normal.x).toBeCloseTo(1)
    expect(normal.y).toBeCloseTo(0)
    expect(normal.z).toBeCloseTo(0)

    geometry.dispose()
    material.dispose()
  })

  test('resolves a registered rendered surface into the active level frame', () => {
    const { camera, canvas, cleanup, event, level, scene } = createRegisteredMeasurementSurface()

    const resolved = resolveSurfacePoint(
      event,
      camera,
      canvas,
      new Raycaster(),
      new Vector2(),
      scene,
      level,
      null,
    )

    expect(resolved?.hit.targetNodeId).toBe('wall_surface')
    expect(resolved?.hit.point[0]).toBeCloseTo(1)
    expect(resolved?.hit.point[1]).toBeCloseTo(2)
    expect(resolved?.hit.point[2]).toBeCloseTo(0)
    expect(resolved?.hit.normal[0]).toBeCloseTo(0)
    expect(resolved?.hit.normal[1]).toBeCloseTo(0)
    expect(resolved?.hit.normal[2]).toBeCloseTo(1)
    cleanup()
  })

  test('recasts a nearby axis projection onto the registered surface', () => {
    const { camera, canvas, cleanup, event, level, scene } = createRegisteredMeasurementSurface()

    const resolved = resolveSurfacePoint(
      event,
      camera,
      canvas,
      new Raycaster(),
      new Vector2(),
      scene,
      level,
      [0.9, 1.9, 0],
    )

    expect(resolved?.hit.targetNodeId).toBe('wall_surface')
    expect(resolved?.guide?.snapped).toBe(true)
    expect(resolved?.hit.point).toEqual(resolved?.guide?.to)
    cleanup()
  })
})

describe('closestMeasurementExtrusionHeight', () => {
  test('returns the signed point on the extrusion axis nearest the pointer ray', () => {
    expect(
      closestMeasurementExtrusionHeight([5, 3, 0], [-1, 0, 0], [0, 0, 0], [0, 1, 0]),
    ).toBeCloseTo(3)
    expect(
      closestMeasurementExtrusionHeight([5, -2, 0], [-1, 0, 0], [0, 0, 0], [0, 1, 0]),
    ).toBeCloseTo(-2)
  })

  test('returns null when the pointer ray is parallel to the extrusion axis', () => {
    expect(closestMeasurementExtrusionHeight([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 1, 0])).toBeNull()
  })
})

describe('parseMeasurementExtrusionHeight', () => {
  test('converts numeric metric and imperial input to meters', () => {
    expect(parseMeasurementExtrusionHeight('2.5', 'metric')).toBeCloseTo(2.5)
    expect(parseMeasurementExtrusionHeight('10', 'imperial')).toBeCloseTo(3.048)
    expect(parseMeasurementExtrusionHeight('', 'metric')).toBeNull()
    expect(parseMeasurementExtrusionHeight('not-a-number', 'imperial')).toBeNull()
  })
})

describe('buildMeasurementDraftLinePositions', () => {
  test('expands polylines into finite non-indexed segment pairs', () => {
    expect(
      buildMeasurementDraftLinePositions([
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(1, 2, 0),
      ]),
    ).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 0])

    expect(
      buildMeasurementDraftLinePositions([
        new Vector3(0, 0, 0),
        new Vector3(Number.POSITIVE_INFINITY, 0, 0),
      ]),
    ).toEqual([])
    expect(
      buildMeasurementDraftLinePositions([new Vector3(0, 0, 0), new Vector3(1e100, 0, 0)]),
    ).toEqual([])
  })

  test('builds dashed guides from bounded line segments', () => {
    const positions = buildMeasurementDraftLinePositions(
      [new Vector3(0, 0, 0), new Vector3(0.3, 0, 0)],
      0.1,
      0.05,
    )

    expect(positions).toHaveLength(12)
    expect(positions[0]).toBeCloseTo(0)
    expect(positions[3]).toBeCloseTo(0.1)
    expect(positions[6]).toBeCloseTo(0.15)
    expect(positions[9]).toBeCloseTo(0.25)
    expect(positions.every(Number.isFinite)).toBe(true)
  })

  test('bounds dash geometry while covering very long guides', () => {
    const positions = buildMeasurementDraftLinePositions(
      [new Vector3(0, 0, 0), new Vector3(10_000, 0, 0)],
      0.08,
      0.05,
    )

    expect(positions).toHaveLength(512 * 6)
    expect(positions.at(-3)).toBeGreaterThan(9_900)
    expect(positions.every(Number.isFinite)).toBe(true)
  })
})

describe('measurement axis projection', () => {
  test('projects X and Z candidates onto the same horizontal surface', () => {
    expect(projectMeasurementPointToAxes([1, 0, 2], [4, 0, 7])).toEqual([
      { axis: 'x', point: [4, 0, 2] },
      { axis: 'y', point: [1, 0, 2] },
      { axis: 'z', point: [1, 0, 7] },
    ])
  })

  test('selects only the nearest verified projection inside the screen threshold', () => {
    const candidates = [
      {
        axis: 'x' as const,
        point: [4, 0, 2] as [number, number, number],
        screenDistance: 8,
        verified: true,
      },
      {
        axis: 'y' as const,
        point: [1, 0, 2] as [number, number, number],
        screenDistance: 3,
        verified: false,
      },
      {
        axis: 'z' as const,
        point: [1, 0, 7] as [number, number, number],
        screenDistance: 5,
        verified: true,
      },
    ]
    expect(selectClosestVerifiedAxisProjection(candidates)).toEqual({
      axis: 'z',
      point: [1, 0, 7],
    })
    expect(
      selectClosestVerifiedAxisProjection(
        candidates.map((candidate) => ({ ...candidate, screenDistance: 20 })),
      ),
    ).toBeNull()
  })

  test('keeps a locked axis through a wider magnetic release threshold', () => {
    const candidates = [
      {
        axis: 'x' as const,
        point: [4, 0, 2] as [number, number, number],
        screenDistance: 16,
        verified: true,
      },
      {
        axis: 'z' as const,
        point: [1, 0, 7] as [number, number, number],
        screenDistance: 4,
        verified: true,
      },
    ]

    expect(selectClosestVerifiedAxisProjection(candidates, 12, 'x', 18)).toEqual({
      axis: 'x',
      point: [4, 0, 2],
    })
    expect(
      selectClosestVerifiedAxisProjection(
        candidates.map((candidate) =>
          candidate.axis === 'x' ? { ...candidate, screenDistance: 19 } : candidate,
        ),
        12,
        'x',
        18,
      ),
    ).toEqual({ axis: 'z', point: [1, 0, 7] })
  })

  test('keeps a drag lock on the same adjacent anchor', () => {
    const firstAnchor = [0, 0, 0] as [number, number, number]
    const secondAnchor = [5, 1, 2] as [number, number, number]
    const candidates = [
      {
        anchor: firstAnchor,
        axis: 'x' as const,
        point: [3, 0, 0] as [number, number, number],
        screenDistance: 15,
        verified: true,
      },
      {
        anchor: secondAnchor,
        axis: 'x' as const,
        point: [3, 1, 2] as [number, number, number],
        screenDistance: 3,
        verified: true,
      },
    ]

    expect(selectClosestVerifiedAxisProjection(candidates, 12, 'x', 18, firstAnchor)).toEqual({
      axis: 'x',
      point: [3, 0, 0],
    })
    expect(
      selectClosestVerifiedAxisProjection(
        candidates.map((candidate) =>
          candidate.anchor === firstAnchor ? { ...candidate, screenDistance: 19 } : candidate,
        ),
        12,
        'x',
        18,
        firstAnchor,
      ),
    ).toEqual({ axis: 'x', point: [3, 1, 2] })
  })

  test('verifies only the nearest in-range candidate while preserving a magnetic lock', () => {
    const firstAnchor = [0, 0, 0] as [number, number, number]
    const secondAnchor = [4, 0, 0] as [number, number, number]
    const candidates = [
      {
        anchor: firstAnchor,
        axis: 'x' as const,
        point: [2, 0, 0] as [number, number, number],
        screenDistance: 16,
        verified: false,
      },
      {
        anchor: secondAnchor,
        axis: 'z' as const,
        point: [4, 0, 2] as [number, number, number],
        screenDistance: 4,
        verified: false,
      },
    ]

    expect(selectAxisCandidateForSurfaceVerification(candidates)).toBe(candidates[1])
    expect(selectAxisCandidateForSurfaceVerification(candidates, 12, 'x', 18, firstAnchor)).toBe(
      candidates[0],
    )
  })
})

describe('measurement draft vertex affordances', () => {
  test('selects the closest handle inside its screen threshold', () => {
    expect(selectClosestMeasurementVertexIndex([18, 7, 10])).toBe(1)
    expect(selectClosestMeasurementVertexIndex([18, 13, 20])).toBeNull()
  })

  test('uses both adjacent polygon vertices as drag snap anchors', () => {
    const points = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ] as [number, number, number][]

    expect(measurementVertexSnapAnchors(points, 0, true)).toEqual([
      [0, 0, 2],
      [2, 0, 0],
    ])
    expect(measurementVertexSnapAnchors(points, 2, true)).toEqual([
      [2, 0, 0],
      [0, 0, 2],
    ])
    expect(measurementVertexSnapAnchors(points.slice(0, 2), 0, false)).toEqual([[2, 0, 0]])
  })

  test('transforms a local surface normal into the preview parent frame', () => {
    const building = new Group()
    const level = new Group()
    building.rotation.y = 0.7
    level.rotation.z = Math.PI / 2
    building.add(level)
    building.updateMatrixWorld(true)

    const normal = localNormalToPreviewFrame(level, building, [1, 0, 0])
    expect(normal.x).toBeCloseTo(0)
    expect(normal.y).toBeCloseTo(1)
    expect(normal.z).toBeCloseTo(0)
  })
})
