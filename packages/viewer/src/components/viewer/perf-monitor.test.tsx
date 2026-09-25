import { afterEach, beforeEach, expect, test } from 'bun:test'
import { resetSceneHistoryPauseDepth, useScene } from '@pascal-app/core'
import { create } from '@react-three/test-renderer'
import useViewer from '../../store/use-viewer'
import { PerfMonitor } from './perf-monitor'

type Probe = {
  history: () => { past: number; future: number; tracking: boolean; pauseDepth: number }
  selection: () => { levelId: string | null; selectedIds: string[] }
}

// Other test files share this process's scene store: start from clean history.
function resetHistory() {
  resetSceneHistoryPauseDepth()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
}

beforeEach(resetHistory)

afterEach(() => {
  resetSceneHistoryPauseDepth()
  useScene.temporal.getState().resume()
  useScene.temporal.getState().clear()
})

test('the ?perf probe exposes history and selection while PerfMonitor is mounted', async () => {
  // The probe hangs off `window`; bun's test runtime has none, so alias it for this mount.
  const hadWindow = 'window' in globalThis
  if (!hadWindow) (globalThis as { window?: unknown }).window = globalThis
  const renderer = await create(<PerfMonitor />)
  try {
    const probe = (globalThis as { __pascalPerf?: Probe }).__pascalPerf
    expect(probe).toBeDefined()
    expect(probe!.history()).toMatchObject({ past: 0, future: 0, tracking: true, pauseDepth: 0 })

    useViewer.getState().setSelection({ levelId: 'level_probe', selectedIds: ['wall_probe'] })
    expect(probe!.selection()).toMatchObject({
      levelId: 'level_probe',
      selectedIds: ['wall_probe'],
    })
  } finally {
    await renderer.unmount()
    expect((globalThis as { __pascalPerf?: Probe }).__pascalPerf).toBeUndefined()
    if (!hadWindow) delete (globalThis as { window?: unknown }).window
  }
})
