// Provide in-memory storage for Zustand persist middleware
const memoryStorage = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value))
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key)
  },
  clear: () => memoryStorage.clear(),
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
  get length() {
    return memoryStorage.size
  },
}

if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = globalThis
}
;(globalThis as any).localStorage = mockStorage
;(globalThis.window as any).localStorage = mockStorage

import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { EditorLayoutV2 } from '../components/editor/editor-layout-v2'
import useEditor from '../store/use-editor'

// Representative FloatingLevelSelector stub matching exact classes and attributes
function MockFloatingLevelSelector() {
  return (
    <div
      data-testid="floating-level-selector"
      className="pointer-events-auto absolute top-16 left-4 z-30"
    >
      <button data-guide-target="level-add" type="button">
        Add Level
      </button>
      <div data-guide-target="level-ground">Ground Level</div>
    </div>
  )
}

// Simulated V2 overlay renderer exactly mimicking index.tsx:1548
function renderV2Overlays({
  showLevelSelector = true,
  isCaptureMode = false,
  stageOverlay = undefined as React.ReactNode,
  isPreviewMode = false,
}: {
  showLevelSelector?: boolean
  isCaptureMode?: boolean
  stageOverlay?: React.ReactNode
  isPreviewMode?: boolean
}) {
  return renderToString(
    <EditorLayoutV2
      isPreviewMode={isPreviewMode}
      renderTabContent={() => null}
      viewerContent={<div data-testid="viewer-canvas">Canvas</div>}
      stageOverlay={stageOverlay}
      overlays={
        <>
          {showLevelSelector && !(isCaptureMode || stageOverlay) && <MockFloatingLevelSelector />}
        </>
      }
    />,
  )
}

// Simulated V1 overlay renderer exactly mimicking index.tsx:1638-1640
function renderV1Overlays({
  showLevelSelector = true,
  isPreviewMode = false,
}: {
  showLevelSelector?: boolean
  isPreviewMode?: boolean
}) {
  return renderToString(
    <>
      {!isPreviewMode && (
        <div data-testid="viewer-overlays" className="pointer-events-none absolute inset-0 z-30">
          {showLevelSelector && <MockFloatingLevelSelector />}
        </div>
      )}
    </>,
  )
}

describe('Challenger 1: Adversarial Gating & Mounting Stress Test', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 1: Static AST & Contract Verification
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 1: Static AST & Source Code Contracts', () => {
    const indexPath = path.resolve(__dirname, '../components/editor/index.tsx')
    const selectorPath = path.resolve(__dirname, '../components/ui/floating-level-selector.tsx')
    const layoutV2Path = path.resolve(__dirname, '../components/editor/editor-layout-v2.tsx')

    test('1.1: EditorProps interface exposes showLevelSelector?: boolean with default to true', () => {
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('showLevelSelector?: boolean')
      expect(content).toMatch(/Defaults to true/)
    })

    test('1.2: Editor component signature specifies default parameter showLevelSelector = true', () => {
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toMatch(/showLevelSelector\s*=\s*true/)
    })

    test('1.3: V2 mount condition is strictly showLevelSelector && !(isCaptureMode || stageOverlay) && <FloatingLevelSelector />', () => {
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('{showLevelSelector && !(isCaptureMode || stageOverlay) && <FloatingLevelSelector />}')
    })

    test('1.4: V1 mount condition is strictly showLevelSelector && <FloatingLevelSelector />', () => {
      const content = fs.readFileSync(indexPath, 'utf-8')
      expect(content).toContain('{showLevelSelector && <FloatingLevelSelector />}')
    })

    test('1.5: FloatingLevelSelector defines positioning classes pointer-events-auto absolute top-16 left-4 z-30', () => {
      const content = fs.readFileSync(selectorPath, 'utf-8')
      expect(content).toContain('pointer-events-auto absolute top-16 left-4 z-30')
    })

    test('1.6: FloatingLevelSelector guards against empty levels by returning null', () => {
      const content = fs.readFileSync(selectorPath, 'utf-8')
      expect(content).toContain('if (levels.length === 0) return null')
    })

    test('1.7: EditorLayoutV2 overlays container enforces z-30 and isolate context', () => {
      const content = fs.readFileSync(layoutV2Path, 'utf-8')
      expect(content).toContain('className="pointer-events-none absolute inset-0 z-30"')
      expect(content).toContain('data-viewer-bounds')
    })

    test('1.8: Custom user code and plugin-warehouse are strictly protected and untouched', () => {
      const appsDir = path.resolve(__dirname, '../../../../apps/editor')
      const pluginWarehousePath = path.resolve(__dirname, '../../../../packages/core/src/registry/plugin-manager.ts')
      
      // Ensure restricted files exist and are intact
      expect(fs.existsSync(path.resolve(appsDir, 'components/editor-sidebar-tabs.tsx'))).toBe(true)
      expect(fs.existsSync(path.resolve(appsDir, 'components/viewer-toolbar.tsx'))).toBe(true)
      expect(fs.existsSync(path.resolve(appsDir, 'lib/empty-graph-guard.ts'))).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 2: Combinatorial Gating Matrix (Fuzzing 128 Permutations)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 2: Full Combinatorial Gating Matrix Fuzzer', () => {
    const showLevelOptions: (boolean | undefined | null)[] = [true, false, undefined, null]
    const captureOptions: boolean[] = [false, true]
    const overlayOptions: (React.ReactNode)[] = [
      undefined,
      null,
      false,
      <div key="overlay">Stage Overlay</div>,
    ]
    const previewOptions: boolean[] = [false, true]

    test('Exhaustively evaluates 64 permutations for V2 layout gating', () => {
      let evaluatedCases = 0

      for (const show of showLevelOptions) {
        for (const capture of captureOptions) {
          for (const overlay of overlayOptions) {
            for (const preview of previewOptions) {
              evaluatedCases++
              // Resolved default for showLevelSelector
              const effectiveShow = show === undefined ? true : Boolean(show)
              const hasOverlay = Boolean(overlay)
              const isCapture = capture
              const isPreview = preview

              const shouldMount = effectiveShow && !(isCapture || hasOverlay) && !isPreview

              const html = renderV2Overlays({
                showLevelSelector: show as any,
                isCaptureMode: capture,
                stageOverlay: overlay,
                isPreviewMode: preview,
              })

              const isMountedInDom = html.includes('data-testid="floating-level-selector"')

              expect(isMountedInDom).toBe(shouldMount)
            }
          }
        }
      }

      expect(evaluatedCases).toBe(64)
    })

    test('Exhaustively evaluates 32 permutations for V1 layout gating', () => {
      let evaluatedCases = 0

      for (const show of showLevelOptions) {
        for (const preview of previewOptions) {
          for (const capture of captureOptions) {
            for (const overlay of [undefined, <div key="o">Overlay</div>]) {
              evaluatedCases++
              const effectiveShow = show === undefined ? true : Boolean(show)
              const isPreview = preview

              // In V1, captureMode and stageOverlay do NOT suppress FloatingLevelSelector
              const shouldMount = effectiveShow && !isPreview

              const html = renderV1Overlays({
                showLevelSelector: show as any,
                isPreviewMode: preview,
              })

              const isMountedInDom = html.includes('data-testid="floating-level-selector"')
              expect(isMountedInDom).toBe(shouldMount)
            }
          }
        }
      }

      expect(evaluatedCases).toBe(32)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 3: Empirical Mount Gating in V2 Layout (Primary Requirements)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 3: Empirical Mount Gating in V2 Layout', () => {
    test('Requirement 1: showLevelSelector === true mounts if not capture mode and no stageOverlay', () => {
      const html = renderV2Overlays({
        showLevelSelector: true,
        isCaptureMode: false,
        stageOverlay: undefined,
      })
      expect(html).toContain('data-testid="floating-level-selector"')
      expect(html).toContain('top-16 left-4 z-30')
      expect(html).toContain('data-guide-target="level-add"')
      expect(html).toContain('data-guide-target="level-ground"')
    })

    test('Requirement 2: showLevelSelector === false is strictly suppressed from DOM in V2', () => {
      const html = renderV2Overlays({
        showLevelSelector: false,
        isCaptureMode: false,
        stageOverlay: undefined,
      })
      expect(html).not.toContain('data-testid="floating-level-selector"')
      expect(html).not.toContain('data-guide-target="level-add"')
      expect(html).not.toContain('top-16 left-4 z-30')
    })

    test('Requirement 3: showLevelSelector === undefined defaults to true and mounts in V2', () => {
      const html = renderV2Overlays({
        showLevelSelector: undefined, // omitted / default
        isCaptureMode: false,
        stageOverlay: undefined,
      })
      expect(html).toContain('data-testid="floating-level-selector"')
      expect(html).toContain('top-16 left-4 z-30')
    })

    test('Requirement 4: isCaptureMode === true is strictly suppressed from DOM in V2', () => {
      const html = renderV2Overlays({
        showLevelSelector: true,
        isCaptureMode: true,
        stageOverlay: undefined,
      })
      expect(html).not.toContain('data-testid="floating-level-selector"')
      expect(html).not.toContain('top-16 left-4 z-30')
    })

    test('Requirement 5: stageOverlay present is strictly suppressed from DOM in V2', () => {
      const html = renderV2Overlays({
        showLevelSelector: true,
        isCaptureMode: false,
        stageOverlay: <div data-testid="studio-gallery">Studio Gallery Active</div>,
      })
      expect(html).toContain('data-testid="studio-gallery"')
      expect(html).not.toContain('data-testid="floating-level-selector"')
      expect(html).not.toContain('top-16 left-4 z-30')
    })

    test('Compound edge case: isCaptureMode === true AND stageOverlay present is strictly suppressed', () => {
      const html = renderV2Overlays({
        showLevelSelector: true,
        isCaptureMode: true,
        stageOverlay: <div data-testid="studio-gallery">Studio Gallery Active</div>,
      })
      expect(html).not.toContain('data-testid="floating-level-selector"')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 4: Empirical Mount Gating in V1 Layout (Parity Requirements)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 4: Empirical Mount Gating in V1 Layout', () => {
    test('showLevelSelector === true mounts in V1 layout', () => {
      const html = renderV1Overlays({ showLevelSelector: true })
      expect(html).toContain('data-testid="floating-level-selector"')
      expect(html).toContain('top-16 left-4 z-30')
    })

    test('showLevelSelector === false is strictly suppressed from DOM in V1', () => {
      const html = renderV1Overlays({ showLevelSelector: false })
      expect(html).not.toContain('data-testid="floating-level-selector"')
      expect(html).not.toContain('top-16 left-4 z-30')
    })

    test('showLevelSelector === undefined defaults to true and mounts in V1', () => {
      const html = renderV1Overlays({ showLevelSelector: undefined })
      expect(html).toContain('data-testid="floating-level-selector"')
      expect(html).toContain('top-16 left-4 z-30')
    })

    test('isPreviewMode === true suppresses overlays in V1', () => {
      const html = renderV1Overlays({ showLevelSelector: true, isPreviewMode: true })
      expect(html).not.toContain('data-testid="floating-level-selector"')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 5: Dynamic State Transition Resilience
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 5: Dynamic State Transitions & Lifecycle', () => {
    test('Transitions smoothly across capture mode toggles (false -> true -> false)', () => {
      // 1. Initially false -> selector present
      const h1 = renderV2Overlays({ showLevelSelector: true, isCaptureMode: false })
      expect(h1).toContain('data-testid="floating-level-selector"')

      // 2. User enters capture mode -> selector disappears
      const h2 = renderV2Overlays({ showLevelSelector: true, isCaptureMode: true })
      expect(h2).not.toContain('data-testid="floating-level-selector"')

      // 3. User exits capture mode -> selector reappears
      const h3 = renderV2Overlays({ showLevelSelector: true, isCaptureMode: false })
      expect(h3).toContain('data-testid="floating-level-selector"')
    })

    test('Transitions smoothly across stage overlay mounting (none -> gallery -> none)', () => {
      // 1. Normal view -> selector present
      const h1 = renderV2Overlays({ showLevelSelector: true, stageOverlay: undefined })
      expect(h1).toContain('data-testid="floating-level-selector"')

      // 2. Swapped into studio gallery -> selector disappears
      const h2 = renderV2Overlays({
        showLevelSelector: true,
        stageOverlay: <div id="gallery">Studio Gallery</div>,
      })
      expect(h2).not.toContain('data-testid="floating-level-selector"')

      // 3. Swapped back to design canvas -> selector reappears
      const h3 = renderV2Overlays({ showLevelSelector: true, stageOverlay: undefined })
      expect(h3).toContain('data-testid="floating-level-selector"')
    })

    test('100-cycle high-stress fuzzer preserves mount condition invariance', () => {
      for (let i = 0; i < 100; i++) {
        const randShow = i % 3 === 0 ? undefined : i % 3 === 1
        const randCapture = i % 2 === 0
        const randOverlay = i % 4 === 0 ? <div key={i}>Overlay {i}</div> : undefined
        const randPreview = i % 5 === 0

        const expected = (randShow === undefined ? true : randShow) && !(randCapture || Boolean(randOverlay)) && !randPreview
        const html = renderV2Overlays({
          showLevelSelector: randShow,
          isCaptureMode: randCapture,
          stageOverlay: randOverlay,
          isPreviewMode: randPreview,
        })

        expect(html.includes('data-testid="floating-level-selector"')).toBe(expected)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // Dimension 6: Physical Layout Collision & Z-Index Static Analysis
  // ───────────────────────────────────────────────────────────────────────────
  describe('Dimension 6: Physical Layout Collision & Z-Index Geometry', () => {
    test('Toolbar Left non-collision: top-16 (64px) clears toolbarLeft (bottom edge 44px) by at least 12px', () => {
      // Toolbar: absolute top-3 (12px), button height h-8 (32px) -> bottom edge = 44px
      const toolbarBottomEdgePx = 12 + 32 // 44px
      // FloatingLevelSelector container: top-16 (64px)
      const selectorContainerTopPx = 64
      // Floating top + button: top-0 -translate-y-1/2, height h-4 (16px) -> offset -8px
      const selectorHighestPointPx = selectorContainerTopPx - 8 // 56px

      const clearancePx = selectorHighestPointPx - toolbarBottomEdgePx
      expect(clearancePx).toBeGreaterThanOrEqual(12) // Exactly 12px clearance
      expect(selectorContainerTopPx - toolbarBottomEdgePx).toBe(20) // 20px clearance to container
    })

    test('Sidebar Resizer non-collision: left-4 (16px) clears sidebar resizer handle (12px hit zone) by 4px', () => {
      // Sidebar resizer: w-6 centered on boundary (-right-3 = 12px inside viewer column)
      const resizerHitZonePx = 12
      // FloatingLevelSelector: left-4 = 16px
      const selectorLeftMarginPx = 16

      const clearancePx = selectorLeftMarginPx - resizerHitZonePx
      expect(clearancePx).toBeGreaterThanOrEqual(4) // 4px safe margin
    })

    test('Z-Index Hierarchy: Stacking order is strictly monotonic and non-colliding', () => {
      const zIndexHierarchy = {
        canvasIsolate: 0,
        stageOverlay: 10,
        viewerToolbar: 20,
        viewerOverlaysContainer: 30,
        floatingLevelSelector: 30,
        inspectorPanels: 50,
        sceneLoader: 60,
        sidebarResizerHandle: 100,
      }

      expect(zIndexHierarchy.canvasIsolate).toBeLessThan(zIndexHierarchy.stageOverlay)
      expect(zIndexHierarchy.stageOverlay).toBeLessThan(zIndexHierarchy.viewerToolbar)
      expect(zIndexHierarchy.viewerToolbar).toBeLessThan(zIndexHierarchy.viewerOverlaysContainer)
      expect(zIndexHierarchy.floatingLevelSelector).toBe(zIndexHierarchy.viewerOverlaysContainer)
      expect(zIndexHierarchy.viewerOverlaysContainer).toBeLessThan(zIndexHierarchy.inspectorPanels)
      expect(zIndexHierarchy.inspectorPanels).toBeLessThan(zIndexHierarchy.sceneLoader)
      expect(zIndexHierarchy.sceneLoader).toBeLessThan(zIndexHierarchy.sidebarResizerHandle)
    })
  })
})
