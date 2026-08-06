import { afterEach, describe, expect, test } from 'bun:test'
import { useEditor, WALL_ALIGNMENTS } from '@pascal-app/editor'
import { wallDefinition } from './definition'

const chip = wallDefinition.toolHints?.find((hint) => hint.key === 'J')?.chip

afterEach(() => {
  useEditor.getState().setWallAlignment('center')
})

describe('wall justification chip', () => {
  test('is declared on the J hint', () => {
    expect(chip).toBeDefined()
  })

  test('reads the live setting, so the HUD says which side is armed', () => {
    useEditor.getState().setWallAlignment('left')
    expect(chip?.value()).toBe('left')

    useEditor.getState().setWallAlignment('right')
    expect(chip?.value()).toBe('right')
  })

  test('cycles the same state the keyboard path does', () => {
    // The chip click and the J key must not drift onto separate stores — the
    // contract says both hit the same one.
    chip?.cycle()
    expect(useEditor.getState().wallAlignment).not.toBe('center')

    for (let i = 0; i < WALL_ALIGNMENTS.length - 1; i++) chip?.cycle()
    expect(useEditor.getState().wallAlignment).toBe('center')
  })

  test('notifies subscribers when the setting changes', () => {
    let calls = 0
    const unsubscribe = chip!.subscribe(() => {
      calls++
    })

    useEditor.getState().setWallAlignment('left')
    expect(calls).toBeGreaterThan(0)

    unsubscribe()
    const settled = calls
    useEditor.getState().setWallAlignment('right')
    expect(calls).toBe(settled)
  })

  test('labels every value it can take', () => {
    for (const alignment of WALL_ALIGNMENTS) {
      expect(chip?.labels[alignment]).toBeDefined()
      expect(chip?.icons?.[alignment]).toBeDefined()
    }
  })
})
