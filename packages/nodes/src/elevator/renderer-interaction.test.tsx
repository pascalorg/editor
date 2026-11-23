import { expect, test } from 'bun:test'
import { BuildingNode, ElevatorNode, LevelNode, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { act } from '@react-three/test-renderer'
import { installMountedScene, mount } from '../__tests__/harness'
import { elevatorDefinition } from './definition'
import { elevatorRenderDefinition } from './definition.render'

installMountedScene()

test.each([
  ['render', elevatorRenderDefinition],
  ['full', elevatorDefinition],
] as const)(
  '%s elevator buttons preserve editor mode gating and viewer interaction',
  async (entry, definition) => {
    const building = BuildingNode.parse({})
    const levels = [0, 1, 2].map((level) => LevelNode.parse({ parentId: building.id, level }))
    const node = ElevatorNode.parse({
      parentId: building.id,
      fromLevelId: levels[0]!.id,
      toLevelId: levels[2]!.id,
      disabledLevelIds: [levels[1]!.id],
      serviceOnlyLevelIds: [levels[2]!.id],
    })
    building.children = [...levels.map((level) => level.id), node.id]
    useScene.setState({
      nodes: Object.fromEntries([building, ...levels, node].map((entry) => [entry.id, entry])),
    })
    const source = definition.renderer!
    if (source.kind !== 'parametric') throw new Error('Expected parametric elevator')
    const { default: Renderer } = await source.module()
    useEditor.setState({ mode: 'build', isPreviewMode: false })
    const renderer = await mount(<Renderer node={node} />)
    const checkButtons = (interactionEnabled: boolean) => {
      const kinds = new Set<string>()
      renderer.scene.instance.traverse((object) => {
        const button = object.userData.elevatorButton as
          | { action: string; kind: string; levelId?: string; disabled: boolean }
          | undefined
        if (!button) return
        kinds.add(`${button.kind}:${button.action}`)
        const unavailable =
          button.levelId === levels[1]!.id ||
          (button.kind === 'landing' && button.levelId === levels[2]!.id)
        expect(button.disabled).toBe(!interactionEnabled || unavailable)
      })
      expect(kinds).toEqual(
        new Set(['cab:request-level', 'cab:open-door', 'landing:request-level']),
      )
    }
    try {
      checkButtons(entry === 'render')
      await act(async () => useEditor.setState({ mode: 'select' }))
      checkButtons(true)
      await act(async () => useEditor.setState({ mode: 'build' }))
      checkButtons(entry === 'render')
      await act(async () => useEditor.setState({ isPreviewMode: true }))
      checkButtons(true)
    } finally {
      await renderer.unmount()
    }
  },
)
