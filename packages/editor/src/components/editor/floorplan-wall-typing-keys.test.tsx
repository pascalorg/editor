import { expect, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import { useKeyboard } from '../../hooks/use-keyboard'
import useEditor from '../../store/use-editor'
import { placementTypingLengthOptions, usePlacementTyping } from '../../store/use-placement-typing'
import { sceneLayout } from '../../store/view-layout'
import { withSelectionHarness } from '../../test-utils/selection-harness'
import type { WallPlanPoint } from '../tools/wall/wall-drafting'
import {
  type FloorplanWallTypingDraft,
  installFloorplanWallTypingKeys,
} from './floorplan-wall-typing-keys'

function GlobalShortcuts() {
  useKeyboard()
  return null
}

const press = (key: string) => {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    key,
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
  })
  window.dispatchEvent(event)
}

test('2D-only typed wall keys run ahead of the global shortcuts', async () => {
  await withSelectionHarness(async ({ render }) => {
    useEditor.getState().setViewLayout(sceneLayout('2d'))
    useEditor.getState().setPhase('building')
    useEditor.getState().armToolMode({ mode: 'build', tool: 'wall' })
    // The global handler is registered first, as the app mounts it.
    await render(<GlobalShortcuts />)

    let draft: FloorplanWallTypingDraft | null = {
      start: [0, 0],
      pointer: [2, 0],
      lengthOptions: placementTypingLengthOptions('metric', 'meters'),
    }
    const committed: WallPlanPoint[] = []
    const dropDraft = () => {
      draft = null
    }
    emitter.on('tool:cancel', dropDraft)
    const uninstall = installFloorplanWallTypingKeys({
      getDraft: () => draft,
      commit: (pointer) => committed.push(pointer),
    })
    try {
      press('1')
      press('m')
      expect(usePlacementTyping.getState().fields[0]).toBe('1m')
      expect(useEditor.getState().phase).toBe('building')
      expect(useEditor.getState().mode).toBe('build')
      expect(useEditor.getState().tool).toBe('wall')

      press('Escape')
      expect(usePlacementTyping.getState().isActive).toBe(false)
      expect(draft).not.toBeNull()
      expect(useEditor.getState().tool).toBe('wall')

      press('Escape')
      expect(draft).toBeNull()
      expect(committed).toEqual([])
    } finally {
      uninstall()
      emitter.off('tool:cancel', dropDraft)
      usePlacementTyping.getState().clear()
    }
  })
})

test('Enter commits the pointer the typed fields re-project, only in 2D-only view', async () => {
  await withSelectionHarness(async () => {
    const committed: WallPlanPoint[] = []
    const uninstall = installFloorplanWallTypingKeys({
      getDraft: () => ({
        start: [0, 0],
        pointer: [2, 0],
        lengthOptions: placementTypingLengthOptions('metric', 'meters'),
      }),
      commit: (pointer) => committed.push(pointer),
    })
    try {
      useEditor.getState().setViewLayout(sceneLayout('split'))
      press('3')
      expect(usePlacementTyping.getState().isActive).toBe(false)

      useEditor.getState().setViewLayout(sceneLayout('2d'))
      press('3')
      press('Enter')
      expect(committed).toEqual([[2, 0]])
    } finally {
      uninstall()
      usePlacementTyping.getState().clear()
    }
  })
})
