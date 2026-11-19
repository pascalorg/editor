import { expect, test } from 'bun:test'
import {
  clearSceneHistory,
  createSceneApi,
  LawnNode,
  nodeRegistry,
  registerNode,
  SiteNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { sceneLayout, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Window as TestWindow } from 'happy-dom'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useLawnAuthoring } from './brush'
import { useLawnBrushController } from './brush-controller'
import { lawnDefinition } from './definition'
import LawnFlowersPanel from './parametrics-flowers'

function installDom() {
  const dom = new TestWindow()
  const globals = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    SVGElement: dom.SVGElement,
    Node: dom.Node,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const descriptors = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  return {
    dom,
    restore: async () => {
      await dom.happyDOM.abort()
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
    },
  }
}

function preserveStores() {
  const scene = useScene.getState()
  const editor = useEditor.getState()
  const viewer = useViewer.getState()
  const scope = useInteractionScope.getState()
  const authoring = useLawnAuthoring.getState()
  const overrides = useLiveNodeOverrides.getState()
  const restoreRegistry = nodeRegistry._snapshot()
  return () => {
    useScene.setState(scene)
    useEditor.setState(editor)
    useViewer.setState(viewer)
    useInteractionScope.setState(scope)
    useLawnAuthoring.setState(authoring)
    useLiveNodeOverrides.setState(overrides)
    restoreRegistry()
    clearSceneHistory()
  }
}

for (const view of ['2d', '3d'] as const) {
  test(`${view}: the selected lawn's brush controls arm painting, retain its panel and share saved strokes with undo`, async () => {
    const { dom, restore } = installDom()
    const restoreStores = preserveStores()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const site = SiteNode.parse({ id: 'site_inspector_brush', children: ['lawn_inspector_brush'] })
    const lawn = LawnNode.parse({
      id: 'lawn_inspector_brush',
      parentId: site.id,
      outline: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const sceneApi = createSceneApi(useScene)
    const finishTool = () => useEditor.getState().setTool(null)
    function Panel() {
      const tool = useEditor((state) => state.tool)
      return (
        <>
          <LawnFlowersPanel node={lawn} />
          {tool === 'lawn' && <BrushOwner />}
        </>
      )
    }
    function BrushOwner() {
      const brush = useLawnBrushController({
        sceneApi,
        siteId: site.id,
        view,
        finishTool,
      })
      return (
        <canvas
          onPointerDown={(event) => brush.start([1, 1], event.nativeEvent)}
          onPointerMove={(event) => brush.move([2, 1], event.nativeEvent)}
        />
      )
    }
    const click = async (label: string) => {
      const button = [...host.querySelectorAll('button')].find(
        (entry) => entry.textContent === label,
      )
      if (!button) throw new Error(`Missing control: ${label}`)
      await act(async () => button.click())
    }
    const number = async (label: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
      if (!input) throw new Error(`Missing input: ${label}`)
      await act(async () => {
        input.value = value
        input.dispatchEvent(new dom.FocusEvent('focusout', { bubbles: true }) as unknown as Event)
      })
    }
    const current = () => {
      const node = useScene.getState().nodes[lawn.id]
      if (node?.type !== 'lawn') throw new Error('Expected the selected lawn')
      return node
    }
    const paint = async () => {
      const canvas = host.querySelector('canvas')
      if (!canvas) throw new Error('The brush was not armed')
      const pointer = (type: string) =>
        new dom.PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          isPrimary: true,
          button: 0,
        }) as unknown as PointerEvent
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        await act(async () => {
          canvas.dispatchEvent(pointer(type))
        })
      }
    }
    try {
      nodeRegistry._reset()
      registerNode(lawnDefinition)
      useScene.setState({
        nodes: { [site.id]: site, [lawn.id]: lawn },
        rootNodeIds: [site.id],
        readOnly: false,
      })
      useInteractionScope.getState().end()
      useEditor.setState({
        phase: 'site',
        mode: 'select',
        tool: null,
        toolMode: { mode: 'select' },
        workspaceMode: 'edit',
        viewLayouts: { edit: sceneLayout(view) },
      })
      useViewer.getState().setSelection({ selectedIds: [lawn.id], zoneId: null })
      useLawnAuthoring.setState({
        mode: 'area',
        effect: 'bare',
        radiusM: 0.5,
        strength: 1,
        flowerSpecies: 'existing',
        flowerDensity: 0.5,
      })
      clearSceneHistory()
      await act(async () => root.render(<Panel />))
      await click('Brush lawn')
      expect(useEditor.getState().tool).toBe('lawn')
      expect(useEditor.getState().mode).toBe('build')
      expect(useEditor.getState().phase).toBe('site')
      expect(useViewer.getState().selection.selectedIds).toEqual([lawn.id])
      expect(current().strokes).toEqual([])
      expect(useScene.temporal.getState().pastStates).toHaveLength(0)
      await number('Brush radius', '0.8')
      await number('Brush strength', '0.75')
      await paint()
      expect(current().strokes).toEqual([
        {
          effect: 'bare',
          radiusM: 0.8,
          strength: 0.75,
          points: [
            [1, 1],
            [2, 1],
          ],
        },
      ])
      await click('Taller grass')
      await paint()
      await click('More flowers')
      await click('Daisy')
      await number('Flower heads per square metre', '0.7')
      await paint()
      expect(current().strokes.map((stroke) => stroke.effect)).toEqual([
        'bare',
        'taller',
        'more-flowers',
      ])
      expect(current().flowers).toEqual([{ species: 'daisy', share: 1 }])
      expect(current().flowerDensity).toBe(0.7)
      expect(host.querySelectorAll('ol li')).toHaveLength(3)
      expect(useScene.temporal.getState().pastStates).toHaveLength(3)
      await act(async () => useScene.temporal.getState().undo())
      expect(current().strokes.map((stroke) => stroke.effect)).toEqual(['bare', 'taller'])
      expect(host.querySelectorAll('ol li')).toHaveLength(2)
      await click('Remove stroke')
      expect(current().strokes.map((stroke) => stroke.effect)).toEqual(['taller'])
      await act(async () => useScene.temporal.getState().undo())
      expect(current().strokes.map((stroke) => stroke.effect)).toEqual(['bare', 'taller'])
      expect(useViewer.getState().selection.selectedIds).toEqual([lawn.id])
    } finally {
      await act(async () => root.unmount())
      restoreStores()
      await restore()
    }
  })
}
