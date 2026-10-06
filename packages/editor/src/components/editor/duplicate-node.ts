import {
  type AnyNode,
  type AnyNodeId,
  type CollectionId,
  ColumnNode,
  collectionIdsOf,
  DoorNode,
  ElevatorNode,
  FenceNode,
  generateId,
  ItemNode,
  nodeRegistry,
  RoofSegmentNode,
  runSceneHistoryDraftWrite,
  SpawnNode,
  StairSegmentNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  createFreshPlacementSubtree,
  duplicatesAsFreshSubtree,
  prepareFreshPlacementRootDuplicate,
} from '../../lib/fresh-planar-placement'
import { duplicateWithoutMove, registryMoveDisabled } from '../../lib/node-action-movement'
import { duplicateRoofSubtree } from '../../lib/roof-duplication'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import { startZoneRoomTransform } from './room-controls'

let carriedCopy: { id: AnyNodeId; sourceId: AnyNodeId } | null = null

/**
 * The collections a copy being placed joins when its move tool creates it:
 * its draft's when the copy is in the scene, else those of the node it copies.
 */
export function copyCollectionIds(copy: AnyNode): CollectionId[] {
  const { collections, nodes } = useScene.getState()
  if (nodes[copy.id as AnyNodeId]) return collectionIdsOf(collections, copy.id as AnyNodeId)
  if (carriedCopy?.id !== copy.id) return []
  return collectionIdsOf(collections, carriedCopy.sourceId)
}

/**
 * Duplicate one node and hand the copy to its move tool: the toolbar's and
 * every inspector's Duplicate. The copy is in the collections its source is in.
 */
export function duplicateNodeAndPickUp(node: AnyNode) {
  if (!node.parentId) return
  if (startZoneRoomTransform(node, 'duplicate')) return
  sfxEmitter.emit('sfx:item-pick')
  const { setMovingNode } = useEditor.getState()
  const { setSelection } = useViewer.getState()

  if (registryMoveDisabled(node)) {
    try {
      const id = duplicateWithoutMove(node)
      if (id) setSelection({ selectedIds: [id] })
    } catch (error) {
      console.error('Failed to duplicate node', error)
    }
    return
  }

  if (node.type === 'roof') {
    try {
      duplicateRoofSubtree(node.id as AnyNodeId, { mode: 'move' })
    } catch (error) {
      console.error('Failed to duplicate roof', error)
    }
    return
  }

  runSceneHistoryDraftWrite(() => {
    if (duplicatesAsFreshSubtree(node)) {
      let draftId: AnyNodeId | null = null
      try {
        draftId = createFreshPlacementSubtree(node.id as AnyNodeId)
        const draft = draftId ? useScene.getState().nodes[draftId] : null
        if (draft) {
          setMovingNode(draft)
          setSelection({ selectedIds: [] })
          return
        }
      } catch (error) {
        if (draftId && useScene.getState().nodes[draftId]) {
          useScene.getState().deleteNode(draftId)
        }
        console.error('Failed to duplicate node subtree', error)
      }
      return
    }

    const duplicateInfo = prepareFreshPlacementRootDuplicate(node) as any

    let duplicate: AnyNode | null = null
    try {
      if (node.type === 'door') {
        duplicate = DoorNode.parse(duplicateInfo)
      } else if (node.type === 'window') {
        duplicate = WindowNode.parse(duplicateInfo)
      } else if (node.type === 'item') {
        duplicate = ItemNode.parse(duplicateInfo)
      } else if (node.type === 'elevator') {
        duplicate = ElevatorNode.parse(duplicateInfo)
      } else if (node.type === 'column') {
        duplicate = ColumnNode.parse(duplicateInfo)
      } else if (node.type === 'wall') {
        duplicate = WallNode.parse(duplicateInfo)
      } else if (node.type === 'fence') {
        duplicate = FenceNode.parse(duplicateInfo)
        duplicate.start = [duplicate.start[0] + 1, duplicate.start[1] + 1]
        duplicate.end = [duplicate.end[0] + 1, duplicate.end[1] + 1]
      } else if (node.type === 'roof-segment') {
        duplicateInfo.id = generateId('rseg')
        duplicate = RoofSegmentNode.parse(duplicateInfo)
      } else if (node.type === 'stair-segment') {
        duplicate = StairSegmentNode.parse(duplicateInfo)
      } else if (node.type === 'spawn') {
        duplicate = SpawnNode.parse(duplicateInfo)
      }

      // Registry-driven fallback: any kind with a NodeDefinition can be
      // duplicated through its schema's parse(). Future built-in kinds
      // get duplicate for free.
      if (!duplicate) {
        const def = nodeRegistry.get(node.type)
        if (def) {
          duplicate = def.schema.parse(duplicateInfo) as AnyNode
        }
      }
    } catch (error) {
      console.error('Failed to parse duplicate', error)
      return
    }

    if (!duplicate) {
      return
    }

    const copy = duplicate
    // The copy is in the collections its source is in, from its draft on.
    const createCopy = () =>
      useScene.getState().createNodes([
        {
          node: copy,
          parentId: copy.parentId as AnyNodeId,
          collectionIds: collectionIdsOf(useScene.getState().collections, node.id),
        },
      ])
    if (
      duplicate.type === 'door' ||
      duplicate.type === 'window' ||
      duplicate.type === 'elevator' ||
      duplicate.type === 'wall' ||
      duplicate.type === 'fence'
    ) {
      createCopy()
    } else if (duplicate.type === 'roof-segment' || duplicate.type === 'stair-segment') {
      // Add small offset to make it visible
      if ('position' in duplicate) {
        duplicate.position = [
          duplicate.position[0] + 1,
          duplicate.position[1],
          duplicate.position[2] + 1,
        ]
      }
      createCopy()
    } else if (
      duplicate.type === 'item' ||
      duplicate.type === 'chimney' ||
      duplicate.type === 'dormer'
    ) {
      // Items, chimneys & dormers use pure drag-to-place: NO node is
      // inserted into the scene until the user clicks to commit. The
      // `setMovingNode` call below hands the clone (with
      // `metadata.isNew = true` + no id) to its move tool —
      // `MoveItemTool` / `MoveChimneyTool` / `MoveDormerTool` — which
      // create a draft and call `createNode` on the commit click.
      // Pre-creating here would drop a second copy into the scene
      // before any click — the furnish-tab "duplicate auto-places an
      // item without clicking" bug. (Item has its own
      // draft-committing move tool, so it must skip the generic
      // registry auto-create branch below.)
      carriedCopy = { id: duplicate.id as AnyNodeId, sourceId: node.id as AnyNodeId }
    } else if (
      duplicate.type === 'duct-segment' ||
      duplicate.type === 'duct-fitting' ||
      duplicate.type === 'pipe-segment' ||
      duplicate.type === 'lineset' ||
      duplicate.type === 'liquid-line'
    ) {
      // Duct runs & fittings, DWV pipe runs, and refrigerant linesets use
      // pure drag-to-place: NO node is inserted into the scene until the
      // commit click. `setMovingNode` below hands the clone (with
      // `metadata.isNew`) to its ghost tool (`MoveDuctSegmentTool` /
      // `MoveDuctFittingTool` / `MovePipeSegmentTool` / `MoveLinesetTool`),
      // which previews a translucent copy inside a footprint bounding box
      // on the cursor and calls `createNode` on the drop click.
      // Pre-creating here would drop a copy before any click — the
      // "auto-places it" bug.
      carriedCopy = { id: duplicate.id as AnyNodeId, sourceId: node.id as AnyNodeId }
    } else if (nodeRegistry.has(duplicate.type)) {
      // Registry-driven kinds: offset slightly so the duplicate doesn't
      // overlap exactly, then create + hand to the move tool. Mirrors the
      // roof-segment / stair-segment behavior.
      if ('position' in duplicate && Array.isArray((duplicate as any).position)) {
        const pos = (duplicate as { position: [number, number, number] }).position
        ;(duplicate as { position: [number, number, number] }).position = [
          pos[0] + 1,
          pos[1],
          pos[2] + 1,
        ]
      } else if ('path' in duplicate && Array.isArray((duplicate as any).path)) {
        // Other polyline kinds (pipe / lineset) carry a `path`, not a
        // `position`. Create the copy HIDDEN so nothing is auto-placed:
        // their shared path mover reveals it as a cursor-following preview
        // on the first mouse move and commits on the next click.
        ;(duplicate as { visible?: boolean }).visible = false
      }
      createCopy()
    }
    if (
      duplicate.type === 'item' ||
      duplicate.type === 'elevator' ||
      duplicate.type === 'column' ||
      duplicate.type === 'wall' ||
      duplicate.type === 'fence' ||
      duplicate.type === 'window' ||
      duplicate.type === 'door' ||
      duplicate.type === 'roof-segment' ||
      duplicate.type === 'spawn' ||
      duplicate.type === 'stair-segment' ||
      // Registry-driven kinds get picked up by MoveTool's generic
      // fallback (MoveRegistryNodeTool) so the user can reposition.
      nodeRegistry.has(duplicate.type)
    ) {
      setMovingNode(duplicate)
    }
    setSelection({ selectedIds: [] })
  })
}
