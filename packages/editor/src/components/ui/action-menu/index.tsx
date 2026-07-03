'use client'

import { type AnyNodeId, type MaterialSchema, useScene } from '@pascal-app/core'
import useViewer from '@pascal-app/viewer/store'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo } from 'react'
import { MaterialPicker } from './../../../components/ui/controls/material-picker'
import { TooltipProvider } from './../../../components/ui/primitives/tooltip'
import { useIsMobile } from './../../../hooks/use-mobile'
import { useReducedMotion } from './../../../hooks/use-reduced-motion'
import {
  buildRoofSurfaceMaterialPatch,
  buildSingleSurfaceMaterialPatch,
  buildStairSurfaceMaterialPatch,
  buildWallSurfaceMaterialPatch,
  resolvePaintTargetFromSelection,
} from './../../../lib/material-paint'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { CameraActions } from './camera-actions'
import { ControlModes } from './control-modes'
import { StructureTools } from './structure-tools'
import { GridSnapControl, SecondaryToggles } from './view-toggles'

// Mobile bottom offset matches the viewer's overlap behind the sheet's
// rounded corners (SHEET_OVERLAP_PX in editor-layout-mobile) so the menu sits
// just above that strip instead of inside it.
const MOBILE_BOTTOM_OFFSET = 24

function PaintMaterialTray() {
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const selectedMaterialTarget = useEditor((state) => state.selectedMaterialTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const updateNode = useScene((state) => state.updateNode)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null

  useEffect(() => {
    const selectedPaintTarget = resolvePaintTargetFromSelection({
      nodes,
      selectedId,
    })

    if (selectedPaintTarget) {
      setActivePaintTarget(selectedPaintTarget)
    }
  }, [nodes, selectedId, setActivePaintTarget])

  const applyToSelectedNode = (material?: MaterialSchema, materialPreset?: string) => {
    if (!(material || materialPreset)) return
    if (!selectedId) return
    const node = nodes[selectedId as AnyNodeId]
    if (!node) return
    const selectedNodeId = selectedId as AnyNodeId
    const markSelectedNodeDirty = () => useScene.getState().markDirty(selectedNodeId)
    const target = selectedMaterialTarget

    if (node.type === 'wall') {
      if (
        target?.nodeId === selectedId &&
        (target.role === 'interior' || target.role === 'exterior')
      ) {
        updateNode(
          selectedNodeId,
          buildWallSurfaceMaterialPatch(node, target.role, material, materialPreset),
        )
        markSelectedNodeDirty()
        return
      }

      updateNode(selectedNodeId, {
        interiorMaterial: material,
        interiorMaterialPreset: materialPreset,
        exteriorMaterial: material,
        exteriorMaterialPreset: materialPreset,
        material: undefined,
        materialPreset: undefined,
      })
      markSelectedNodeDirty()
      return
    }

    if (
      node.type === 'roof' &&
      target?.nodeId === selectedId &&
      (target.role === 'top' || target.role === 'edge' || target.role === 'wall')
    ) {
      updateNode(
        selectedNodeId,
        buildRoofSurfaceMaterialPatch(node, target.role, material, materialPreset),
      )
      markSelectedNodeDirty()
      return
    }

    if (
      node.type === 'stair' &&
      target?.nodeId === selectedId &&
      (target.role === 'railing' || target.role === 'tread' || target.role === 'side')
    ) {
      updateNode(
        selectedNodeId,
        buildStairSurfaceMaterialPatch(node, target.role, material, materialPreset),
      )
      markSelectedNodeDirty()
      return
    }

    if (target?.nodeId === selectedId && target.role === 'surface') {
      updateNode(selectedNodeId, buildSingleSurfaceMaterialPatch(material, materialPreset))
      markSelectedNodeDirty()
      console.log('[pascal:material-tray:write]', {
        nodeId: selectedNodeId,
        nodeType: node.type,
        target: target.role,
        materialColor: material?.properties?.color,
        materialProperties: material?.properties,
        materialPreset,
      })
    }
  }

  return (
    <div className="w-[42rem] max-w-[calc(100vw-2rem)]">
      <MaterialPicker
        onChange={(material) => {
          setActivePaintMaterial({ material, sourceTarget: activePaintTarget })
          applyToSelectedNode(material, undefined)
        }}
        onSelectMaterialPreset={(materialPreset) => {
          setActivePaintMaterial({ materialPreset, sourceTarget: activePaintTarget })
          applyToSelectedNode(undefined, materialPreset)
        }}
        selectedMaterialPreset={activePaintMaterial?.materialPreset}
        value={activePaintMaterial?.material}
      />
    </div>
  )
}

export function ActionMenu({ className }: { className?: string }) {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const isMobile = useIsMobile()
  const hasSelectionOnMobile = useViewer((s) => isMobile && s.selection.selectedIds.length > 0)
  const hasReferenceOnMobile = useEditor((s) => isMobile && Boolean(s.selectedReferenceId))
  const CONTEXTUAL_TABS = new Set(['ai', 'items', 'studio'])
  const isContextualPanelOnMobile = useEditor(
    (s) => isMobile && CONTEXTUAL_TABS.has(s.activeSidebarPanel),
  )
  const reducedMotion = useReducedMotion()
  const showPaintTray = useMemo(() => mode === 'material-paint', [mode])

  // On mobile, defer the bottom rail to the selection bar when something
  // is selected; the contextual actions take priority over mode controls.
  // Also hide on Chat / Items / Studio tabs; those are contextual workflows
  // (composing / picking furniture / generating renders) where the build
  // menu is irrelevant.
  if (hasSelectionOnMobile || hasReferenceOnMobile || isContextualPanelOnMobile) return null

  const transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, bounce: 0.2, duration: 0.4 }

  return (
    <TooltipProvider>
      <motion.div
        className={cn(
          'left-1/2 z-50 -translate-x-1/2',
          isMobile ? 'absolute origin-bottom scale-90' : 'fixed bottom-6',
          'rounded-2xl border border-white/10 shadow-2xl',
          'transition-colors duration-200 ease-out',
          className,
        )}
        layout
        style={{
          ...(isMobile ? { bottom: MOBILE_BOTTOM_OFFSET } : undefined),
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
        }}
        transition={transition}
      >
        {/* Structure Tools Row - Animated */}
        <AnimatePresence>
          {phase === 'structure' && mode === 'build' && structureLayer !== 'zones' && (
            <motion.div
              animate={{
                opacity: 1,
                maxHeight: 80,
                paddingTop: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
              }}
              className={cn('max-h-20 overflow-hidden border-border border-b px-2 py-2')}
              exit={{
                opacity: 0,
                maxHeight: 0,
                paddingTop: 0,
                paddingBottom: 0,
                borderBottomWidth: 0,
              }}
              initial={{
                opacity: 0,
                maxHeight: 0,
                paddingTop: 0,
                paddingBottom: 0,
                borderBottomWidth: 0,
              }}
              transition={transition}
            >
              <div className="w-max">
                <StructureTools />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showPaintTray && (
            <motion.div
              animate={{
                opacity: 1,
                maxHeight: 96,
                paddingTop: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
              }}
              className={cn('overflow-hidden border-border border-b px-3')}
              exit={{
                opacity: 0,
                maxHeight: 0,
                paddingTop: 0,
                paddingBottom: 0,
                borderBottomWidth: 0,
              }}
              initial={{
                opacity: 0,
                maxHeight: 0,
                paddingTop: 0,
                paddingBottom: 0,
                borderBottomWidth: 0,
              }}
              transition={transition}
            >
              <PaintMaterialTray />
            </motion.div>
          )}
        </AnimatePresence>

        {isMobile ? (
          <div className="flex flex-col items-stretch gap-0.5 px-2 py-1.5">
            {/* Row 1: control modes only */}
            <div className="flex items-center justify-center gap-1">
              <ControlModes />
            </div>
            {/* Row 2: grid snap + secondary toggles (orbit + top view hidden) */}
            <div className="flex items-center justify-center gap-1 border-border/50 border-t pt-1">
              <GridSnapControl />
              <SecondaryToggles />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 px-2 py-1.5">
            <ControlModes />
            <div className="mx-1 h-5 w-px bg-border" />
            <GridSnapControl />
            <SecondaryToggles />
            <div className="mx-1 h-5 w-px bg-border" />
            <CameraActions />
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  )
}
