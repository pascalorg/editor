import { describe, expect, test } from 'bun:test'
import type { WallMode } from '@pascal-app/viewer'
import { canBatchWalls } from './wall-batch-system'

/**
 * The merged mesh captures one material set when it is sewn and never re-reads
 * it, so it may only exist while every batched wall's materials hold still.
 * These are the states in which that is true.
 */
describe('canBatchWalls', () => {
  test('merges in the one mode that leaves wall materials alone', () => {
    expect(canBatchWalls('up', false)).toBe(true)
  })

  test('stands down in cutaway — the facing test re-assigns materials as the camera turns', () => {
    expect(canBatchWalls('cutaway', false)).toBe(false)
  })

  test('stands down in the modes that make walls see-through', () => {
    expect(canBatchWalls('down', false)).toBe(false)
    expect(canBatchWalls('translucent', false)).toBe(false)
  })

  test('stands down under isolation whatever the wall mode', () => {
    const modes: WallMode[] = ['up', 'cutaway', 'down', 'translucent']
    for (const mode of modes) {
      expect(canBatchWalls(mode, true)).toBe(false)
    }
  })
})
