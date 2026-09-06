import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const editorRoot = join(import.meta.dir, '..')

function readShipped(relativeFromSrc: string): string {
  return readFileSync(join(editorRoot, relativeFromSrc), 'utf8')
}

describe('camera auto-frame wiring (shipped sources)', () => {
  test('EditorContent mounts useAutoFrame and re-emits fit-scene on viewer scene-ready', () => {
    const index = readShipped('components/editor/index.tsx')
    expect(index).toContain("import { useAutoFrame } from '../../hooks/use-auto-frame'")
    expect(index).toContain('useAutoFrame()')
    expect(index).toContain("emitter.emit('camera-controls:fit-scene'")
    expect(index).toContain('isViewerSceneReady')
    expect(index).toContain('computeSceneBoundsXZ')
  })

  test('CustomCameraControls exposes __pascalCameraControls without NODE_ENV gate', () => {
    const controls = readShipped('components/editor/custom-camera-controls.tsx')
    expect(controls).toContain('__pascalCameraControls')
    expect(controls).not.toContain("process.env.NODE_ENV !== 'development'")
    expect(controls).not.toContain('process.env.NODE_ENV ===')
  })

  test('level-follow pans on level or mode change after first load, default pose only when scene empty', () => {
    const controls = readShipped('components/editor/custom-camera-controls.tsx')
    expect(controls).toContain('previousLevelIdRef')
    expect(controls).toContain('previousLevelModeRef')
    expect(controls).toContain('Object.keys(useScene.getState().nodes).length === 0')
    expect(controls).toContain('if (!levelChanged && !modeChanged) return')
    expect(controls).toContain('if (!currentLevelId) return')
    expect(controls).toContain('controls.current.moveTo(currentTarget.x, targetY, currentTarget.z, true)')
    expect(controls).not.toContain(
      'if (!previousLevelId || previousLevelId === currentLevelId) return',
    )
    expect(controls).not.toContain('skippedInitialLevelSelectRef')
  })

  test('useAutoFrame hook still emits fit-scene on empty->non-empty edge', () => {
    const hook = readShipped('hooks/use-auto-frame.ts')
    expect(hook).toContain('export function useAutoFrame')
    expect(hook).toContain("emitter.emit('camera-controls:fit-scene'")
    expect(hook).toContain('computeSceneBoundsXZ')
  })
})
