'use client'

import { AnimatePresence, motion } from 'motion/react'
import { TooltipProvider } from './../../../components/ui/primitives/tooltip'
import { useReducedMotion } from './../../../hooks/use-reduced-motion'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { ItemCatalog } from '../item-catalog/item-catalog'
import { CameraActions } from './camera-actions'
import { ControlModes } from './control-modes'
import { FurnishTools } from './furnish-tools'
import { StructureTools } from './structure-tools'
import { ViewToggles } from './view-toggles'

export function ActionMenu({ className }: { className?: string }) {
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const reducedMotion = useReducedMotion()
  const transition = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, bounce: 0.2, duration: 0.4 }

  return (
    <TooltipProvider>
      <motion.div
        className={cn(
          'fixed bottom-6 left-1/2 z-50 -translate-x-1/2',
          'rounded-2xl border border-border bg-background/90 shadow-2xl backdrop-blur-md',
          'transition-colors duration-200 ease-out',
          className,
        )}
        layout
        transition={transition}
      >
        {/* Item Catalog Row - Only show when in build mode with item tool */}
        <AnimatePresence>
          {mode === 'build' && tool === 'item' && catalogCategory && (
            <motion.div
              animate={{
                opacity: 1,
                maxHeight: 160,
                paddingTop: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
              }}
              className={cn('overflow-hidden border-border border-b px-2 py-2')}
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
              <ItemCatalog category={catalogCategory} key={catalogCategory} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase === 'furnish' && mode === 'build' && (
            <motion.div
              animate={{
                opacity: 1,
                maxHeight: 80,
                paddingTop: 8,
                paddingBottom: 8,
                borderBottomWidth: 1,
              }}
              className={cn(
                'overflow-hidden border-border',
                'max-h-20 border-b px-2 py-2 opacity-100',
              )}
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
              <div className="mx-auto w-max">
                <FurnishTools />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Structure Tools Row - Animated */}
        <AnimatePresence>
          {phase === 'structure' && mode === 'build' && (
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
        {/* Control Mode Row - Always visible, centered */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          <ControlModes />
          <div className="mx-1 h-5 w-px bg-border" />
          <ViewToggles />
          <div className="mx-1 h-5 w-px bg-border" />
          <CameraActions />
        </div>
      </motion.div>
    </TooltipProvider>
  )
}
