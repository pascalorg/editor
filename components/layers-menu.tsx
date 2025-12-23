'use client'

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { EnvironmentItem } from '@/components/nodes/environment/environment-item'
import {
  ZonesSection,
  LayersMenuContext,
  SiteItem,
  ViewsSection,
} from '@/components/sidebar-menus'
import { TreeProvider, TreeView } from '@/components/tree'
import { type EditorMode, type StoreState, useEditor } from '@/hooks/use-editor'
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
  const editorMode = useEditor((state) => state.editorMode)
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

    const isLevel = levelIds.some((levelId: string) => levelId === selectedId)
    if (isLevel && selectedFloorId !== selectedId) selectFloor(selectedId)
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
                    <SiteItem
                      editorMode={editorMode}
                      isLast={true}
                      key={siteId}
                      level={1}
                      nodeId={siteId}
                    />
                  </TreeView>
                </div>
              </div>
            ))}

            {/* Zones Section - Hidden in Site mode */}
            {editorMode !== 'site' && (
              <div
                className={cn(
                  'flex flex-col border-t bg-background px-2 transition-all duration-300 ease-in-out',
                  expandedIds.includes('zones-section')
                    ? 'min-h-0 flex-1'
                    : 'flex-none shrink-0',
                )}
              >
                <div
                  className={cn(
                    'flex-1',
                    expandedIds.includes('zones-section')
                      ? 'overflow-y-auto'
                      : 'overflow-hidden',
                  )}
                >
                  <TreeView className="p-0">
                    <ZonesSection isLast={true} level={1} onNodeClick={handleNodeClick} />
                  </TreeView>
                </div>
              </div>
            )}

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
