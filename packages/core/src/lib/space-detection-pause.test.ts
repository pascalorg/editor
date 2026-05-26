import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isSpaceDetectionPaused,
  pauseSpaceDetection,
  resumeSpaceDetection,
} from './space-detection'

// The pause flag is module-level (matching the existing pauseSceneHistory
// refcount in store/history-control.ts). Reset it before/after each test so
// leftover depth from one case can't bleed into another.
function drain() {
  for (let i = 0; i < 64 && isSpaceDetectionPaused(); i += 1) {
    resumeSpaceDetection()
  }
}

beforeEach(drain)
afterEach(drain)

describe('space-detection pause primitive', () => {
  test('defaults to not paused', () => {
    expect(isSpaceDetectionPaused()).toBe(false)
  })

  test('pauseSpaceDetection flips the flag, resumeSpaceDetection clears it', () => {
    pauseSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(true)
    resumeSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(false)
  })

  test('refcount — pause depth survives mismatched resumes from a second source', () => {
    pauseSpaceDetection()
    pauseSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(true)

    resumeSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(true)

    resumeSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(false)
  })

  test('resume is a no-op when not currently paused', () => {
    expect(isSpaceDetectionPaused()).toBe(false)
    resumeSpaceDetection()
    resumeSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(false)

    pauseSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(true)
    resumeSpaceDetection()
    expect(isSpaceDetectionPaused()).toBe(false)
  })
})
