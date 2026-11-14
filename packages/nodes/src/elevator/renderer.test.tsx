import { expect, test } from 'bun:test'
import {
  BuildingNode,
  ElevatorNode,
  elevatorSlots,
  LevelNode,
  useInteractive,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Box3, type Material, Mesh, Raycaster, Vector3 } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
import { useElevatorInspection } from './inspection'
import { elevatorPaint } from './paint'
import { ElevatorRenderer } from './renderer'

installMountedScene()

test('a glass elevator shaft receives shadows without casting them, like window glass', async () => {
  useViewer.setState({ textures: true, shading: 'rendered' })
  const renderer = await mount(
    <ElevatorRenderer node={ElevatorNode.parse({ shaftStyle: 'glass' })} />,
  )
  const meshes: Mesh[] = []
  renderer.scene.instance.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child)
  })
  const glass = meshes.filter((mesh) => mesh.userData.slotId === 'glass')
  const opaqueCasters = meshes.filter(
    (mesh) => mesh.userData.slotId && mesh.userData.slotId !== 'glass' && mesh.castShadow,
  )
  expect(glass.length).toBeGreaterThan(0)
  expect(glass.every((mesh) => !mesh.castShadow)).toBe(true)
  expect(glass.some((mesh) => mesh.receiveShadow)).toBe(true)
  expect(opaqueCasters.length).toBeGreaterThan(0)
  await renderer.unmount()
})

for (const doorPanelStyle of ['glass-frame', 'solid-panel', 'segmented-panel'] as const) {
  test(`${doorPanelStyle} paintable surfaces keep metre-scale UVs and reversible slot previews`, async () => {
    const node = ElevatorNode.parse({
      shaftStyle: 'glass',
      doorPanelStyle,
      width: 2,
      depth: 1.4,
      cabHeight: 3,
      shaftWallThickness: 0.2,
    })
    useViewer.setState({ textures: true, shading: 'rendered' })
    const renderer = await mount(<ElevatorRenderer node={node} />)
    const meshes: Mesh[] = []
    renderer.scene.instance.traverse((child) => {
      if (child instanceof Mesh && child.userData.slotId) meshes.push(child)
    })
    expect(meshes.length).toBeGreaterThan(0)
    const slots = elevatorSlots(node).map((slot) => slot.slotId)
    for (const mesh of meshes) {
      expect(slots).toContain(mesh.userData.slotId)
      const position = mesh.geometry.getAttribute('position')
      const uv = mesh.geometry.getAttribute('uv')
      expect(uv.count).toBe(position.count)
      for (let face = 0; face < position.count; face += 4) {
        const a = face,
          b = face + 3
        const distance = Math.hypot(
          (position.getX(a) - position.getX(b)) * mesh.scale.x,
          (position.getY(a) - position.getY(b)) * mesh.scale.y,
          (position.getZ(a) - position.getZ(b)) * mesh.scale.z,
        )
        expect(Math.hypot(uv.getX(a) - uv.getX(b), uv.getY(a) - uv.getY(b))).toBeCloseTo(
          distance,
          5,
        )
      }
    }
    const original = meshes.map((mesh) => mesh.material)
    for (const role of new Set(meshes.map((mesh) => mesh.userData.slotId))) {
      const restore = elevatorPaint.applyPreview({
        node,
        role,
        root: renderer.scene.instance,
        material: {
          preset: 'custom',
          properties: {
            color: '#da3210',
            roughness: 0.5,
            metalness: 0,
            opacity: 1,
            transparent: false,
            side: 'front',
          },
        },
        materialPreset: undefined,
      })
      expect(restore).not.toBeNull()
      meshes.forEach((mesh, index) => {
        if (mesh.userData.slotId === role) expect(mesh.material).not.toBe(original[index])
        else expect(mesh.material).toBe(original[index])
      })
      restore?.()
      meshes.forEach((mesh, index) => {
        expect(mesh.material).toBe(original[index])
      })
    }
    await renderer.unmount()
  })
}

test('resizing releases old surface geometry, reuses glass finishes, and disposes owned glass on unmount', async () => {
  const node = ElevatorNode.parse({ shaftStyle: 'glass' })
  useViewer.setState({ textures: true, shading: 'rendered' })
  useScene.setState({ materials: {} })
  const renderer = await mount(<ElevatorRenderer node={node} />)
  const findGlass = () => {
    let found: Mesh | undefined
    renderer.scene.instance.traverse((child) => {
      if (!found && child instanceof Mesh && child.userData.slotId === 'glass') found = child
    })
    return found!
  }
  const glass = findGlass()
  let geometryDisposals = 0,
    materialDisposals = 0
  glass.geometry.addEventListener('dispose', () => geometryDisposals++)
  const material = glass.material as Material
  material.addEventListener('dispose', () => materialDisposals++)
  await renderer.update(<ElevatorRenderer node={{ ...node, width: 3 }} />)
  expect(geometryDisposals).toBe(1)
  expect(findGlass().material).toBe(material)
  expect(materialDisposals).toBe(0)
  await renderer.unmount()
  expect(materialDisposals).toBe(1)
})

test('shaft cutaway hides its shell while retaining the cab, door surfaces and stored geometry', async () => {
  const node = ElevatorNode.parse({ shaftStyle: 'glass' })
  const renderer = await mount(<ElevatorRenderer node={node} />)
  const meshes: Mesh[] = []
  renderer.scene.instance.traverse((child) => {
    if (child instanceof Mesh && child.userData.slotId) meshes.push(child)
  })
  const geometry = meshes.map((mesh) => mesh.geometry)
  const { act } = await import('@react-three/test-renderer')
  await act(async () => {
    useElevatorInspection.setState({ nodeId: node.id, cutaway: true, part: null })
  })
  expect(
    meshes.filter((mesh) => mesh.userData.slotId === 'shaft').every((mesh) => !mesh.visible),
  ).toBe(true)
  expect(
    meshes.filter((mesh) => mesh.userData.slotId === 'cab').every((mesh) => mesh.visible),
  ).toBe(true)
  meshes.forEach((mesh, index) => {
    expect(mesh.geometry).toBe(geometry[index])
  })
  await act(async () => {
    useElevatorInspection.setState({ nodeId: null, cutaway: false, part: null })
  })
  expect(meshes.every((mesh) => mesh.visible)).toBe(true)
  await renderer.unmount()
})

for (const doorStyle of ['center-opening', 'single-left', 'single-right'] as const) {
  test(`${doorStyle}: doors travel in separate pockets behind the stationary call panel`, async () => {
    const building = BuildingNode.parse({})
    const level = LevelNode.parse({ parentId: building.id, level: 0 })
    building.children = [level.id]
    const node = ElevatorNode.parse({ parentId: building.id, doorStyle, shaftWallThickness: 0.04 })
    useScene.setState({ nodes: { [building.id]: building, [level.id]: level, [node.id]: node } })
    useViewer.setState({ textures: true, shading: 'rendered' })
    const renderer = await mount(<ElevatorRenderer node={node} />)
    const root = renderer.scene.instance
    const panel = root.getObjectByName('landing-call-panel')!
    expect(panel).toBeDefined()
    const walls: Mesh[] = []
    root.traverse((object) => {
      if (object instanceof Mesh && object.userData.slotId === 'shaft') walls.push(object)
    })
    for (const amount of [0, 0.5, 1]) {
      useInteractive.getState().setElevatorState(node.id, {
        currentLevelId: level.id,
        doorOpen: amount,
        carY: 0,
      })
      await renderer.advanceFrames(1, 1 / 60)
      root.updateMatrixWorld(true)
      const panelBounds = new Box3().setFromObject(panel)
      const landing = new Box3(),
        cab = new Box3()
      root.traverse((object) => {
        if (object.name.startsWith('landing-door-')) landing.union(new Box3().setFromObject(object))
        if (object.name.startsWith('cab-door-') && object.name !== 'cab-door-surround')
          cab.union(new Box3().setFromObject(object))
      })
      expect(landing.isEmpty()).toBe(false)
      expect(cab.isEmpty()).toBe(false)
      expect(landing.min.z).toBeGreaterThan(panelBounds.max.z)
      expect(cab.min.z).toBeGreaterThan(landing.max.z + 0.01)
      const ray = new Raycaster(
        new Vector3(panel.position.x, 0.6, panelBounds.min.z - 1),
        new Vector3(0, 0, 1),
      )
      const hits = ray.intersectObjects(walls, false)
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0]!.point.z).toBeLessThan(landing.min.z)
    }
    await renderer.unmount()
  })
}
