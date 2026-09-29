import { expect, test } from 'bun:test'
import { emitter, type GridEvent } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act } from '@react-three/fiber'
import { cancelActiveTool } from '../../../hooks/use-keyboard'
import { selectionEnabled } from '../../../lib/interaction/scope'
import useEditor from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import { withSelectionHarness } from '../../../test-utils/selection-harness'
import { PlaneBoxSelectTool } from './plane-box-select-tool'

for (const exit of ['Escape', 'unmount', 'pointercancel'] as const) {
  test(`plane marquee resets its drag and scope on ${exit}`, async () => {
    await withSelectionHarness(async ({ render, canvas }) => {
      useEditor.setState({
        phase: 'structure',
        mode: 'select',
        floorplanSelectionTool: 'marquee',
        isFloorplanHovered: true,
      })
      useViewer.setState({ inputDragging: false, cameraDragging: false })
      useInteractionScope.getState().end()
      await render(<PlaneBoxSelectTool />)
      await act(async () => {
        canvas.dispatchEvent(
          Object.assign(new Event('pointerdown'), { button: 0, clientX: 200, clientY: 200 }),
        )
        emitter.emit('grid:move', {
          position: [4, 0, 4],
          nativeEvent: { clientX: 800, clientY: 800 },
        } as GridEvent)
      })
      expect(useInteractionScope.getState().scope.kind).toBe('box-select')
      if (exit === 'unmount') await render(null)
      else
        await act(async () => {
          if (exit === 'Escape') cancelActiveTool()
          else window.dispatchEvent(new Event('pointercancel'))
        })
      expect(selectionEnabled(useInteractionScope.getState().scope)).toBe(true)
      expect(useViewer.getState().previewSelectedIds).toEqual([])
      if (exit === 'Escape') expect(useEditor.getState().floorplanSelectionTool).toBe('marquee')
      await act(async () => {
        emitter.emit('grid:move', {
          position: [6, 0, 6],
          nativeEvent: { clientX: 900, clientY: 900 },
        } as GridEvent)
        canvas.dispatchEvent(
          Object.assign(new Event('pointerup'), { button: 0, clientX: 900, clientY: 900 }),
        )
      })
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
    })
  })
}

test('plane marquee cleanup cannot release a replacement box-select owner', async () => {
  await withSelectionHarness(async ({ render, canvas }) => {
    useEditor.setState({ isFloorplanHovered: true })
    useViewer.setState({ inputDragging: false, cameraDragging: false })
    await render(<PlaneBoxSelectTool />)
    await act(async () => {
      canvas.dispatchEvent(
        Object.assign(new Event('pointerdown'), { button: 0, clientX: 200, clientY: 200 }),
      )
      emitter.emit('grid:move', {
        position: [4, 0, 4],
        nativeEvent: { clientX: 800, clientY: 800 },
      } as GridEvent)
    })
    const ownGesture = useInteractionScope.getState().gesture
    useInteractionScope.getState().begin({ kind: 'box-select' })
    const replacement = useInteractionScope.getState().gesture
    expect(replacement).not.toBe(ownGesture)
    await render(null)
    expect(useInteractionScope.getState().scope.kind).toBe('box-select')
    expect(useInteractionScope.getState().gesture).toBe(replacement)
  })
})
