'use client'

import { useEffect, useState } from 'react'
import { ItemCatalog } from '@/components/item-catalog'
import { MaterialCatalog } from '@/components/material-catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { type CatalogCategory, useEditor } from '@/hooks/use-editor'
import { cn } from '@/lib/utils'
import { ControlModes } from './control-modes'
import { FurnishTools } from './furnish-tools'
import { ModeSwitcher } from './mode-switcher'
import { StructureTools } from './structure-tools'
import { ViewToggles } from './view-toggles'

export function ActionMenu({ className }: { className?: string }) {
  const controlMode = useEditor((state) => state.controlMode)
  const editorMode = useEditor((state) => state.editorMode)
  const catalogCategory = useEditor((state) => state.catalogCategory)

  // Show tools based on editor mode when in build/building mode
  // Site mode has no tool row - select/edit are control modes
  const isInBuildMode = controlMode === 'building' || controlMode === 'build'
  const showStructureTools = editorMode === 'structure' && isInBuildMode
  const showFurnishTools = editorMode === 'furnish' && isInBuildMode
  const showPaintingTools = controlMode === 'painting'

  // Delayed state for structure tools exit animation
  const [shouldRenderStructureTools, setShouldRenderStructureTools] = useState(showStructureTools)
  const [isStructureToolsVisible, setIsStructureToolsVisible] = useState(showStructureTools)

  // Delayed state for furnish tools exit animation
  const [shouldRenderFurnishTools, setShouldRenderFurnishTools] = useState(showFurnishTools)
  const [isFurnishToolsVisible, setIsFurnishToolsVisible] = useState(showFurnishTools)

  // Delayed state for material catalog exit animation
  const [shouldRenderMaterialCatalog, setShouldRenderMaterialCatalog] = useState(showPaintingTools)
  const [isMaterialCatalogVisible, setIsMaterialCatalogVisible] = useState(showPaintingTools)

  // Delayed state for item catalog exit animation
  const [shouldRenderCatalog, setShouldRenderCatalog] = useState(catalogCategory !== null)
  const [isCatalogVisible, setIsCatalogVisible] = useState(catalogCategory !== null)
  const [currentCategory, setCurrentCategory] = useState<CatalogCategory | null>(catalogCategory)

  // Structure tools animation
  useEffect(() => {
    if (showStructureTools) {
      setShouldRenderStructureTools(true)
      requestAnimationFrame(() => setIsStructureToolsVisible(true))
    } else {
      setIsStructureToolsVisible(false)
      const timeout = setTimeout(() => setShouldRenderStructureTools(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showStructureTools])

  // Furnish tools animation
  useEffect(() => {
    if (showFurnishTools) {
      setShouldRenderFurnishTools(true)
      requestAnimationFrame(() => setIsFurnishToolsVisible(true))
    } else {
      setIsFurnishToolsVisible(false)
      const timeout = setTimeout(() => setShouldRenderFurnishTools(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showFurnishTools])

  // Item catalog animation
  useEffect(() => {
    if (catalogCategory) {
      setCurrentCategory(catalogCategory)
      setShouldRenderCatalog(true)
      requestAnimationFrame(() => setIsCatalogVisible(true))
    } else {
      setIsCatalogVisible(false)
      const timeout = setTimeout(() => {
        setShouldRenderCatalog(false)
        setCurrentCategory(null)
      }, 200)
      return () => clearTimeout(timeout)
    }
  }, [catalogCategory])

  // Material catalog animation
  useEffect(() => {
    if (showPaintingTools) {
      setShouldRenderMaterialCatalog(true)
      requestAnimationFrame(() => setIsMaterialCatalogVisible(true))
    } else {
      setIsMaterialCatalogVisible(false)
      const timeout = setTimeout(() => setShouldRenderMaterialCatalog(false), 200)
      return () => clearTimeout(timeout)
    }
  }, [showPaintingTools])

  return (
    <TooltipProvider>
      <div
        className={cn(
          '-translate-x-1/2 fixed bottom-6 left-1/2 z-50',
          'rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md',
          'transition-all duration-200 ease-out',
          className,
        )}
      >
        {/* Item Catalog Row - Animated */}
        {shouldRenderCatalog && currentCategory && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isCatalogVisible
                ? 'max-h-96 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <ItemCatalog category={currentCategory} />
          </div>
        )}

        {/* Structure Tools Row - Animated */}
        {shouldRenderStructureTools && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isStructureToolsVisible
                ? 'max-h-20 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <div className="w-max">
              <StructureTools />
            </div>
          </div>
        )}

        {/* Furnish Tools Row - Animated */}
        {shouldRenderFurnishTools && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isFurnishToolsVisible
                ? 'max-h-20 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <div className="mx-auto w-max">
              <FurnishTools />
            </div>
          </div>
        )}

        {/* Material Catalog Row - Animated, for painting mode */}
        {shouldRenderMaterialCatalog && (
          <div
            className={cn(
              'overflow-hidden border-zinc-800 transition-all duration-200 ease-out',
              isMaterialCatalogVisible
                ? 'max-h-96 border-b px-2 py-2 opacity-100'
                : 'max-h-0 border-b-0 px-2 py-0 opacity-0',
            )}
          >
            <MaterialCatalog />
          </div>
        )}

        {/* Control Mode Row - Always visible, centered */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          <ControlModes />
          <div className="mx-1 h-5 w-px bg-zinc-700" />
          <ViewToggles />
          <div className="mx-1 h-5 w-px bg-zinc-700" />
          <ModeSwitcher />
        </div>
      </div>
    </TooltipProvider>
  )
}
