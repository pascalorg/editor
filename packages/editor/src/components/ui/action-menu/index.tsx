'use client'

import { useViewer } from '@pascal-app/viewer'
import { motion } from 'motion/react'
import { TooltipProvider } from './../../../components/ui/primitives/tooltip'
import { useIsMobile } from './../../../hooks/use-mobile'
import { useReducedMotion } from './../../../hooks/use-reduced-motion'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { CameraActions } from './camera-actions'
import { ControlModes } from './control-modes'
import { SecondaryToggles } from './view-toggles'

// Mobile bottom offset matches the viewer's overlap behind the sheet's
// rounded corners (SHEET_OVERLAP_PX in editor-layout-mobile) so the menu sits
// just above that strip instead of inside it.
const MOBILE_BOTTOM_OFFSET = 24

export function ActionMenu({ className }: { className?: string }) {
  const isMobile = useIsMobile()
  const hasSelectionOnMobile = useViewer((s) => isMobile && s.selection.selectedIds.length > 0)
  const hasReferenceOnMobile = useEditor((s) => isMobile && Boolean(s.selectedReferenceId))
  const CONTEXTUAL_TABS = new Set(['ai', 'items', 'studio'])
  const isContextualPanelOnMobile = useEditor(
    (s) => isMobile && CONTEXTUAL_TABS.has(s.activeSidebarPanel),
  )
  const reducedMotion = useReducedMotion()

  // On mobile, defer the bottom rail to the selection bar when something
  // is selected — the contextual actions take priority over mode controls.
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
          'rounded-2xl border border-border bg-background/90 shadow-2xl backdrop-blur-md',
          'transition-colors duration-200 ease-out',
          className,
        )}
        layout
        style={isMobile ? { bottom: MOBILE_BOTTOM_OFFSET } : undefined}
        transition={transition}
      >
        {isMobile ? (
          <div className="flex flex-col items-stretch gap-0.5 px-2 py-1.5">
            {/* Row 1: control modes only */}
            <div className="flex items-center justify-center gap-1">
              <ControlModes />
            </div>
            {/* Row 2: secondary toggles (orbit + top view hidden) */}
            <div className="flex items-center justify-center gap-1 border-border/50 border-t pt-1">
              <SecondaryToggles />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-1 px-2 py-1.5">
            <ControlModes />
            <div className="mx-1 h-5 w-px bg-border" />
            <SecondaryToggles />
            <div className="mx-1 h-5 w-px bg-border" />
            <CameraActions />
          </div>
        )}
      </motion.div>
    </TooltipProvider>
  )
}
