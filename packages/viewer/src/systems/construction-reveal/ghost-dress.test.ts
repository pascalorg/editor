import { afterEach, describe, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode } from '@pascal-app/core'
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { hasMaterialsForGroups } from '../../lib/pointer-events'
import useViewer from '../../store/use-viewer'
import { visibleMaterialsOf } from '../wall/wall-cutout-cache'
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

function cutAway(node: ReturnType<typeof wall>, hidden: boolean, groupIndex = 0) {
  const stipple = new MeshBasicMaterial({ transparent: true, opacity: 0.2 })
  const geometry = new BoxGeometry(4, 2.5, 0.2)
  geometry.clearGroups()
  geometry.addGroup(0, 6, groupIndex)
  const source = new Mesh(
    geometry,
    Array.from({ length: Math.max(3, groupIndex + 1) }, () => stipple),
  )
  source.userData.wallHidden = hidden
  // What the wall cutout keeps on the mesh it cuts away (`WallCutoutCache`).
  visibleMaterialsOf.set(source, visibleOf(node))
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
    dressDeletionGhost(source, clone)
    expect(clone.material).toBe(visibleOf(node))
    // The wall in the scene is not touched: only its copy.
    expect((source.material as unknown[])[0]).toBe(stipple)
  })

  // A room-wide paint preview regroups a wall's faces onto entries past its palette's end; a copy
  // that wore the shorter palette over those groups would throw on every raycast (`material.side`).
  test('keeps what it wears when the groups it carries outrun the palette', () => {
    const node = wall()
    useViewer.setState({ wallMode: 'cutaway' })
    const { source, clone, stipple } = cutAway(node, true, 99)
    dressDeletionGhost(source, clone)
    expect((clone.material as unknown[])[0]).toBe(stipple)
    expect(hasMaterialsForGroups(clone)).toBe(true)
  })

  test('keeps what it wears when the cutaway showed the wall', () => {
    const node = wall()
    useViewer.setState({ wallMode: 'cutaway' })
    const { source, clone } = cutAway(node, false)
    const worn = clone.material
    dressDeletionGhost(source, clone)
    expect(clone.material).toBe(worn)
  })

  test('keeps what it wears in the person’s other wall modes', () => {
    for (const wallMode of ['down', 'translucent', 'up'] as const) {
      const node = wall()
      useViewer.setState({ wallMode })
      const { source, clone } = cutAway(node, true)
      const worn = clone.material
      dressDeletionGhost(source, clone)
      expect(clone.material).toBe(worn)
    }
  })

  // The reveal knows no kind: a source that keeps no visible variant is not a cutaway's.
  test('is left alone when its source keeps no visible variant', () => {
    useViewer.setState({ wallMode: 'cutaway' })
    const node = wall()
    const { source, clone } = cutAway(node, true)
    visibleMaterialsOf.delete(source)
    const worn = clone.material
    dressDeletionGhost(source, clone)
    expect(clone.material).toBe(worn)
  })
})
