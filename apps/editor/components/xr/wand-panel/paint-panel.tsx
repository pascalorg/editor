'use client'

import {
  getLibraryMaterialIdFromRef,
  getLibraryMaterialsVersion,
  getMaterialsForCategory,
  MATERIAL_CATEGORIES,
  type MaterialCatalogItem,
  type MaterialCategory,
  subscribeLibraryMaterials,
  toLibraryMaterialRef,
} from '@pascal-app/core'
import { getActivePaintMaterialLabel, useEditor } from '@pascal-app/editor'
import { useMemo, useState, useSyncExternalStore } from 'react'
import { activatePaintMode } from '@/lib/build-palette'
import { PanelIcon } from './panel-icon'
import { getPage } from './panel-layout'
import { PanelHeader, SpatialButton } from './spatial-controls'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

const MATERIALS_PER_PAGE = 6

function labelCategory(category: string) {
  return `${category.charAt(0).toUpperCase()}${category.slice(1)}`
}

function materialPosition(index: number): [number, number, number] {
  return [-0.255 + (index % 3) * 0.255, 0.14 - Math.floor(index / 3) * 0.255, 0]
}

function MaterialTile({
  item,
  index,
  selected,
  select,
}: {
  item: MaterialCatalogItem
  index: number
  selected: boolean
  select: () => void
}) {
  return (
    <SpatialButton
      onClick={select}
      position={materialPosition(index)}
      selected={selected}
      size={[0.215, 0.225]}
    >
      <PanelIcon
        color={item.previewColor ?? item.preset.mapProperties.color}
        size={0.13}
        src={item.previewThumbnailUrl}
      />
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={XR_WAND_THEME.text}
        fontSize={0.018}
        maxWidth={0.19}
        position={[0, -0.082, 0.012]}
        textAlign="center"
      >
        {item.label}
      </SpatialText>
    </SpatialButton>
  )
}

export function XRPaintPanel() {
  const [categoryIndex, setCategoryIndex] = useState(0)
  const [page, setPage] = useState(0)
  const mode = useEditor((state) => state.mode)
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const paintEraser = useEditor((state) => state.paintEraser)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  const libraryVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )

  const availableCategories = useMemo(() => {
    void libraryVersion
    return MATERIAL_CATEGORIES.filter((category) => getMaterialsForCategory(category).length > 0)
  }, [libraryVersion])
  const category = (availableCategories[categoryIndex] ??
    availableCategories[0] ??
    'colors') as MaterialCategory
  const materials = getMaterialsForCategory(category)
  const current = getPage(materials, page, MATERIALS_PER_PAGE)
  const selectedId = getLibraryMaterialIdFromRef(activePaintMaterial?.materialPreset)

  const changeCategory = (direction: -1 | 1) => {
    const next =
      (categoryIndex + direction + availableCategories.length) % availableCategories.length
    setCategoryIndex(next)
    setPage(0)
  }

  return (
    <group name="xr-wand-paint-panel">
      <PanelHeader mark={mode === 'material-paint' ? activePaintTarget : 'ready'} title="Paint" />
      <group position={[0, 0.345, 0]}>
        <SpatialButton
          onClick={() => changeCategory(-1)}
          position={[-0.31, 0, 0]}
          size={[0.075, 0.06]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.027}
            position={[0, 0, 0.012]}
          >
            ‹
          </SpatialText>
        </SpatialButton>
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.text}
          fontSize={0.023}
          position={[0, 0, 0.012]}
        >
          {labelCategory(category)} · {categoryIndex + 1}/{availableCategories.length}
        </SpatialText>
        <SpatialButton
          onClick={() => changeCategory(1)}
          position={[0.31, 0, 0]}
          size={[0.075, 0.06]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.027}
            position={[0, 0, 0.012]}
          >
            ›
          </SpatialText>
        </SpatialButton>
      </group>
      <group position={[0, 0.275, 0]}>
        <SpatialButton
          onClick={activatePaintMode}
          position={[-0.17, 0, 0]}
          selected={mode === 'material-paint'}
          size={[0.3, 0.055]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.019}
            position={[0, 0, 0.012]}
          >
            {mode === 'material-paint' ? 'Brush armed' : 'Start painting'}
          </SpatialText>
        </SpatialButton>
        <SpatialButton
          onClick={() => {
            activatePaintMode()
            setPaintEraser(!paintEraser)
          }}
          position={[0.22, 0, 0]}
          selected={paintEraser}
          size={[0.22, 0.055]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.019}
            position={[0, 0, 0.012]}
          >
            Eraser
          </SpatialText>
        </SpatialButton>
      </group>
      {current.items.map((item, index) => (
        <MaterialTile
          index={index}
          item={item}
          key={item.id}
          select={() => {
            activatePaintMode()
            setActivePaintMaterial({
              materialPreset: toLibraryMaterialRef(item.id),
              sourceTarget: activePaintTarget,
            })
          }}
          selected={selectedId === item.id}
        />
      ))}
      <group position={[0, -0.35, 0]}>
        <SpatialButton
          disabled={current.currentPage === 0}
          onClick={() => setPage(current.currentPage - 1)}
          position={[-0.28, 0, 0]}
          size={[0.075, 0.055]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.027}
            position={[0, 0, 0.012]}
          >
            ‹
          </SpatialText>
        </SpatialButton>
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.muted}
          fontSize={0.018}
          maxWidth={0.42}
          position={[0, 0, 0.012]}
          textAlign="center"
        >
          {getActivePaintMaterialLabel(activePaintMaterial)} · {current.currentPage + 1}/
          {current.pageCount}
        </SpatialText>
        <SpatialButton
          disabled={current.currentPage >= current.pageCount - 1}
          onClick={() => setPage(current.currentPage + 1)}
          position={[0.28, 0, 0]}
          size={[0.075, 0.055]}
        >
          <SpatialText
            anchorX="center"
            anchorY="middle"
            color={XR_WAND_THEME.text}
            fontSize={0.027}
            position={[0, 0, 0.012]}
          >
            ›
          </SpatialText>
        </SpatialButton>
      </group>
    </group>
  )
}
