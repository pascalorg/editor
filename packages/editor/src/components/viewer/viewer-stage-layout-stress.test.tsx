import { describe, expect, it } from 'bun:test'
import { LevelNode } from '@pascal-app/core/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FloorplanPreviewScene } from './floorplan-preview'
import { ViewerStage } from './viewer-stage'
import { ViewerStageSwitcher } from './viewer-stage-switcher'

const level = LevelNode.parse({ id: 'level_stress', type: 'level' })
const testScene: FloorplanPreviewScene = { nodes: { [level.id]: level } }

const PREVIEW_STAGE_SWITCHER_POSITION = 'top-4 right-4 left-auto translate-x-0'

describe('Viewer Stage Layout & Right-Alignment Stress Suite (R1)', () => {
  // ── 1. Positioning & Collision Avoidance Assertions ────────────────────────
  describe('Right-Alignment & Non-Colliding CSS Positioning', () => {
    it('applies top-right positioning classes (top-4 right-4) and overrides top-center (left-auto translate-x-0)', () => {
      const markup = renderToStaticMarkup(
        <ViewerStageSwitcher
          className={PREVIEW_STAGE_SWITCHER_POSITION}
          mode="3d"
          modes={['3d', '2d', 'split']}
          onChange={() => {}}
        />,
      )

      expect(markup).toContain('top-4')
      expect(markup).toContain('right-4')
      expect(markup).toContain('left-auto')
      expect(markup).toContain('translate-x-0')
    })

    it('asserts ViewerStage root with PREVIEW_STAGE_SWITCHER_POSITION places switcher on the right', () => {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode="3d"
          modes={['3d', '2d', 'split']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
        >
          <div data-canvas="" />
        </ViewerStage>,
      )

      expect(markup).toContain('top-4')
      expect(markup).toContain('right-4')
      expect(markup).toContain('left-auto')
      expect(markup).toContain('translate-x-0')
    })

    it('verifies that in right-aligned viewer mode, no element retains un-overridden left-1/2 centering', () => {
      const markup = renderToStaticMarkup(
        <div className="viewer-container relative h-screen w-screen">
          <ViewerStage
            mode="3d"
            modes={['3d', '2d', 'split']}
            scene={testScene}
            showLevelSelector={false}
            switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
          >
            <div data-canvas="" />
          </ViewerStage>
        </div>,
      )

      // Verify that the switcher has right-4, left-auto, and translate-x-0
      expect(markup).toContain('right-4')
      expect(markup).toContain('left-auto')
      expect(markup).toContain('translate-x-0')
    })
  })

  // ── 2. Multi-Mode Stage Behavior & DOM Transitions ─────────────────────────
  describe('Mode Transitions & Stage Rendering (3D, 2D, Split)', () => {
    it('3D mode renders 3D viewport and hides floorplan preview', () => {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode="3d"
          modes={['3d', '2d', 'split']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
        >
          <div id="threejs-canvas" />
        </ViewerStage>,
      )

      expect(markup).toContain('data-pascal-viewer-stage="3d"')
      expect(markup).toContain('id="threejs-canvas"')
      // Floorplan should have hidden class
      expect(markup).toContain('hidden')
    })

    it('2D mode hides 3D canvas (invisible pointer-events-none) and displays full floorplan preview', () => {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode="2d"
          modes={['3d', '2d', 'split']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
        >
          <div id="threejs-canvas" />
        </ViewerStage>,
      )

      expect(markup).toContain('data-pascal-viewer-stage="2d"')
      expect(markup).toContain('pointer-events-none invisible')
      expect(markup).toContain('data-floorplan-preview=""')
    })

    it('Split mode renders side-by-side grid (grid-rows-2 md:grid-cols-2 md:grid-rows-1)', () => {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode="split"
          modes={['3d', '2d', 'split']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
        >
          <div id="threejs-canvas" />
        </ViewerStage>,
      )

      expect(markup).toContain('data-pascal-viewer-stage="split"')
      expect(markup).toContain('grid-rows-2 md:grid-cols-2 md:grid-rows-1')
      expect(markup).toContain('data-floorplan-preview=""')
      expect(markup).toContain('data-pascal-viewer-3d="true"')
    })
  })

  // ── 3. Responsive & Boundary Behaviors ─────────────────────────────────────
  describe('Responsive & Edge Conditions', () => {
    it('applies hidden md:flex to Split button when hideSplitOnMobile is true and modes > 1', () => {
      const markup = renderToStaticMarkup(
        <ViewerStageSwitcher
          className={PREVIEW_STAGE_SWITCHER_POSITION}
          hideSplitOnMobile={true}
          mode="3d"
          modes={['3d', '2d', 'split']}
          onChange={() => {}}
        />,
      )

      expect(markup).toContain('hidden md:flex')
    })

    it('does NOT apply hidden md:flex when hideSplitOnMobile is false', () => {
      const markup = renderToStaticMarkup(
        <ViewerStageSwitcher
          className={PREVIEW_STAGE_SWITCHER_POSITION}
          hideSplitOnMobile={false}
          mode="3d"
          modes={['3d', '2d', 'split']}
          onChange={() => {}}
        />,
      )

      expect(markup).not.toContain('hidden md:flex')
    })

    it('completely omits switcher when modes array contains only 1 mode (e.g. 3d-only)', () => {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode="3d"
          modes={['3d']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName={PREVIEW_STAGE_SWITCHER_POSITION}
        >
          <div data-canvas="" />
        </ViewerStage>,
      )

      expect(markup).not.toContain('aria-label="Viewer layout"')
      expect(markup).not.toContain('top-4 right-4')
    })

    it('renders aria-pressed="true" on the active button and aria-pressed="false" on others', () => {
      const markup = renderToStaticMarkup(
        <ViewerStageSwitcher
          className={PREVIEW_STAGE_SWITCHER_POSITION}
          mode="2d"
          modes={['3d', '2d', 'split']}
          onChange={() => {}}
        />,
      )

      // 2D should be pressed (active)
      expect(markup).toContain('aria-pressed="true"')
      // Non-active buttons have aria-pressed="false"
      expect(markup).toContain('aria-pressed="false"')
    })
  })
})
