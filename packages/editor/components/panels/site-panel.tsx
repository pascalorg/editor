'use client'

import type { AnyNodeId } from '@pascal/core'
import type { SceneNode, SceneNodeHandle } from '@pascal/core/scenegraph'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { BuildingItem, LayersMenuContext } from '@/components/sidebar-menus'
import { TreeProvider, TreeView } from '@/components/tree'
import { type StoreState, useEditor } from '@/hooks/use-editor'

interface SitePanelProps {
  mounted: boolean
}

export function SitePanel({ mounted }: SitePanelProps) {
  const selectedFloorId = useEditor((state) => state.selectedFloorId)
  const selectFloor = useEditor((state) => state.selectFloor)
  const levelIds = useEditor(
    useShallow((state: StoreState) =>
      state.graph.nodes.find({ type: 'level' }).map((h: SceneNodeHandle) => h.id),
    ),
  )

  // Get the building IDs directly (children of sites) - skip site level
  const buildingIds = useEditor(
    useShallow((state: StoreState) => {
      const sites = state.scene.root.children || []
      const buildings: string[] = []
      for (const site of sites) {
        const siteHandle = state.graph.getNodeById(site.id as AnyNodeId)
        if (siteHandle) {
          for (const child of siteHandle.children()) {
            if (child.data().type === 'building') {
              buildings.push(child.id)
            }
          }
        }
      }
      return buildings
    }),
  )

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
          ancestors.forEach((id) => next.add(id))
          next.add(selectedFloorId)
          return Array.from(next)
        })
      }
    }
  }, [selectedFloorId])

  // Sync selected nodes with expanded state and scroll into view
  // Use subscribe to avoid re-rendering SitePanel on every selection change
  const prevSelectedNodeIdsRef = useRef<string[]>([])
  useEffect(() => {
    const unsubscribe = useEditor.subscribe((state) => {
      const selectedNodeIds = state.selectedNodeIds
      // Only process if selection actually changed
      if (
        selectedNodeIds.length === prevSelectedNodeIdsRef.current.length &&
        selectedNodeIds.every((id, i) => id === prevSelectedNodeIdsRef.current[i])
      ) {
        return
      }
      prevSelectedNodeIdsRef.current = selectedNodeIds

      const lastSelectedId = selectedNodeIds[selectedNodeIds.length - 1]

      if (lastSelectedId) {
        const graph = state.graph
        const handle = graph.getNodeById(lastSelectedId as AnyNodeId)

        if (handle) {
          const ancestors = new Set<string>()
          let curr = handle.parent()
          while (curr) {
            ancestors.add(curr.id)
            curr = curr.parent()
          }

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
            for (const id of ancestors) {
              next.add(id)
            }
            return Array.from(next)
          })

          setTimeout(() => {
            const element = document.querySelector(`[data-node-id="${lastSelectedId}"]`)
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }, 100)
        }
      }
    })
    return unsubscribe
  }, [])

  const handleNodeClick = useCallback(
    (nodeId: string, hasChildren: boolean) => {
      if (!hasChildren) return

      setExpandedIds((prev) => {
        const next = new Set(prev)

        if (next.has(nodeId)) {
          next.delete(nodeId)
          return Array.from(next)
        }

        next.add(nodeId)

        // Handle virtual nodes in Level
        if (nodeId.endsWith('-guides') || nodeId.endsWith('-scans')) {
          let levelId = ''
          if (nodeId.endsWith('-guides')) levelId = nodeId.slice(0, -7)
          else if (nodeId.endsWith('-scans')) levelId = nodeId.slice(0, -6)

          const siblings = [`${levelId}-guides`, `${levelId}-scans`]
          for (const siblingId of siblings) {
            if (siblingId !== nodeId) next.delete(siblingId)
          }
          return Array.from(next)
        }

        // Handle Buildings (Root level in UI) - close other buildings when opening one
        if (buildingIds.includes(nodeId)) {
          for (const id of buildingIds) {
            if (id !== nodeId) next.delete(id)
          }
        }

        // Handle Graph Nodes
        const graph = useEditor.getState().graph
        const handle = graph.getNodeById(nodeId as AnyNodeId)
        if (handle) {
          const parent = handle.parent()
          if (parent) {
            const siblings = parent.children()
            for (const sibling of siblings) {
              if (sibling.id !== nodeId) next.delete(sibling.id)
            }
          }
        }

        return Array.from(next)
      })
    },
    [buildingIds],
  )

  // Initialize expanded state - auto-expand first building
  const [initialized, setInitialized] = useState(false)
  useEffect(() => {
    if (!initialized && buildingIds.length > 0) {
      if (!expandedIds.some((id) => buildingIds.includes(id))) {
        setExpandedIds((prev) => [...prev, buildingIds[0]])
      }
      setInitialized(true)
    }
  }, [buildingIds, expandedIds, initialized])

  const handleTreeSelectionChange = useCallback(
    (selectedIds: string[]) => {
      const selectedId = selectedIds[0]
      const isLevel = levelIds.some((levelId: string) => levelId === selectedId)
      if (isLevel && selectedFloorId !== selectedId) selectFloor(selectedId)
    },
    [levelIds, selectedFloorId, selectFloor],
  )

  // Memoize context value to prevent re-renders of all children
  const layersMenuContextValue = useMemo(() => ({ handleNodeClick }), [handleNodeClick])

  if (!mounted) {
    return <div className="p-2 text-muted-foreground text-xs italic">Loading...</div>
  }

  return (
    <LayersMenuContext.Provider value={layersMenuContextValue}>
      <TreeProvider
        className="flex h-full min-h-0 flex-col overflow-y-auto"
        expandedIds={expandedIds}
        indent={16}
        multiSelect={false}
        onExpandedChange={setExpandedIds}
        onSelectionChange={handleTreeSelectionChange}
        selectedIds={selectedFloorId ? [selectedFloorId] : []}
        selectable={false}
        showLines={true}
      >
        <TreeView className="px-3 py-1">
          {/* Render buildings directly at level 0 (left edge) */}
          {buildingIds.map((buildingId, index) => (
            <BuildingItem
              key={buildingId}
              level={0}
              nodeId={buildingId}
            />
          ))}
        </TreeView>
      </TreeProvider>
    </LayersMenuContext.Provider>
  )
}
