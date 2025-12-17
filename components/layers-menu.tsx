'use client'

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { EnvironmentItem } from '@/components/nodes/environment/environment-item'
import {
  CollectionsSection,
  LayersMenuContext,
  SiteItem,
  ViewsSection,
} from '@/components/sidebar-menus'
import { TreeProvider, TreeView } from '@/components/tree'
import { type StoreState, useEditor } from '@/hooks/use-editor'
import type { SceneNode, SceneNodeHandle } from '@/lib/scenegraph/index'
import type { AnyNodeId } from '@/lib/scenegraph/schema/types'
import { cn } from '@/lib/utils'

interface LayersMenuProps {
  mounted: boolean
}

export function LayersMenu({ mounted }: LayersMenuProps) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectedNodeIds = useEditor((state) => state.selectedNodeIds)
  const selectFloor = useEditor((state) => state.selectFloor)
  const levelIds = useEditor(
    useShallow((state: StoreState) => {
      // Helper to find level IDs for expansion logic
      // Use graph traversal
      return state.graph.nodes.find({ type: 'level' }).map((h: SceneNodeHandle) => h.id)
    }),
  )

  // Get Site IDs
  const siteIds = useEditor(
    useShallow((state: StoreState) => state.scene.root.children?.map((c: SceneNode) => c.id) || []),
  )

  // Track expanded state
  const [expandedIds, setExpandedIds] = useState<string[]>([])

  // Sync selection with expanded state
  useEffect(() => {
    if (selectedFloorId) {
      const graph = useEditor.getState().graph
      const handle = graph.getNodeById(selectedFloorId as AnyNodeId)
      if (handle) {
        const ancestors = new Set<string>()
        let curr = handle.parent()
        while (curr) {
          ancestors.add(curr.id)
          curr = curr.parent()
        }

        setExpandedIds((prev) => {
          const next = new Set(prev)
          ancestors.forEach((id) => {
            next.add(id)
          })
          next.add(selectedFloorId)
          return Array.from(next)
        })
      }
    }
  }, [selectedFloorId])

  // Sync selected nodes with expanded state and scroll into view
  useEffect(() => {
    const lastSelectedId = selectedNodeIds[selectedNodeIds.length - 1]

    if (lastSelectedId) {
      const graph = useEditor.getState().graph
      const handle = graph.getNodeById(lastSelectedId as AnyNodeId)

      if (handle) {
        const ancestors = new Set<string>()
        let curr = handle.parent()
        while (curr) {
          ancestors.add(curr.id)
          curr = curr.parent()
        }

        // Handle virtual parents in UI (Guides & Scans folders)
        const data = handle.data()
        const parent = handle.parent()
        if (parent && parent.data().type === 'level') {
          if (data.type === 'reference-image') {
            ancestors.add(`${parent.id}-guides`)
          } else if (data.type === 'scan') {
            ancestors.add(`${parent.id}-scans`)
          }
        }

        setExpandedIds((prev) => {
          const next = new Set(prev)
          ancestors.forEach((id) => {
            next.add(id)
          })
          return Array.from(next)
        })

        // Scroll into view after expansion
        // Use a timeout to allow the expansion animation/render to start
        setTimeout(() => {
          const element = document.querySelector(`[data-node-id="${lastSelectedId}"]`)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 100)
      }
    }
  }, [selectedNodeIds])

  // Handle node click for "accordion" behavior
  const handleNodeClick = (nodeId: string, hasChildren: boolean) => {
    if (!hasChildren) return

    setExpandedIds((prev) => {
      const next = new Set(prev)

      // Toggle current node
      if (next.has(nodeId)) {
        next.delete(nodeId)
        return Array.from(next)
      }

      next.add(nodeId)

      // Handle virtual nodes in Level
      if (nodeId.endsWith('-guides') || nodeId.endsWith('-scans')) {
        // Extract level ID by removing the suffix
        // Note: scan IDs might contain dashes, but the suffix is known
        let levelId = ''
        if (nodeId.endsWith('-guides')) levelId = nodeId.slice(0, -7)
        else if (nodeId.endsWith('-scans')) levelId = nodeId.slice(0, -6)

        const siblings = [`${levelId}-guides`, `${levelId}-scans`]
        siblings.forEach((siblingId) => {
          if (siblingId !== nodeId) {
            next.delete(siblingId)
          }
        })
        return Array.from(next)
      }

      // Handle Environment vs Sites (Root level)
      if (nodeId === 'environment') {
        siteIds.forEach((id) => {
          next.delete(id)
        })
        return Array.from(next)
      }
      if (siteIds.includes(nodeId as AnyNodeId)) {
        next.delete('environment')
        siteIds.forEach((id) => {
          if (id !== nodeId) next.delete(id)
        })
        // Continue to graph check for children of this site?
        // Site siblings handled here.
      }

      // Handle Graph Nodes
      const graph = useEditor.getState().graph
      const handle = graph.getNodeById(nodeId as AnyNodeId)
      if (handle) {
        const parent = handle.parent()
        if (parent) {
          const siblings = parent.children()
          siblings.forEach((sibling: SceneNodeHandle) => {
            if (sibling.id !== nodeId) {
              next.delete(sibling.id)
            }
          })
        }
      }

      return Array.from(next)
    })
  }

  // Initialize expanded state
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    // Auto expand first site
    if (!initialized && siteIds.length > 0) {
      if (!expandedIds.some((id) => siteIds.includes(id as AnyNodeId))) {
        setExpandedIds((prev) => [...prev, siteIds[0]])
      }
      setInitialized(true)
    }
  }, [siteIds, expandedIds, initialized])

  const handleTreeSelectionChange = (selectedIds: string[]) => {
    const selectedId = selectedIds[0]

    // Deselect if no node is selected (e.g. clicking the active level again)
    if (!selectedId) {
      if (selectedFloorId) selectFloor(null)
      return
    }

    const isLevel = levelIds.some((levelId: string) => levelId === selectedId)
    if (isLevel) {
      if (selectedFloorId !== selectedId) selectFloor(selectedId)
    } else {
      // Check if the selected node is a child of a level
      const getLevelId = useEditor.getState().getLevelId
      const parentLevelId = getLevelId(selectedId)

      // If not a child of a level (e.g. Building, Site), unselect the level
      if (!parentLevelId && selectedFloorId) {
        selectFloor(null)
      }
    }
  }

  return (
    <LayersMenuContext.Provider value={{ handleNodeClick }}>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between px-2 pt-2 pb-1">
          <label className="font-medium text-muted-foreground text-sm">Layers</label>
        </div>

        {mounted ? (
          <TreeProvider
            className="flex h-full min-h-0 flex-col"
            expandedIds={expandedIds}
            indent={16}
            multiSelect={false}
            onExpandedChange={setExpandedIds}
            onSelectionChange={handleTreeSelectionChange}
            selectedIds={selectedFloorId ? [selectedFloorId] : []}
            showLines={true}
          >
            {/* Environment Section */}
            <div
              className={cn(
                'flex flex-col border-b bg-background px-2 transition-all duration-300 ease-in-out',
                expandedIds.includes('environment') ? 'min-h-0 flex-1' : 'flex-none shrink-0',
              )}
            >
              <div
                className={cn(
                  'flex-1',
                  expandedIds.includes('environment') ? 'overflow-y-auto' : 'overflow-hidden',
                )}
              >
                <TreeView className="p-0">
                  <EnvironmentItem level={1} onNodeClick={handleNodeClick} />
                </TreeView>
              </div>
            </div>

            {/* Site Sections */}
            {siteIds.map((siteId) => (
              <div
                className={cn(
                  'flex flex-col border-b bg-background px-2 transition-all duration-300 ease-in-out',
                  expandedIds.includes(siteId) ? 'min-h-0 flex-1' : 'flex-none shrink-0',
                )}
                key={siteId}
              >
                <div
                  className={cn(
                    'flex-1',
                    expandedIds.includes(siteId) ? 'overflow-y-auto' : 'overflow-hidden',
                  )}
                >
                  <TreeView className="p-0">
                    <SiteItem isLast={true} key={siteId} level={1} nodeId={siteId} />
                  </TreeView>
                </div>
              </div>
            ))}

            {/* Collections Section */}
            <div
              className={cn(
                'flex flex-col border-t bg-background px-2 transition-all duration-300 ease-in-out',
                expandedIds.includes('collections-section')
                  ? 'min-h-0 flex-1'
                  : 'flex-none shrink-0',
              )}
            >
              <div
                className={cn(
                  'flex-1',
                  expandedIds.includes('collections-section')
                    ? 'overflow-y-auto'
                    : 'overflow-hidden',
                )}
              >
                <TreeView className="p-0">
                  <CollectionsSection isLast={true} level={1} onNodeClick={handleNodeClick} />
                </TreeView>
              </div>
            </div>

            {/* Views Section */}
            <div
              className={cn(
                'flex flex-col border-t bg-background px-2 pb-2 transition-all duration-300 ease-in-out',
                expandedIds.includes('views-section') ? 'min-h-0 flex-1' : 'flex-none shrink-0',
              )}
            >
              <div
                className={cn(
                  'flex-1',
                  expandedIds.includes('views-section') ? 'overflow-y-auto' : 'overflow-hidden',
                )}
              >
                <TreeView className="p-0">
                  <ViewsSection isLast={true} level={1} onNodeClick={handleNodeClick} />
                </TreeView>
              </div>
            </div>
          </TreeProvider>
        ) : (
          <div className="p-2 text-muted-foreground text-xs italic">Loading...</div>
        )}
      </div>
    </LayersMenuContext.Provider>
  )
}
