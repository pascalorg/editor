import { expect, test } from 'bun:test'
import { ElevatorNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Mesh } from 'three'
import { installMountedScene, mount } from '../__tests__/harness'
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
