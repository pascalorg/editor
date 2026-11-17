import { afterEach, beforeEach, expect, test } from 'bun:test'
import { useThree } from '@react-three/fiber'
import { act, create } from '@react-three/test-renderer'
import { Vector3 } from 'three'
import ClippingContext from 'three/src/renderers/common/ClippingContext.js'
import type { ClippingGroup } from 'three/webgpu'
import { SectionGroup, useViewer } from '../../index'
import { PointerRaycastLayers } from './pointer-raycast-layers'

const globals = [
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const
let descriptors: (PropertyDescriptor | undefined)[]
let previous: ReturnType<typeof useViewer.getState>
beforeEach(() => {
  descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  previous = useViewer.getState()
  useViewer.getState().setProjectId('section-component-test')
  useViewer.getState().setWalkthroughMode(false)
})
afterEach(() => {
  useViewer.setState(previous, true)
  globals.forEach((key, index) => {
    const descriptor = descriptors[index]
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  })
})

test('updates the same world plane and restores the section after walkthrough', async () => {
  const renderer = await create(
    <SectionGroup name="model">
      <group />
    </SectionGroup>,
  )
  try {
    const group = renderer.scene.children[0]!.instance as ClippingGroup
    const plane = group.clippingPlanes[0]!
    expect(group.enabled).toBe(false)
    expect(group.clipShadows).toBe(false)
    await act(async () => {
      useViewer.getState().setSectionEnabled(true)
      useViewer.getState().setSectionAxis('z')
      useViewer.getState().setSectionPosition(4)
    })
    expect(group.enabled).toBe(true)
    expect(group.clipShadows).toBe(false)
    const shadowContext = new ClippingContext()
    shadowContext.shadowPass = true
    expect(shadowContext.getGroupContext(group)).toBe(shadowContext)
    await act(async () => useViewer.getState().setSectionShadows('cut'))
    expect(group.clipShadows).toBe(true)
    expect(shadowContext.getGroupContext(group).unionClippingCount).toBe(1)
    await act(async () => useViewer.getState().setSectionShadows('full'))
    expect(group.clipShadows).toBe(false)
    expect(group.clippingPlanes).toEqual([plane])
    expect(plane.normal.toArray()).toEqual([0, 0, -1])
    expect(plane.constant).toBe(4)
    const context = new ClippingContext()
    const clipped = context.getGroupContext(group)
    const key = clipped.cacheKey
    const version = clipped.version
    await act(async () => {
      useViewer.getState().setSectionAxis('x')
      useViewer.getState().setSectionPosition(5)
      useViewer.getState().setSectionFlipped(true)
    })
    expect(context.getGroupContext(group).cacheKey).toBe(key)
    expect(clipped.version).toBe(version)
    for (const [i, value] of [-1, 0, 0, -5].entries()) {
      expect(clipped.unionPlanes[0]!.getComponent(i)).toBeCloseTo(value)
    }
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    expect(group.enabled).toBe(false)
    expect(useViewer.getState().sectionEnabled).toBe(true)
    await act(async () => useViewer.getState().setWalkthroughMode(false))
    expect(group.enabled).toBe(true)
    expect(group.clippingPlanes[0]).toBe(plane)
  } finally {
    await renderer.unmount()
  }
})

test('installs the pointer filter only during a cut and restores the host filter', async () => {
  let state: ReturnType<typeof useThree> | undefined
  const hostFilter = (hits: any[]) => hits
  function Events() {
    state = useThree()
    state.events.filter ??= hostFilter
    return <PointerRaycastLayers />
  }
  const renderer = await create(
    <>
      <Events />
      <SectionGroup name="cut-model">
        <group name="surface" />
      </SectionGroup>
      <group name="host-helper" />
    </>,
  )
  try {
    expect(state!.events.filter).toBe(hostFilter)
    await act(async () => useViewer.getState().setSectionEnabled(true))
    expect(state!.events.filter).not.toBe(hostFilter)
    const object = renderer.scene.findByProps({ name: 'surface' }).instance
    const helper = renderer.scene.findByProps({ name: 'host-helper' }).instance
    const hits = [
      { object, point: new Vector3(0, 1, 0) },
      { object, point: new Vector3(0, -1, 0) },
      { object: helper, point: new Vector3(0, 2, 0) },
    ]
    expect(state!.events.filter!(hits as any, state!)).toEqual(hits.slice(1))
    await act(async () => useViewer.getState().setSectionEnabled(false))
    expect(state!.events.filter).toBe(hostFilter)
  } finally {
    await renderer.unmount()
  }
})

test.each([
  { kind: 'zone', axis: 'x' },
  { kind: 'room', axis: 'x' },
  { kind: 'room', axis: 'y' },
] as const)(
  'the indexed $kind pass retains $axis section clipping ancestry',
  async ({ kind, axis }) => {
    const { LayerPassIndex, LayerPassNode } = await import('../../lib/layer-pass')
    const { ZONE_LAYER, OVERLAY_LAYER } = await import('../../lib/layers')
    const { RoomAssemblyMesh, describeZoneOutline } = await import('../../ui')
    const { ZoneNode } = await import('@pascal-app/core')
    const { Object3D } = await import('three')
    const layer = kind === 'zone' ? ZONE_LAYER : OVERLAY_LAYER
    const room = describeZoneOutline(
      'level_a',
      ZoneNode.parse({
        name: 'Room',
        polygon: [
          [-2, -2],
          [2, -2],
          [2, 2],
          [-2, 2],
        ],
      }),
    )
    const level = new Object3D()
    const { Layers, PerspectiveCamera, Scene } = await import('three')
    const { NodeFrame, PassNode } = await import('three/webgpu')
    useViewer.setState({
      sectionEnabled: true,
      sectionAxis: axis,
      sectionPosition: axis === 'y' ? 1.2 : 0,
    })
    const renderer = await create(
      kind === 'zone' ? (
        <SectionGroup>
          <mesh name="fill" layers={layer} />
          <mesh name="border" layers={layer} />
        </SectionGroup>
      ) : (
        <RoomAssemblyMesh
          room={room}
          heights={{
            floorY: 0,
            wallTops: new Map(),
            ceiling: { polygon: room.polygon, holes: [], y: 3 },
          }}
          levelObject={() => level}
        />
      ),
    )
    const group = renderer.scene.children[0]!.instance as ClippingGroup
    const scene = new Scene()
    scene.add(group)
    const index = new LayerPassIndex(scene, [layer])
    const camera = new PerspectiveCamera()
    const main = new PassNode(PassNode.COLOR, scene, camera)
    main.updateBefore = () => undefined
    const pass = new LayerPassNode(index, camera, layer, main)
    const layers = new Layers()
    layers.set(layer)
    pass.setLayers(layers)
    const seen: string[] = []
    const frame = new NodeFrame()
    frame.renderer = {
      getRenderTarget: () => null,
      setRenderTarget() {},
      getMRT: () => null,
      setMRT() {},
      getOutputRenderTarget: () => null,
      getDrawingBufferSize: (size: any) => size.set(100, 100),
      render(root: Scene) {
        const visit = (object: any, context: ClippingContext) => {
          if (object.isClippingGroup && object.enabled && camera.layers.test(object.layers))
            context = context.getGroupContext(object)
          if ((object.isMesh || object.isLineSegments) && camera.layers.test(object.layers)) {
            expect(context.unionPlanes).toHaveLength(1)
            seen.push(object.name)
          }
          for (const child of object.children) visit(child, context)
        }
        visit(root, new ClippingContext())
      },
    } as any
    try {
      pass.updateBefore(frame)
      if (kind === 'zone') expect(seen).toEqual(['fill', 'border'])
      else expect(seen).toHaveLength(3)
      const removed = new Vector3(0, 0, 0)
      removed[axis] = 2
      expect(group.clippingPlanes[0]!.distanceToPoint(removed)).toBeLessThan(0)
      await act(async () => useViewer.getState().setSectionEnabled(false))
      expect(group.enabled).toBe(false)
    } finally {
      index.dispose()
      pass.dispose()
      main.dispose()
      await renderer.unmount()
    }
  },
)

test.each(['x', 'y', 'z'] as const)(
  'baked %s cuts keep lot surfaces and capture ownership but clip a tree',
  async (axis) => {
    const { BakedSiteSurfaces, bakedSiteSurfaceScopes } = await import('./site-surface-scope')
    const { BoxGeometry, Group, Mesh } = await import('three')
    const { sceneRegistry } = await import('@pascal-app/core')
    const { SITE_GROUND, siteGround, siteSurfaces, sectionBounds } = await import('../../index')
    const { isSectionObject } = await import('./section-group')
    const root = new Group()
    const site = new Group()
    site.userData = { kind: 'site', pascalId: 'site_baked_cut' }
    site.position.set(4, 0, 2)
    const ground = new Mesh(new BoxGeometry(1000, 1, 1000))
    ground.userData[SITE_GROUND] = 'solid'
    const line = new Mesh()
    const tree = new Group()
    tree.userData = { kind: 'item', pascalId: 'item_tree' }
    tree.position.set(3, 2, 1)
    const canopy = new Mesh(new BoxGeometry(2, 4, 2))
    tree.add(canopy)
    site.add(ground, line, tree)
    root.add(site)
    root.updateWorldMatrix(true, true)
    const before = ground.matrixWorld.clone()
    const bounds = sectionBounds(root)!.clone()
    sceneRegistry.nodes.set('site_baked_cut', site)
    sceneRegistry.byType.site!.add('site_baked_cut')
    useViewer.setState({
      sectionEnabled: true,
      sectionAxis: axis,
      sectionPosition: axis === 'y' ? -2 : 0,
    })
    const renderer = await create(
      <SectionGroup name="baked-model-cut">
        <primitive object={root} />
        <BakedSiteSurfaces scopes={bakedSiteSurfaceScopes(root)} />
      </SectionGroup>,
    )
    try {
      await renderer.advanceFrames(1, 0.01)
      ground.updateWorldMatrix(true, false)
      expect(ground.matrixWorld.equals(before)).toBe(true)
      expect(isSectionObject(ground)).toBe(false)
      expect(isSectionObject(line)).toBe(false)
      expect(isSectionObject(canopy)).toBe(true)
      expect(sectionBounds(renderer.scene.instance as Object3D)!.equals(bounds)).toBe(true)
      const plane = (
        renderer.scene.findByProps({ name: 'baked-model-cut' }).instance as ClippingGroup
      ).clippingPlanes[0]!
      expect(plane.distanceToPoint(canopy.getWorldPosition(new Vector3()))).toBeLessThan(0)
      expect(siteGround().solid).toContain(ground)
      expect(siteSurfaces()).toEqual(expect.arrayContaining([ground, line]))
      await act(async () => useViewer.getState().setSectionEnabled(false))
      expect(site.children).toEqual([ground, line, tree])
      await act(async () => useViewer.getState().setSectionEnabled(true))
      expect(isSectionObject(ground)).toBe(false)
      await act(async () => useViewer.getState().setExporting(true))
      expect(site.children).toEqual([ground, line, tree])
      await act(async () => useViewer.getState().setExporting(false))
      expect(isSectionObject(ground)).toBe(false)
    } finally {
      await renderer.unmount()
      expect(site.children).toEqual([ground, line, tree])
      sceneRegistry.nodes.delete('site_baked_cut')
      sceneRegistry.byType.site!.delete('site_baked_cut')
    }
  },
)

test.each(['baked', 'live'] as const)(
  '%s site surfaces do not move on unchanged host rerenders during a cut',
  async (mode) => {
    const { BakedSiteSurfaces, bakedSiteSurfaceScopes, SiteSurfaceScope } = await import(
      './site-surface-scope'
    )
    const { Group, Mesh } = await import('three')
    const root = new Group()
    const site = new Group()
    site.userData = { kind: 'site', pascalId: 'site_rerender' }
    const ground = new Mesh()
    const horizon = new Mesh()
    const tree = new Group()
    tree.userData = { kind: 'item', pascalId: 'item_rerender' }
    ground.add(tree)
    if (mode === 'baked') site.add(ground, horizon)
    root.add(site)
    const scopes = bakedSiteSurfaceScopes(root)
    function Host() {
      return (
        <SectionGroup>
          <primitive object={root} />
          {mode === 'baked' ? (
            <BakedSiteSurfaces scopes={scopes} />
          ) : (
            <SiteSurfaceScope siteId="site_rerender" object={() => site}>
              <primitive object={ground} />
              <primitive object={horizon} />
            </SiteSurfaceScope>
          )}
        </SectionGroup>
      )
    }
    useViewer.setState({ sectionEnabled: true, isExporting: false })
    const renderer = await create(<Host />)
    let moves = 0
    const moved = () => moves++
    const objects = new Set([root, site, ground, horizon, tree, ground.parent!, tree.parent!])
    const hierarchy = [...objects].map((object) => ({
      object,
      parent: object.parent,
      children: object.children.map((child) => child.uuid),
    }))
    for (const object of objects) {
      object.addEventListener('added', moved)
      object.addEventListener('removed', moved)
    }
    try {
      for (let render = 0; render < 5; render++) await renderer.update(<Host />)
      expect(moves).toBe(0)
      for (const { object, parent, children } of hierarchy) {
        expect(object.parent).toBe(parent)
        expect(object.children.map((child) => child.uuid)).toEqual(children)
      }
    } finally {
      for (const object of objects) {
        object.removeEventListener('added', moved)
        object.removeEventListener('removed', moved)
      }
      await renderer.unmount()
    }
  },
)

test('room labels update with the section and a moving level, then return to their resting anchor', async () => {
  const { useSectionRoomLabel, RoomLabelSection } = await import(
    '../../ui/components/rooms/room-labels'
  )
  const { DEFAULT_LEVEL_HEIGHT } = await import('@pascal-app/core')
  const { Object3D } = await import('three')
  const level = new Object3D()
  level.position.y = 4
  const entry = {
    zoneId: 'zone_label_cut',
    polygon: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ] as [number, number][],
    holes: [],
    area: 16,
  }
  function Label() {
    const label = useSectionRoomLabel(entry, 0, 3)
    return label ? <group name="room-label" position={label.position} /> : null
  }
  useViewer.setState({
    sectionEnabled: false,
    sectionAxis: 'y',
    sectionPosition: 5.2,
    sectionFlipped: false,
  })
  const renderer = await create(
    <RoomLabelSection levelObject={() => level}>
      <Label />
    </RoomLabelSection>,
  )
  const position = () => renderer.scene.findByProps({ name: 'room-label' }).instance.position
  const frame = () =>
    act(async () => {
      await renderer.advanceFrames(1, 0.01)
    })
  try {
    expect(position().y).toBe(DEFAULT_LEVEL_HEIGHT / 2)
    await act(async () => useViewer.getState().setSectionEnabled(true))
    await frame()
    expect(position().y).toBeCloseTo(1.2)
    level.position.y = 5
    await frame()
    expect(position().y).toBeCloseTo(0.2)
    level.position.y = 6
    await frame()
    expect(renderer.scene.findAllByProps({ name: 'room-label' })).toHaveLength(0)
    await act(async () => useViewer.getState().setWalkthroughMode(true))
    await frame()
    expect(position().y).toBe(DEFAULT_LEVEL_HEIGHT / 2)
    await act(async () => {
      useViewer.getState().setSectionEnabled(false)
      useViewer.getState().setWalkthroughMode(false)
    })
    await frame()
    expect(position().y).toBe(DEFAULT_LEVEL_HEIGHT / 2)
  } finally {
    await renderer.unmount()
  }
})

test.each([false, true])(
  'baked ground lookups and capture veiling survive section cycles (site mesh: %s)',
  async (siteMesh) => {
    const { BakedSiteSurfaces, bakedSiteSurfaceScopes } = await import('./site-surface-scope')
    const { isSectionObject } = await import('./section-group')
    const { Group, Mesh, BoxGeometry } = await import('three')
    const { sceneRegistry } = await import('@pascal-app/core')
    const {
      SITE_GROUND,
      siteGround,
      siteSurfaces,
      temporarilyHideSiteSurfaces,
      temporarilyVeilGround,
      SCENE_LAYER,
    } = await import('../../index')
    const root = new Group()
    const site = siteMesh ? new Mesh(new BoxGeometry()) : new Group()
    site.userData = { kind: 'site', pascalId: 'site_nested' }
    if (siteMesh) site.userData[SITE_GROUND] = 'solid'
    const ground = new Mesh(new BoxGeometry())
    ground.userData[SITE_GROUND] = 'solid'
    const veil = new Mesh(new BoxGeometry())
    veil.userData[SITE_GROUND] = 'veil'
    veil.visible = false
    const tree = new Group()
    tree.userData = { kind: 'item', pascalId: 'item_nested_tree' }
    const canopy = new Mesh(new BoxGeometry())
    tree.add(canopy)
    site.add(ground, veil)
    ground.add(tree)
    root.add(site)
    sceneRegistry.nodes.set('site_nested', site)
    sceneRegistry.byType.site!.add('site_nested')
    const scopes = bakedSiteSurfaceScopes(root)
    useViewer.setState({ sectionEnabled: false })
    const renderer = await create(
      <SectionGroup>
        <primitive object={root} />
        <BakedSiteSurfaces scopes={scopes} />
      </SectionGroup>,
    )
    const solid = siteMesh ? [site, ground] : [ground]
    const check = () => {
      expect(siteGround().solid).toHaveLength(solid.length)
      expect(new Set(siteGround().solid)).toEqual(new Set(solid))
      expect(siteGround().veil).toEqual([veil])
      expect(new Set(siteSurfaces())).toEqual(new Set(solid))
      expect(siteSurfaces()).toHaveLength(solid.length)
      const restore = temporarilyVeilGround(true)
      try {
        for (const surface of solid) expect(surface.layers.isEnabled(SCENE_LAYER)).toBe(false)
        expect(veil.visible).toBe(true)
        for (let object = canopy.parent; object; object = object.parent)
          expect(object.visible).toBe(true)
        expect(canopy.layers.isEnabled(SCENE_LAYER)).toBe(true)
      } finally {
        restore()
      }
      for (const surface of solid) expect(surface.layers.isEnabled(SCENE_LAYER)).toBe(true)
      expect(veil.visible).toBe(false)
      const restoreThumbnail = temporarilyHideSiteSurfaces()
      try {
        expect(solid.filter((surface) => !surface.layers.isEnabled(SCENE_LAYER))).toHaveLength(
          solid.length,
        )
        expect(canopy.layers.isEnabled(SCENE_LAYER)).toBe(true)
        for (let object = canopy.parent; object; object = object.parent)
          expect(object.visible).toBe(true)
      } finally {
        restoreThumbnail()
      }
    }
    try {
      check()
      for (let cycle = 0; cycle < 2; cycle++) {
        await act(async () => useViewer.getState().setSectionEnabled(true))
        await renderer.advanceFrames(1, 0.01)
        expect(isSectionObject(ground)).toBe(false)
        if (siteMesh) expect(isSectionObject(site)).toBe(false)
        expect(isSectionObject(canopy)).toBe(true)
        const carriers = [tree.parent!, ...(siteMesh ? [tree.parent!.parent!] : [])]
        check()
        for (const carrier of carriers) expect(carrier.userData[SITE_GROUND]).toBeUndefined()
        await act(async () => useViewer.getState().setSectionEnabled(false))
        expect(root.children.map((child) => child.uuid)).toEqual([site.uuid])
        expect(site.children.map((child) => child.uuid)).toEqual([ground.uuid, veil.uuid])
        expect(ground.children.map((child) => child.uuid)).toEqual([tree.uuid])
        for (const carrier of carriers) expect(carrier.parent).toBeNull()
        check()
      }
    } finally {
      await renderer.unmount()
      sceneRegistry.nodes.delete('site_nested')
      sceneRegistry.byType.site!.delete('site_nested')
    }
  },
)

test('inactive label anchors do no per-label frame work', async () => {
  const { useSectionRoomLabel, RoomLabelSection } = await import(
    '../../ui/components/rooms/room-labels'
  )
  const { Object3D } = await import('three')
  const level = new Object3D()
  let matrices = 0
  let anchors = 0
  const update = level.updateWorldMatrix.bind(level)
  level.updateWorldMatrix = (...args) => {
    matrices++
    update(...args)
  }
  const entries = Array.from({ length: 120 }, (_, i) => ({
    zoneId: `zone_${i}`,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ] as [number, number][],
    holes: [],
    area: 16,
  }))
  // Accesses to a polygon observe anchor computation without timing the test.
  for (const entry of entries) {
    const polygon = entry.polygon
    Object.defineProperty(entry, 'polygon', {
      get() {
        anchors++
        return polygon
      },
    })
  }
  function Label({ entry }: { entry: (typeof entries)[number] }) {
    useSectionRoomLabel(entry, 0, 3)
    return null
  }
  useViewer.setState({ sectionEnabled: false })
  const renderer = await create(
    <RoomLabelSection levelObject={() => level}>
      {entries.map((entry) => (
        <Label key={entry.zoneId} entry={entry} />
      ))}
    </RoomLabelSection>,
  )
  try {
    matrices = 0
    anchors = 0
    await renderer.advanceFrames(10, 1 / 60)
    expect(matrices).toBe(0)
    expect(anchors).toBe(0)
  } finally {
    await renderer.unmount()
  }
})

test('a mixed site and non-site collective mesh stays in the cut', async () => {
  const { BakedSiteSurfaces, bakedSiteSurfaceScopes } = await import('./site-surface-scope')
  const { isSectionObject } = await import('./section-group')
  const { Group, Mesh, BoxGeometry } = await import('three')
  const root = new Group()
  const site = new Group()
  site.userData = { kind: 'site', pascalId: 'site_mixed' }
  // The retained batch has one draw and no per-triangle semantic ownership.
  const mixed = new Mesh(new BoxGeometry())
  mixed.userData.glbBatch = true
  site.add(mixed)
  root.add(site)
  useViewer.setState({ sectionEnabled: true })
  const renderer = await create(
    <SectionGroup>
      <primitive object={root} />
      <BakedSiteSurfaces scopes={bakedSiteSurfaceScopes(root)} />
    </SectionGroup>,
  )
  try {
    expect(isSectionObject(mixed)).toBe(true)
  } finally {
    await renderer.unmount()
  }
})
