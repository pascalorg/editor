import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { Color, type Material, type Mesh } from 'three'
import useEditor from '../../../store/use-editor'
import { useMovingNode } from '../../../store/use-interaction-scope'

const CEILING_GRID_HIGHLIGHT_COLOR = '#ffffff'
const CEILING_GRID_BASE_MATERIAL_KEY = '__pascalCeilingGridBaseMaterial'
const CEILING_GRID_HIGHLIGHT_MATERIAL_KEY = '__pascalCeilingGridHighlightMaterial'

type CeilingGridUserData = {
  [CEILING_GRID_BASE_MATERIAL_KEY]?: Material | Material[]
  [CEILING_GRID_HIGHLIGHT_MATERIAL_KEY]?: Material | Material[]
}

type HighlightableMaterial = Material & {
  color?: Color
  depthWrite?: boolean
  needsUpdate?: boolean
  opacity?: number
  transparent?: boolean
}

function cloneCeilingGridHighlightMaterial(material: Material | Material[]): Material | Material[] {
  const cloneOne = (entry: Material): Material => {
    const clone = entry.clone() as HighlightableMaterial
    if (clone.color instanceof Color) {
      clone.color.set(CEILING_GRID_HIGHLIGHT_COLOR)
    }
    clone.depthWrite = false
    clone.opacity = 1
    clone.transparent = true
    clone.needsUpdate = true
    return clone
  }

  return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material)
}

function disposeMaterial(material: Material | Material[] | undefined) {
  if (!material) return
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    entry.dispose()
  }
}

function setCeilingGridHighlighted(ceilingGrid: Mesh, highlighted: boolean) {
  const userData = ceilingGrid.userData as CeilingGridUserData

  if (highlighted) {
    if (!userData[CEILING_GRID_BASE_MATERIAL_KEY]) {
      userData[CEILING_GRID_BASE_MATERIAL_KEY] = ceilingGrid.material
      userData[CEILING_GRID_HIGHLIGHT_MATERIAL_KEY] = cloneCeilingGridHighlightMaterial(
        ceilingGrid.material,
      )
    }

    const highlightMaterial = userData[CEILING_GRID_HIGHLIGHT_MATERIAL_KEY]
    if (highlightMaterial) {
      ceilingGrid.material = highlightMaterial
    }
    return
  }

  const baseMaterial = userData[CEILING_GRID_BASE_MATERIAL_KEY]
  if (baseMaterial) {
    ceilingGrid.material = baseMaterial
  }
  disposeMaterial(userData[CEILING_GRID_HIGHLIGHT_MATERIAL_KEY])
  delete userData[CEILING_GRID_BASE_MATERIAL_KEY]
  delete userData[CEILING_GRID_HIGHLIGHT_MATERIAL_KEY]
}

export const CeilingSystem = () => {
  const tool = useEditor((state) => state.tool)
  const selectedItem = useEditor((state) => state.selectedItem)
  const movingNode = useMovingNode()
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const hoveredId = useViewer((state) => state.hoveredId)

  useEffect(() => {
    const nodes = useScene.getState().nodes
    const hoveredNode = hoveredId ? nodes[hoveredId as AnyNodeId] : null
    const hoveredCeilingId = hoveredNode?.type === 'ceiling' ? hoveredNode.id : null

    const levelsToShowCeilings = new Set<string>()

    const isCeilingToolActive =
      tool === 'ceiling' ||
      selectedItem?.attachTo === 'ceiling' ||
      (movingNode?.type === 'item' && movingNode?.asset?.attachTo === 'ceiling')

    if (isCeilingToolActive && activeLevelId) {
      levelsToShowCeilings.add(activeLevelId)
    }

    for (const id of selectedIds) {
      // Only treat a directly-selected ceiling as "reveal the grid"; a
      // selected descendant (e.g. a freshly-placed ceiling light) used to
      // count too, which left the opaque grid overlay covering the room
      // even after the user moved on. With the grid still in front, every
      // subsequent click in 3D hit the grid mesh (its `useNodeEvents`
      // handlers re-selected the ceiling) instead of the items below.
      const selectedNode = nodes[id as AnyNodeId]
      if (selectedNode?.type !== 'ceiling') continue

      let currentId: string | null = selectedNode.parentId as string | null
      let levelId: string | null = null
      while (currentId && nodes[currentId as AnyNodeId]) {
        const node = nodes[currentId as AnyNodeId]
        if (node?.type === 'level') {
          levelId = node.id
          break
        }
        currentId = node?.parentId as string | null
      }

      if (levelId) {
        levelsToShowCeilings.add(levelId)
      }
    }

    const ceilings = sceneRegistry.byType.ceiling!
    ceilings.forEach((ceiling) => {
      const mesh = sceneRegistry.nodes.get(ceiling)
      if (mesh) {
        const ceilingGrid = mesh.getObjectByName('ceiling-grid') as Mesh | undefined
        if (ceilingGrid) {
          let belongsToVisibleLevel = false
          let currentId: string | null = ceiling

          while (currentId && nodes[currentId as AnyNodeId]) {
            const node = nodes[currentId as AnyNodeId]
            if (node && levelsToShowCeilings.has(node.id)) {
              belongsToVisibleLevel = true
              break
            }
            currentId = node?.parentId as string | null
          }

          const shouldHighlightGrid = ceiling === hoveredCeilingId
          const shouldShowGrid =
            shouldHighlightGrid ||
            belongsToVisibleLevel ||
            (levelsToShowCeilings.size === 0 && isCeilingToolActive)

          setCeilingGridHighlighted(ceilingGrid, shouldHighlightGrid)
          ceilingGrid.visible = shouldShowGrid
          ceilingGrid.scale.setScalar(shouldShowGrid ? 1 : 0.0) // Scale down to zero to prevent event interference when grid is hidden
        }
      }
    })
  }, [tool, selectedItem, movingNode, selectedIds, activeLevelId, hoveredId])
  return null
}
