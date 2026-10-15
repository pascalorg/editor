import { afterEach, describe, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import useViewer from '../../store/use-viewer'
import { getMaterialsForWall } from '../wall/wall-materials'
import { dressDeletionGhost } from './ghost-dress'

/*
 * Failure mode this file pins (the owner's rule, 15 Oct: a node that plays is never hidden by the
 * cutaway): a deleted wall's picture is a copy of its mesh, and a copy shares the material its source
 * wore in that frame. A wall the cutaway was hiding wore its stipple, so its deletion played as faint
 * dots and never changed with the view, because the copy is not a registered wall.
 */

const previousViewer = useViewer.getState()
afterEach(() => useViewer.setState(previousViewer))

function wall() {
  const level = LevelNode.parse({ level: 0 })
  return WallNode.parse({
    parentId: level.id,
    start: [0, 0],
    end: [4, 0],
    frontSide: 'interior',
    backSide: 'exterior',
  })
}

function cutAway(node: ReturnType<typeof wall>, hidden: boolean) {
  const stipple = new MeshBasicMaterial({ transparent: true, opacity: 0.2 })
  const source = new Mesh(new BoxGeometry(4, 2.5, 0.2), [stipple, stipple, stipple])
  source.userData.wallHidden = hidden
  const clone = source.clone()
  return { source, clone, stipple, node }
}

function visibleOf(node: ReturnType<typeof wall>) {
  const viewer = useViewer.getState()
  return getMaterialsForWall(
    node,
    viewer.shading,
    viewer.textures,
    viewer.colorPreset,
    viewer.sceneTheme,
    useScene.getState().materials,
    [],
  ).visible
}

describe('the picture of a deleted wall', () => {
  test('wears the wall’s own visible variant when the cutaway was hiding it', () => {
    const node = wall()
    useViewer.setState({ wallMode: 'cutaway' })
    const { source, clone, stipple } = cutAway(node, true)
    expect((clone.material as unknown[])[0]).toBe(stipple)
    dressDeletionGhost(source, clone, node)
    expect(clone.material).toBe(visibleOf(node))
    // The wall in the scene is not touched: only its copy.
    expect((source.material as unknown[])[0]).toBe(stipple)
  })

  test('keeps what it wears when the cutaway showed the wall', () => {
    const node = wall()
    useViewer.setState({ wallMode: 'cutaway' })
    const { source, clone } = cutAway(node, false)
    const worn = clone.material
    dressDeletionGhost(source, clone, node)
    expect(clone.material).toBe(worn)
  })

  test('keeps what it wears in the person’s other wall modes', () => {
    for (const wallMode of ['down', 'translucent', 'up'] as const) {
      const node = wall()
      useViewer.setState({ wallMode })
      const { source, clone } = cutAway(node, true)
      const worn = clone.material
      dressDeletionGhost(source, clone, node)
      expect(clone.material).toBe(worn)
    }
  })

  test('is left alone for anything that is not a wall', () => {
    useViewer.setState({ wallMode: 'cutaway' })
    const node = wall()
    const { source, clone } = cutAway(node, true)
    const worn = clone.material
    dressDeletionGhost(source, clone, { ...node, type: 'fence' } as never)
    expect(clone.material).toBe(worn)
  })
})
