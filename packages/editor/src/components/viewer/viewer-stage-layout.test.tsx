import { describe, expect, it } from 'bun:test'
import { LevelNode } from '@pascal-app/core/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FloorplanPreviewScene } from './floorplan-preview'
import { ViewerStage } from './viewer-stage'
import { ViewerStageSwitcher } from './viewer-stage-switcher'

const level = LevelNode.parse({ id: 'level_ground', type: 'level' })
const testScene: FloorplanPreviewScene = { nodes: { [level.id]: level } }

describe('Viewer Stage Layout & Right-Aligned Controls (R1)', () => {
  // ── Tier 1: Feature Coverage (R1 Layout) ───────────────────────────────────
  it('renders ViewerStageSwitcher with right-alignment positioning classes (top-4 right-4)', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        className="top-4 right-4 left-auto translate-x-0"
        mode="3d"
        modes={['3d', '2d', 'split']}
        onChange={() => {}}
      />,
    )

    expect(markup).toContain('top-4')
    expect(markup).toContain('right-4')
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Viewer layout"')
  })

  it('renders all three stage buttons (3D, 2D, Split) in right-aligned switcher', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        className="top-4 right-4"
        mode="3d"
        modes={['3d', '2d', 'split']}
        onChange={() => {}}
      />,
    )

    expect(markup).toContain('3D')
    expect(markup).toContain('2D')
    expect(markup).toContain('Split')
  })

  it('ViewerStage embeds ViewerStageSwitcher with top-right switcherClassName', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="3d"
        modes={['3d', '2d', 'split']}
        scene={testScene}
        showLevelSelector={false}
        switcherClassName="top-4 right-4 left-auto translate-x-0"
      >
        <div data-test-content="" />
      </ViewerStage>,
    )

    expect(markup).toContain('data-pascal-viewer-stage="3d"')
    expect(markup).toContain('top-4')
    expect(markup).toContain('right-4')
    expect(markup).toContain('aria-label="Viewer layout"')
  })

  it('applies active pressed state and styling to the currently selected mode', () => {
    const markup3D = renderToStaticMarkup(
      <ViewerStageSwitcher mode="3d" modes={['3d', '2d', 'split']} onChange={() => {}} />,
    )
    expect(markup3D).toContain('aria-pressed="true"')
    expect(markup3D).toContain('bg-white text-neutral-950')

    const markup2D = renderToStaticMarkup(
      <ViewerStageSwitcher mode="2d" modes={['3d', '2d', 'split']} onChange={() => {}} />,
    )
    expect(markup2D).toContain('aria-pressed="true"')

    const markupSplit = renderToStaticMarkup(
      <ViewerStageSwitcher mode="split" modes={['3d', '2d', 'split']} onChange={() => {}} />,
    )
    expect(markupSplit).toContain('aria-pressed="true"')
  })

  it('ViewerStage root sets data attributes for stage mode and navigation sync', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="split"
        scene={testScene}
        showLevelSelector={false}
        switcherClassName="top-4 right-4"
        synchronizeNavigation={true}
      >
        <div data-test-canvas="" />
      </ViewerStage>,
    )

    expect(markup).toContain('data-pascal-viewer-stage="split"')
    expect(markup).toContain('data-pascal-navigation-sync="on"')
  })

  // ── Tier 2: Boundary & Responsive Behavior (R1 Layout) ─────────────────────
  it('hides switcher when only a single mode is available', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="3d"
        modes={['3d']}
        scene={testScene}
        showLevelSelector={false}
      >
        <div data-test-content="" />
      </ViewerStage>,
    )

    expect(markup).not.toContain('aria-label="Viewer layout"')
  })

  it('hides Split button on mobile viewports when hideSplitOnMobile is true', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        hideSplitOnMobile={true}
        mode="3d"
        modes={['3d', '2d', 'split']}
        onChange={() => {}}
      />,
    )

    expect(markup).toContain('hidden md:flex')
  })

  it('renders Split button without mobile hiding when hideSplitOnMobile is false', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        hideSplitOnMobile={false}
        mode="3d"
        modes={['3d', '2d', 'split']}
        onChange={() => {}}
      />,
    )

    expect(markup).not.toContain('hidden md:flex')
  })

  it('renders custom modes subset (e.g. 2D and 3D only without Split)', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        mode="2d"
        modes={['2d', '3d']}
        onChange={() => {}}
      />,
    )

    expect(markup).toContain('2D')
    expect(markup).toContain('3D')
    expect(markup).not.toContain('Split')
  })

  it('renders with backdrop blur, rounded pills, and dark mode classes', () => {
    const markup = renderToStaticMarkup(
      <ViewerStageSwitcher
        className="top-4 right-4"
        mode="3d"
        modes={['3d', '2d', 'split']}
        onChange={() => {}}
      />,
    )

    expect(markup).toContain('rounded-full')
    expect(markup).toContain('backdrop-blur-xl')
    expect(markup).toContain('shadow-elevation-4')
  })

  // ── Tier 3: Cross-Feature Combinations (R1 Layout) ─────────────────────────
  it('split mode renders responsive two-column grid (md:grid-cols-2)', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="split"
        scene={testScene}
        showLevelSelector={false}
        switcherClassName="top-4 right-4"
      >
        <div data-test-3d="" />
      </ViewerStage>,
    )

    expect(markup).toContain('grid-rows-2 md:grid-cols-2 md:grid-rows-1')
    expect(markup).toContain('data-pascal-viewer-3d="true"')
    expect(markup).toContain('data-floorplan-preview=""')
  })

  it('2D mode hides 3D canvas and dedicates full viewport to floorplan', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="2d"
        scene={testScene}
        showLevelSelector={false}
        switcherClassName="top-4 right-4"
      >
        <div data-test-3d="" />
      </ViewerStage>,
    )

    expect(markup).toContain('data-pascal-viewer-stage="2d"')
    expect(markup).toContain('h-full w-full')
  })

  it('preserves top-right positioning across 2D, 3D, and Split stage modes', () => {
    const modes: Array<'3d' | '2d' | 'split'> = ['3d', '2d', 'split']
    for (const m of modes) {
      const markup = renderToStaticMarkup(
        <ViewerStage
          mode={m}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName="top-4 right-4 left-auto translate-x-0"
        >
          <div data-test-content="" />
        </ViewerStage>,
      )
      expect(markup).toContain('top-4 right-4')
      expect(markup).toContain(`data-pascal-viewer-stage="${m}"`)
    }
  })

  // ── Tier 4: Scenarios (R1 Layout) ──────────────────────────────────────────
  it('scenario: complete viewer layout rendering without top-center UI collision', () => {
    const markup = renderToStaticMarkup(
      <div className="relative h-screen w-screen overflow-hidden">
        {/* Top-right aligned stage switcher */}
        <ViewerStage
          mode="3d"
          modes={['3d', '2d', 'split']}
          scene={testScene}
          showLevelSelector={false}
          switcherClassName="top-4 right-4 left-auto translate-x-0"
        >
          <div data-pascal-viewer-canvas="" />
        </ViewerStage>
      </div>,
    )

    expect(markup).toContain('top-4 right-4')
    expect(markup).toContain('data-pascal-viewer-stage="3d"')
    expect(markup).toContain('data-pascal-viewer-canvas=""')
  })

  it('scenario: mode switching updates stage data attributes consistently', () => {
    const step1 = renderToStaticMarkup(
      <ViewerStage mode="3d" scene={testScene} showLevelSelector={false} switcherClassName="top-4 right-4" />,
    )
    expect(step1).toContain('data-pascal-viewer-stage="3d"')

    const step2 = renderToStaticMarkup(
      <ViewerStage mode="2d" scene={testScene} showLevelSelector={false} switcherClassName="top-4 right-4" />,
    )
    expect(step2).toContain('data-pascal-viewer-stage="2d"')

    const step3 = renderToStaticMarkup(
      <ViewerStage mode="split" scene={testScene} showLevelSelector={false} switcherClassName="top-4 right-4" />,
    )
    expect(step3).toContain('data-pascal-viewer-stage="split"')
  })
})
