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
import { SpatialLine } from './spatial-line'
import { SpatialText } from './spatial-text'
import { XR_WAND_THEME } from './theme'

const MATERIALS_PER_PAGE = 6
const MATERIAL_TILE_SIZE: [number, number] = [0.215, 0.205]
const MATERIAL_PREVIEW_SIZE = 0.116
const MATERIAL_GRID_TOP = 0.135
const MATERIAL_GRID_ROW_GAP = 0.25
const MATERIAL_PREVIEW_FRAME = MATERIAL_PREVIEW_SIZE / 2

const MATERIAL_PREVIEW_FRAME_POINTS: [number, number, number][] = [
  [-MATERIAL_PREVIEW_FRAME, -MATERIAL_PREVIEW_FRAME + 0.022, 0.014],
  [MATERIAL_PREVIEW_FRAME, -MATERIAL_PREVIEW_FRAME + 0.022, 0.014],
  [MATERIAL_PREVIEW_FRAME, MATERIAL_PREVIEW_FRAME + 0.022, 0.014],
  [-MATERIAL_PREVIEW_FRAME, MATERIAL_PREVIEW_FRAME + 0.022, 0.014],
  [-MATERIAL_PREVIEW_FRAME, -MATERIAL_PREVIEW_FRAME + 0.022, 0.014],
]

function labelCategory(category: string) {
  return `${category.charAt(0).toUpperCase()}${category.slice(1)}`
}

function materialPosition(index: number): [number, number, number] {
  return [
    -0.255 + (index % 3) * 0.255,
    MATERIAL_GRID_TOP - Math.floor(index / 3) * MATERIAL_GRID_ROW_GAP,
    0,
  ]
}

function materialLabelFontSize(label: string) {
  if (label.length > 16) return 0.016
  if (label.length > 11) return 0.017
  return 0.018
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
      name={`xr-paint-material-${item.id}`}
      onClick={select}
      position={materialPosition(index)}
      selected={selected}
      size={MATERIAL_TILE_SIZE}
    >
      <PanelIcon
        color={item.previewColor ?? item.preset.mapProperties.color}
        size={MATERIAL_PREVIEW_SIZE}
        src={item.previewThumbnailUrl}
      />
      <SpatialLine
        color={selected ? XR_WAND_THEME.accentLine : XR_WAND_THEME.border}
        lineWidth={selected ? 1.5 : 0.8}
        opacity={selected ? 0.95 : 0.8}
        points={MATERIAL_PREVIEW_FRAME_POINTS}
        transparent
      />
      <SpatialText
        anchorX="center"
        anchorY="middle"
        color={XR_WAND_THEME.text}
        fontSize={materialLabelFontSize(item.label)}
        maxWidth={0.19}
        position={[0, -0.07, 0.012]}
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
  const activeCategoryIndex = availableCategories.length
    ? categoryIndex % availableCategories.length
    : 0
  const category = (availableCategories[activeCategoryIndex] ??
    availableCategories[0] ??
    'colors') as MaterialCategory
  const materials = getMaterialsForCategory(category)
  const current = getPage(materials, page, MATERIALS_PER_PAGE)
  const selectedId = getLibraryMaterialIdFromRef(activePaintMaterial?.materialPreset)

  const changeCategory = (direction: -1 | 1) => {
    if (availableCategories.length < 2) return
    setCategoryIndex(
      (activeCategoryIndex + direction + availableCategories.length) % availableCategories.length,
    )
    setPage(0)
  }

  return (
    <group name="xr-wand-paint-panel">
      <PanelHeader mark={mode === 'material-paint' ? activePaintTarget : 'ready'} title="Paint" />
      <group position={[0, 0.345, 0]}>
        <SpatialButton
          disabled={availableCategories.length < 2}
          name="xr-paint-previous-category"
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
          {labelCategory(category)} · {activeCategoryIndex + 1}/{availableCategories.length}
        </SpatialText>
        <SpatialButton
          disabled={availableCategories.length < 2}
          name="xr-paint-next-category"
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
          name="xr-paint-start"
          onClick={activatePaintMode}
          position={[-0.17, 0, 0]}
          selected={mode === 'material-paint'}
          size={[0.3, 0.06]}
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
          name="xr-paint-eraser"
          onClick={() => {
            activatePaintMode()
            setPaintEraser(!paintEraser)
          }}
          position={[0.17, 0, 0]}
          selected={paintEraser}
          size={[0.3, 0.06]}
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
      {current.items.length > 0 ? (
        current.items.map((item, index) => (
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
        ))
      ) : (
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.muted}
          fontSize={0.02}
          maxWidth={0.45}
          position={[0, -0.03, 0.012]}
          textAlign="center"
        >
          No materials in this category
        </SpatialText>
      )}
      <group position={[0, -0.35, 0]}>
        {current.pageCount > 1 && (
          <SpatialButton
            disabled={current.currentPage === 0}
            name="xr-paint-previous-page"
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
        )}
        <SpatialText
          anchorX="center"
          anchorY="middle"
          color={XR_WAND_THEME.muted}
          fontSize={0.018}
          maxWidth={0.42}
          position={[0, 0, 0.012]}
          textAlign="center"
        >
          {current.items.length > 0
            ? getActivePaintMaterialLabel(activePaintMaterial)
            : 'No materials'}
          {current.pageCount > 1 ? ` · ${current.currentPage + 1}/${current.pageCount}` : ''}
        </SpatialText>
        {current.pageCount > 1 && (
          <SpatialButton
            disabled={current.currentPage >= current.pageCount - 1}
            name="xr-paint-next-page"
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
        )}
      </group>
    </group>
  )
}
