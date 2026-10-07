import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type CollectionId,
  findLevelAncestorId,
  type LevelNode,
  resolveBuildingForLevel,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Layers, Trash2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ColorDot } from './../../../../../components/ui/primitives/color-dot'
import { InlineRenameField } from './inline-rename-input'
import { TreeNode, TreeNodeWrapper } from './tree-node'

const ACTION_BUTTON_CLASS =
  'flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'

/**
 * The level the ids should be shown on, when they all sit on one level other
 * than the current one. The level tree only lists the current level, but a
 * collection spans the whole building.
 */
function levelSwitchFor(nodeIds: readonly AnyNodeId[], nodes: Record<AnyNodeId, AnyNode>) {
  const levelIds = new Set(nodeIds.map((id) => findLevelAncestorId(id, nodes)))
  if (levelIds.size !== 1) return null
  const [levelId] = levelIds as Set<LevelNode['id'] | null>
  if (!levelId || levelId === useViewer.getState().selection.levelId) return null
  const buildingId = resolveBuildingForLevel(levelId, nodes) as BuildingNode['id'] | null
  return buildingId ? { buildingId, levelId } : { levelId }
}

/** Members still in the scene; a collection can outlive some of its elements. */
function useLiveMembers(collectionId: CollectionId) {
  return useScene(
    useShallow((s) =>
      (s.collections[collectionId]?.nodeIds ?? []).filter((id) => s.nodes[id] !== undefined),
    ),
  )
}

/** Collections, listed under the level tree. Absent when the scene has none. */
export const CollectionsSection = memo(function CollectionsSection() {
  const collectionIds = useScene(useShallow((s) => Object.keys(s.collections) as CollectionId[]))
  const [expanded, setExpanded] = useState(true)

  if (collectionIds.length === 0) return null

  return (
    <div className="subtle-scrollbar max-h-72 shrink-0 overflow-y-auto overflow-x-hidden">
      <TreeNodeWrapper
        depth={1}
        expanded={expanded}
        hasChildren
        icon={<Layers className="h-3.5 w-3.5" />}
        label={
          <span className="flex items-center gap-1.5">
            Collections
            <span className="text-muted-foreground text-xs">{collectionIds.length}</span>
          </span>
        }
        onClick={() => setExpanded((value) => !value)}
        onToggle={() => setExpanded((value) => !value)}
      >
        {collectionIds.map((collectionId, index) => (
          <CollectionTreeNode
            collectionId={collectionId}
            depth={2}
            isLast={index === collectionIds.length - 1}
            key={collectionId}
          />
        ))}
      </TreeNodeWrapper>
    </div>
  )
})

interface CollectionTreeNodeProps {
  collectionId: CollectionId
  depth: number
  isLast?: boolean
}

/** One collection: click selects every member; expand lists them as tree rows. */
const CollectionTreeNode = memo(function CollectionTreeNode({
  collectionId,
  depth,
  isLast,
}: CollectionTreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const name = useScene((s) => s.collections[collectionId]?.name)
  const color = useScene((s) => s.collections[collectionId]?.color)
  const updateCollection = useScene((s) => s.updateCollection)
  const deleteCollection = useScene((s) => s.deleteCollection)
  const members = useLiveMembers(collectionId)
  const setSelection = useViewer((s) => s.setSelection)
  const isSelected = useViewer((s) => {
    const { selectedIds } = s.selection
    return (
      members.length > 0 &&
      selectedIds.length === members.length &&
      members.every((id) => selectedIds.includes(id))
    )
  })

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (members.length === 0) return
      const nodes = useScene.getState().nodes
      setSelection({ ...levelSwitchFor(members, nodes), selectedIds: members })
    },
    [members, setSelection],
  )

  // Members on another level: show that level first, as clicking them in the canvas would.
  const handleMemberClickCapture = useCallback(
    (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return
      const target = event.target as HTMLElement
      if (target.closest('button, input')) return
      const nodeId = target.closest('[data-treenode-id]')?.getAttribute('data-treenode-id')
      if (!nodeId) return
      const levelSwitch = levelSwitchFor([nodeId as AnyNodeId], useScene.getState().nodes)
      if (levelSwitch) setSelection(levelSwitch)
    },
    [setSelection],
  )

  const handleRename = useCallback(
    (next: string | undefined) => {
      if (next) updateCollection(collectionId, { name: next })
    },
    [collectionId, updateCollection],
  )

  return (
    <TreeNodeWrapper
      actions={
        <button
          className={ACTION_BUTTON_CLASS}
          onClick={(event) => {
            event.stopPropagation()
            deleteCollection(collectionId)
          }}
          title="Delete collection"
          type="button"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      }
      depth={depth}
      expanded={expanded}
      hasChildren={members.length > 0}
      icon={
        <ColorDot
          color={color ?? '#6366f1'}
          label="Collection colour"
          onChange={(next) => updateCollection(collectionId, { color: next })}
        />
      }
      isLast={isLast}
      isSelected={isSelected}
      keepIconColor
      label={
        <span className="flex min-w-0 items-center gap-1.5">
          <InlineRenameField
            defaultName="Collection"
            isEditing={isEditing}
            name={name}
            onRename={handleRename}
            onStartEditing={() => setIsEditing(true)}
            onStopEditing={() => setIsEditing(false)}
          />
          <span className="shrink-0 text-muted-foreground text-xs">{members.length}</span>
        </span>
      }
      onClick={handleClick}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div onClickCapture={handleMemberClickCapture}>
        {members.map((nodeId, index) => (
          <TreeNode
            depth={depth + 1}
            isLast={index === members.length - 1}
            key={nodeId}
            nodeId={nodeId}
          />
        ))}
      </div>
    </TreeNodeWrapper>
  )
})
