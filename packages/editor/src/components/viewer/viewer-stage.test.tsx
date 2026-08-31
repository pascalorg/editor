import { describe, expect, test } from 'bun:test'
import { LevelNode } from '@pascal-app/core/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FloorplanPreviewScene } from './floorplan-preview'
import { ViewerStage } from './viewer-stage'

const level = LevelNode.parse({ id: 'level_ground', type: 'level' })
const scene: FloorplanPreviewScene = { nodes: { [level.id]: level } }

describe('ViewerStage', () => {
  test('owns synchronized 2D and 3D composition by default', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage mode="split" scene={scene} showLevelSelector={false}>
        <div data-test-viewer-content="" />
      </ViewerStage>,
    )

    expect(markup).toContain('data-pascal-viewer-stage="split"')
    expect(markup).toContain('data-pascal-navigation-sync="on"')
    expect(markup).toContain('data-pascal-viewer-3d="true"')
    expect(markup).toContain('data-floorplan-preview=""')
    expect(markup).toContain('viewBox="0 0 48 48"')
  })

  test('keeps a 2D-only embed free of a 3D canvas mount', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage mode="2d" modes={['2d']} scene={scene} showLevelSelector={false} />,
    )

    expect(markup).toContain('data-pascal-viewer-stage="2d"')
    expect(markup).not.toContain('data-pascal-viewer-3d')
    expect(markup).toContain('data-floorplan-preview=""')
  })

  test('supports an explicit navigation synchronization opt-out', () => {
    const markup = renderToStaticMarkup(
      <ViewerStage
        mode="split"
        scene={scene}
        showLevelSelector={false}
        synchronizeNavigation={false}
      />,
    )

    expect(markup).toContain('data-pascal-navigation-sync="off"')
  })
})
