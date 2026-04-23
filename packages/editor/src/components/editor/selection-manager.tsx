import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  emitter,
  type ItemNode,
  type NodeEvent,
  type RoofEvent,
  type RoofSegmentEvent,
  resolveLevelId,
  sceneRegistry,
  type StairEvent,
  type StairNode,
  type StairSurfaceMaterialRole,
  type StairSegmentEvent,
  useScene,
  type WallEvent,
  type WallSurfaceSide,
} from '@pascal-app/core'

import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef } from 'react'
import { Color, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor, { type MaterialTargetRole, type Phase, type StructureLayer } from './../../store/use-editor'
import useNavigation from '../../store/use-navigation'
import navigationVisualsStore from '../../store/use-navigation-visuals'
import { boxSelectHandled } from '../tools/select/box-select-tool'

const isNodeInCurrentLevel = (node: AnyNode): boolean => {
  const currentLevelId = useViewer.getState().selection.levelId
  if (!currentLevelId) return true // No level selected, allow all
  const nodeLevelId = resolveLevelId(node, useScene.getState().nodes)
  return nodeLevelId === currentLevelId
}

type SelectableNodeType =
  | 'wall'
  | 'fence'
  | 'item'
  | 'building'
  | 'zone'
  | 'slab'
  | 'ceiling'
  | 'roof'
  | 'roof-segment'
  | 'stair'
  | 'stair-segment'
  | 'window'
  | 'door'

type ModifierKeys = {
  meta: boolean
  ctrl: boolean
}

interface SelectionStrategy {
  types: SelectableNodeType[]
  handleSelect: (node: AnyNode, nativeEvent?: any, modifierKeys?: ModifierKeys) => void
  handleDeselect: () => void
  isValid: (node: AnyNode) => boolean
}

type SelectionTarget = {
  phase: Phase
  structureLayer?: StructureLayer
}

export const resolveBuildingId = (
  levelId: string,
  nodes: Record<string, AnyNode>,
): string | null => {
  const level = nodes[levelId]
  if (!level) return null
  if (level.parentId && nodes[level.parentId]?.type === 'building') {
    return level.parentId
  }
  return null
}

function resolveWallMaterialTarget(event: WallEvent): WallSurfaceSide | null {
  const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)
  if (materialIndex === 1) return 'interior'
  if (materialIndex === 2) return 'exterior'

  const normalZ = event.normal?.[2]
  const localZ = event.localPosition[2]
  const thickness = event.node.thickness ?? 0.1

  if (
    normalZ === undefined ||
    Math.abs(normalZ) < 0.65 ||
    Math.abs(localZ) < Math.max(thickness * 0.2, 0.01)
  ) {
    return null
  }

  const hitFace = localZ >= 0 ? 'front' : 'back'
  const semantic = hitFace === 'front' ? event.node.frontSide : event.node.backSide

  if (semantic === 'interior' || semantic === 'exterior') {
    return semantic
  }

  return hitFace === 'front' ? 'interior' : 'exterior'
}

function resolveStairMaterialTarget(
  event: StairEvent | StairSegmentEvent,
): StairSurfaceMaterialRole | null {
  const hitObjectName = event.nativeEvent.object?.name ?? ''
  const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)

  if (hitObjectName.startsWith('stair-railing')) {
    return 'railing'
  }

  if (hitObjectName.startsWith('stair-side')) {
    return 'side'
  }

  if (materialIndex === 0) {
    return 'tread'
  }

  if (materialIndex === 1) {
    return 'side'
  }

  const normalY = event.normal?.[1]
  if (normalY !== undefined && normalY > 0.75) {
    return 'tread'
  }

  if (normalY !== undefined && Math.abs(normalY) <= 0.75) {
    return 'side'
  }

  return null
}

function resolveRoofMaterialTarget(
  event: RoofEvent | RoofSegmentEvent,
): 'top' | 'edge' | 'wall' | null {
  const materialIndex = getIntersectionMaterialIndex(getEventObject(event), event.faceIndex)
  if (materialIndex === 3) return 'top'
  if (materialIndex === 0) return 'edge'
  if (materialIndex === 1 || materialIndex === 2) return 'wall'

  const normalY = event.normal?.[1]
  if (normalY !== undefined && normalY > 0.35) return 'top'
  if (normalY !== undefined && Math.abs(normalY) <= 0.35) return 'edge'
  if (normalY !== undefined && normalY < -0.35) return 'wall'

  return null
}

function getEventObject(event: NodeEvent): Object3D {
  const eventWithObject = event as NodeEvent & { object?: Object3D }
  return eventWithObject.object ?? event.nativeEvent.object
}

function getIntersectionMaterialIndex(
  object: Object3D,
  faceIndex: number | undefined,
): number | undefined {
  if (faceIndex === undefined) return undefined

  const geometry = (object as Mesh).geometry as BufferGeometry | undefined
  if (!geometry || geometry.groups.length === 0) return undefined

  const triangleStart = faceIndex * 3
  const group = geometry.groups.find(
    (entry) => triangleStart >= entry.start && triangleStart < entry.start + entry.count,
  )

  return group?.materialIndex
}

function setSelectedMaterialTargetForNode(
  node: AnyNode,
  role: MaterialTargetRole | null,
) {
  if (!role) {
    const currentTarget = useEditor.getState().selectedMaterialTarget
    if (currentTarget?.nodeId !== node.id) {
      useEditor.getState().setSelectedMaterialTarget(null)
    }
    return
  }

  useEditor.getState().setSelectedMaterialTarget({
    nodeId: node.id as AnyNodeId,
    role,
  })
}

const HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.76,
    emissiveBlend: 0.92,
    emissiveIntensity: 0.46,
  },
  selection: {
    color: new Color('#818cf8'),
    blend: 0.32,
    emissiveBlend: 0.7,
    emissiveIntensity: 0.42,
  },
} as const

type HighlightKind = keyof typeof HIGHLIGHT_PROFILES

type HighlightableMaterial = Material & {
  color?: Color
  emissive?: Color
  emissiveIntensity?: number
  opacity?: number
  transparent?: boolean
  needsUpdate?: boolean
}

function isHighlightableMesh(object: Object3D): object is Mesh {
  return Boolean(
    (object as Mesh).isMesh &&
      (object as Mesh).material &&
      object.visible &&
      object.name !== 'collision-mesh',
  )
}

function createHighlightedMaterial(material: Material, kind: HighlightKind): Material {
  const highlightedMaterial = material.clone() as HighlightableMaterial
  const profile = HIGHLIGHT_PROFILES[kind]

  if (highlightedMaterial.color instanceof Color) {
    highlightedMaterial.color = highlightedMaterial.color.clone().lerp(profile.color, profile.blend)
  }

  if (highlightedMaterial.emissive instanceof Color) {
    highlightedMaterial.emissive = highlightedMaterial.emissive
      .clone()
      .lerp(profile.color, profile.emissiveBlend)
    highlightedMaterial.emissiveIntensity = Math.max(
      highlightedMaterial.emissiveIntensity ?? 0,
      profile.emissiveIntensity,
    )
  }

  if (typeof highlightedMaterial.opacity === 'number' && highlightedMaterial.opacity < 1) {
    highlightedMaterial.transparent = true
    highlightedMaterial.opacity = Math.min(1, highlightedMaterial.opacity + 0.08)
  }

  highlightedMaterial.needsUpdate = true
  return highlightedMaterial
}

function createHighlightedMaterials(
  material: Material | Material[],
  kind: HighlightKind,
): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => createHighlightedMaterial(entry, kind))
  }

  return createHighlightedMaterial(material, kind)
}

function disposeHighlightedMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.dispose()
    })
    return
  }

  material.dispose()
}

function getSelectionMoveVisualState(nodeId: string) {
  return navigationVisualsStore.getState().itemMoveVisualStates[nodeId] ?? null
}

function shouldSkipSelectionMaterial(nodeId: string) {
  const visualState = getSelectionMoveVisualState(nodeId)
  return (
    visualState === 'carried' ||
    visualState === 'copy-source-pending' ||
    visualState === 'destination-ghost' ||
    visualState === 'destination-preview' ||
    visualState === 'source-pending'
  )
}

function shouldSkipSelectionOutline(nodeId: string) {
  const visualState = getSelectionMoveVisualState(nodeId)
  return (
    visualState === 'carried' ||
    visualState === 'copy-source-pending' ||
    visualState === 'source-pending'
  )
}

const computeNextIds = (
  node: AnyNode,
  selectedIds: string[],
  event?: any,
  modifierKeys?: ModifierKeys,
): string[] => {
  const isMeta = event?.metaKey || event?.nativeEvent?.metaKey || modifierKeys?.meta
  const isCtrl = event?.ctrlKey || event?.nativeEvent?.ctrlKey || modifierKeys?.ctrl

  if (isMeta || isCtrl) {
    if (selectedIds.includes(node.id)) {
      return selectedIds.filter((id) => id !== node.id)
    }
    return [...selectedIds, node.id]
  }

  // Not holding modifiers: select only this node
  return [node.id]
}

const SELECTION_STRATEGIES: Record<string, SelectionStrategy> = {
  site: {
    types: ['building'],
    handleSelect: (node) => {
      useViewer.getState().setSelection({ buildingId: (node as BuildingNode).id })
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ buildingId: null })
    },
    isValid: (node) => node.type === 'building',
  },

  structure: {
    types: [
      'wall',
      'fence',
      'item',
      'zone',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
    ],
    handleSelect: (node, nativeEvent, modifierKeys) => {
      const { selection, setSelection } = useViewer.getState()
      const nodes = useScene.getState().nodes
      const nodeLevelId = resolveLevelId(node, nodes)
      const buildingId = resolveBuildingId(nodeLevelId, nodes)

      const updates: any = {}
      if (nodeLevelId !== 'default' && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId
      }

      if (node.type === 'zone') {
        updates.zoneId = node.id
        // Don't reset selectedIds in structure phase for zone, but if we changed level, it might reset them via hierarchy guard.
        // Wait, the hierarchy guard resets zoneId if levelId changes. That's fine since we provide zoneId.
        setSelection(updates)
      } else {
        updates.selectedIds = computeNextIds(node, selection.selectedIds, nativeEvent, modifierKeys)
        setSelection(updates)
      }
    },
    handleDeselect: () => {
      const structureLayer = useEditor.getState().structureLayer
      if (structureLayer === 'zones') {
        useViewer.getState().setSelection({ zoneId: null })
      } else {
        useViewer.getState().setSelection({ selectedIds: [] })
      }
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false
      const structureLayer = useEditor.getState().structureLayer
      if (structureLayer === 'zones') {
        if (node.type === 'zone') return true
        return false
      }
      if (
        node.type === 'wall' ||
        node.type === 'fence' ||
        node.type === 'slab' ||
        node.type === 'ceiling' ||
        node.type === 'roof' ||
        node.type === 'roof-segment' ||
        node.type === 'stair' ||
        node.type === 'stair-segment'
      )
        return true
      if (node.type === 'item') {
        return (
          (node as ItemNode).asset.category === 'door' ||
          (node as ItemNode).asset.category === 'window'
        )
      }
      if (node.type === 'window' || node.type === 'door') return true

      return false
    },
  },

  furnish: {
    types: ['item'],
    handleSelect: (node, nativeEvent, modifierKeys) => {
      const { selection, setSelection } = useViewer.getState()
      const nodes = useScene.getState().nodes
      const nodeLevelId = resolveLevelId(node, nodes)
      const buildingId = resolveBuildingId(nodeLevelId, nodes)

      const updates: any = {}
      if (nodeLevelId !== 'default' && nodeLevelId !== selection.levelId) {
        updates.levelId = nodeLevelId
      }
      if (buildingId && buildingId !== selection.buildingId) {
        updates.buildingId = buildingId
      }

      updates.selectedIds = computeNextIds(node, selection.selectedIds, nativeEvent, modifierKeys)
      setSelection(updates)
    },
    handleDeselect: () => {
      useViewer.getState().setSelection({ selectedIds: [] })
    },
    isValid: (node) => {
      if (!isNodeInCurrentLevel(node)) return false
      if (node.type !== 'item') return false
      const item = node as ItemNode
      return item.asset.category !== 'door' && item.asset.category !== 'window'
    },
  },
}

const getSelectionTarget = (node: AnyNode): SelectionTarget | null => {
  if (node.type === 'zone') {
    return {
      phase: 'structure',
      structureLayer: 'zones',
    }
  }

  if (
    node.type === 'wall' ||
    node.type === 'fence' ||
    node.type === 'slab' ||
    node.type === 'ceiling' ||
    node.type === 'roof' ||
    node.type === 'roof-segment' ||
    node.type === 'stair' ||
    node.type === 'stair-segment' ||
    node.type === 'window' ||
    node.type === 'door'
  ) {
    return {
      phase: 'structure',
      structureLayer: 'elements',
    }
  }

  if (node.type === 'item') {
    const item = node as ItemNode
    if (item.asset.category === 'door' || item.asset.category === 'window') {
      return {
        phase: 'structure',
        structureLayer: 'elements',
      }
    }

    return {
      phase: 'furnish',
    }
  }

  return null
}

export const SelectionManager = () => {
  const phase = useEditor((s) => s.phase)
  const mode = useEditor((s) => s.mode)
  const navigationEnabled = useNavigation((s) => s.enabled)
  const robotMode = useNavigation((s) => s.robotMode)
  const suppressNavigationClick = useNavigation((s) => s.suppressNavigationClick)
  const setHoverHighlightMode = useViewer((s) => s.setHoverHighlightMode)
  const modifierKeysRef = useRef<ModifierKeys>({
    meta: false,
    ctrl: false,
  })
  const clickHandledRef = useRef(false)
  const navigationSelectionSuppressed = navigationEnabled && robotMode === 'normal'

  const movingNode = useEditor((s) => s.movingNode)
  const curvingWall = useEditor((s) => s.curvingWall)
  const curvingFence = useEditor((s) => s.curvingFence)

  const selectNodeFromEvent = useCallback((event: NodeEvent) => {
    const node = event.node
    let currentPhase = useEditor.getState().phase
    let currentStructureLayer = useEditor.getState().structureLayer

    if (currentPhase === 'structure' || currentPhase === 'furnish' || currentPhase === 'site') {
      if (isNodeInCurrentLevel(node)) {
        const target = getSelectionTarget(node)
        if (target) {
          if (target.phase !== currentPhase) {
            useEditor.getState().setPhase(target.phase)
            currentPhase = target.phase
          }

          if (
            target.phase === 'structure' &&
            target.structureLayer &&
            target.structureLayer !== currentStructureLayer
          ) {
            useEditor.getState().setStructureLayer(target.structureLayer)
            currentStructureLayer = target.structureLayer
          }
        }
      }
    }

    const activeStrategy = SELECTION_STRATEGIES[currentPhase]
    if (!activeStrategy?.isValid(node)) {
      return false
    }

    event.stopPropagation()
    clickHandledRef.current = true

    let nodeToSelect = node
    if (node.type === 'roof-segment' && node.parentId) {
      const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
      if (parentNode && parentNode.type === 'roof') {
        nodeToSelect = parentNode
      }
    }
    if (node.type === 'stair-segment' && node.parentId) {
      const parentNode = useScene.getState().nodes[node.parentId as AnyNodeId]
      if (parentNode && parentNode.type === 'stair') {
        nodeToSelect = parentNode
      }
    }

    activeStrategy.handleSelect(nodeToSelect, event.nativeEvent, modifierKeysRef.current)

    let nextMaterialTargetHandled = false

    if (node.type === 'wall' && nodeToSelect.type === 'wall') {
      setSelectedMaterialTargetForNode(nodeToSelect, resolveWallMaterialTarget(event as WallEvent))
      nextMaterialTargetHandled = true
    }

    if (
      (node.type === 'stair' || node.type === 'stair-segment') &&
      nodeToSelect.type === 'stair'
    ) {
      setSelectedMaterialTargetForNode(
        nodeToSelect,
        resolveStairMaterialTarget(event as StairEvent | StairSegmentEvent),
      )
      nextMaterialTargetHandled = true
    }

    if (
      (node.type === 'roof' || node.type === 'roof-segment') &&
      nodeToSelect.type === 'roof'
    ) {
      setSelectedMaterialTargetForNode(
        nodeToSelect,
        resolveRoofMaterialTarget(event as RoofEvent | RoofSegmentEvent),
      )
      nextMaterialTargetHandled = true
    }

    if (!nextMaterialTargetHandled && useEditor.getState().selectedMaterialTarget) {
      useEditor.getState().setSelectedMaterialTarget(null)
    }

    setTimeout(() => {
      clickHandledRef.current = false
    }, 50)

    return true
  }, [])

  useEffect(() => {
    setHoverHighlightMode(mode === 'delete' ? 'delete' : 'default')

    return () => {
      setHoverHighlightMode('default')
    }
  }, [mode, setHoverHighlightMode])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = true
      if (event.key === 'Control') modifierKeysRef.current.ctrl = true
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') modifierKeysRef.current.meta = false
      if (event.key === 'Control') modifierKeysRef.current.ctrl = false
    }

    const clearModifiers = () => {
      modifierKeysRef.current.meta = false
      modifierKeysRef.current.ctrl = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearModifiers)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearModifiers)
    }
  }, [])

  useEffect(() => {
    if (navigationSelectionSuppressed) {
      const viewerState = useViewer.getState()
      viewerState.setHoveredId(null)
      viewerState.setPreviewSelectedIds([])
      viewerState.setSelection({
        buildingId: viewerState.selection.buildingId,
        levelId: viewerState.selection.levelId,
        selectedIds: [],
        zoneId: null,
      })
      viewerState.outliner.selectedObjects.length = 0
      viewerState.outliner.hoveredObjects.length = 0
      useEditor.getState().setSelectedMaterialTarget(null)
      useEditor.getState().setSelectedReferenceId(null)
      clickHandledRef.current = false
    }
  }, [navigationSelectionSuppressed])

  useEffect(() => {
    if (!navigationEnabled) {
      return
    }

    const onNavigationItemPointerDown = (event: NodeEvent) => {
      if (mode !== 'select' || movingNode) {
        return
      }

      if (event.node.type !== 'item') {
        return
      }

      suppressNavigationClick(500)
    }

    const onNavigationItemClick = (event: NodeEvent) => {
      if (!navigationSelectionSuppressed) {
        return
      }

      if (mode !== 'select' || movingNode) {
        return
      }

      if (event.node.type !== 'item') {
        return
      }

      suppressNavigationClick()
      selectNodeFromEvent(event)
    }

    emitter.on('item:pointerdown', onNavigationItemPointerDown as any)
    emitter.on('item:click', onNavigationItemClick as any)

    return () => {
      emitter.off('item:pointerdown', onNavigationItemPointerDown as any)
      emitter.off('item:click', onNavigationItemClick as any)
    }
  }, [
    mode,
    movingNode,
    navigationEnabled,
    navigationSelectionSuppressed,
    selectNodeFromEvent,
    suppressNavigationClick,
  ])

  useEffect(() => {
    if (navigationSelectionSuppressed) return
    if (mode !== 'select') return
    if (movingNode || curvingWall || curvingFence) return

    const onClick = (event: NodeEvent) => {
      // Skip if box-select just completed (drag ended over a node)
      if (boxSelectHandled) return
      selectNodeFromEvent(event)
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'building',
      'zone',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
    ]
    allTypes.forEach((type) => {
      emitter.on(`${type}:click` as any, onClick as any)
    })

    const onGridClick = () => {
      if (clickHandledRef.current) return
      if (boxSelectHandled) return
      const { phase, structureLayer } = useEditor.getState()
      const activeStrategy = SELECTION_STRATEGIES[phase]
      if (activeStrategy) activeStrategy.handleDeselect()
      useEditor.getState().setSelectedMaterialTarget(null)

      // When deselecting from zone mode, return to structure select
      if (phase === 'structure' && structureLayer === 'zones') {
        useEditor.getState().setStructureLayer('elements')
        useEditor.getState().setMode('select')
      }
    }
    emitter.on('grid:click', onGridClick)

    return () => {
      allTypes.forEach((type) => {
        emitter.off(`${type}:click` as any, onClick as any)
      })
      emitter.off('grid:click', onGridClick)
    }
  }, [curvingFence, curvingWall, mode, movingNode, navigationSelectionSuppressed, selectNodeFromEvent])

  // Global double-click handler for auto-switching phases and cross-phase hover
  useEffect(() => {
    if (navigationSelectionSuppressed) return
    if (mode !== 'select') return
    if (movingNode || curvingWall || curvingFence) return

    const onEnter = (event: NodeEvent) => {
      const node = event.node
      const currentPhase = useEditor.getState().phase

      // Ignore site/building if we are already inside a building
      if (node.type === 'building' || node.type === 'site') {
        if (currentPhase === 'structure' || currentPhase === 'furnish') {
          return
        }
      }

      // Ignore zones unless specifically in zones layer
      if (node.type === 'zone') {
        if (currentPhase !== 'structure' || useEditor.getState().structureLayer !== 'zones') {
          return
        }
      }

      // Check level constraint for interior nodes
      if (currentPhase === 'structure' || currentPhase === 'furnish') {
        if (!isNodeInCurrentLevel(node)) return
      }

      event.stopPropagation()
      useViewer.setState({ hoveredId: node.id })
    }

    const onLeave = (event: NodeEvent) => {
      const nodeId = event?.node?.id
      if (nodeId && useViewer.getState().hoveredId === nodeId) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const onDoubleClick = (event: NodeEvent) => {
      const node = event.node
      const currentPhase = useEditor.getState().phase

      let targetPhase: 'site' | 'structure' | 'furnish' | null = null
      let forceSelect = false

      if (node.type === 'building' || node.type === 'site') {
        if (currentPhase === 'structure' || currentPhase === 'furnish') {
          return // Ignore building/site double clicks if we are already inside a building
        }
        if (node.type === 'building') {
          targetPhase = 'structure'
        }
      } else if (
        node.type === 'wall' ||
        node.type === 'fence' ||
        node.type === 'slab' ||
        node.type === 'ceiling' ||
        node.type === 'roof' ||
        node.type === 'roof-segment' ||
        node.type === 'stair' ||
        node.type === 'stair-segment' ||
        node.type === 'window' ||
        node.type === 'door'
      ) {
        targetPhase = 'structure'
        if (node.type === 'roof-segment' && currentPhase === 'structure') {
          forceSelect = true // allow double click to dive into roof-segment even if already in structure phase
        }
        if (node.type === 'stair-segment' && currentPhase === 'structure') {
          forceSelect = true // allow double click to dive into stair-segment even if already in structure phase
        }
      } else if (node.type === 'item') {
        const item = node as ItemNode
        if (item.asset.category === 'door' || item.asset.category === 'window') {
          targetPhase = 'structure'
        } else {
          targetPhase = 'furnish'
        }
      }

      if (node.type === 'zone') {
        return
      }

      if ((targetPhase && targetPhase !== useEditor.getState().phase) || forceSelect) {
        event.stopPropagation()

        if (targetPhase && targetPhase !== useEditor.getState().phase) {
          useEditor.getState().setPhase(targetPhase)
        }

        if (targetPhase === 'structure' && useEditor.getState().structureLayer === 'zones') {
          useEditor.getState().setStructureLayer('elements')
        }

        const strategy = SELECTION_STRATEGIES[targetPhase || currentPhase]
        if (strategy) {
          strategy.handleSelect(node, event.nativeEvent, modifierKeysRef.current)
        }
      }
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'building',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
      'zone',
      'site',
    ]
    allTypes.forEach((type) => {
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
      emitter.on(`${type}:double-click` as any, onDoubleClick as any)
    })

    return () => {
      allTypes.forEach((type) => {
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
        emitter.off(`${type}:double-click` as any, onDoubleClick as any)
      })
    }
  }, [curvingFence, curvingWall, mode, movingNode, navigationSelectionSuppressed])

  // Delete mode: click-to-delete (sledgehammer tool)
  useEffect(() => {
    if (navigationSelectionSuppressed) return
    if (mode !== 'delete') return

    const onClick = (event: NodeEvent) => {
      const node = event.node
      if (!isNodeInCurrentLevel(node)) return

      event.stopPropagation()

      // Play appropriate SFX
      if (node.type === 'item') {
        sfxEmitter.emit('sfx:item-delete')
      } else {
        sfxEmitter.emit('sfx:structure-delete')
      }

      useScene.getState().deleteNode(node.id as AnyNodeId)
      if (node.parentId) useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)

      // Clear hover since the node is gone
      if (useViewer.getState().hoveredId === node.id) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const onEnter = (event: NodeEvent) => {
      const node = event.node
      if (!isNodeInCurrentLevel(node)) return
      if (node.type === 'building' || node.type === 'site') return
      event.stopPropagation()
      useViewer.setState({ hoveredId: node.id })
    }

    const onLeave = (event: NodeEvent) => {
      const nodeId = event?.node?.id
      if (nodeId && useViewer.getState().hoveredId === nodeId) {
        useViewer.setState({ hoveredId: null })
      }
    }

    const allTypes = [
      'wall',
      'fence',
      'item',
      'slab',
      'ceiling',
      'roof',
      'roof-segment',
      'stair',
      'stair-segment',
      'window',
      'door',
      'zone',
    ] as const

    for (const type of allTypes) {
      emitter.on(`${type}:click` as any, onClick as any)
      emitter.on(`${type}:enter` as any, onEnter as any)
      emitter.on(`${type}:leave` as any, onLeave as any)
    }

    return () => {
      for (const type of allTypes) {
        emitter.off(`${type}:click` as any, onClick as any)
        emitter.off(`${type}:enter` as any, onEnter as any)
        emitter.off(`${type}:leave` as any, onLeave as any)
      }
      useViewer.setState({ hoveredId: null })
    }
  }, [mode, navigationSelectionSuppressed])

  return (
    <>
      <SelectionStateSync />
      <SelectionMaterialSync />
      <EditorOutlinerSync />
    </>
  )
}

const SelectionStateSync = () => {
  const selectedMaterialTarget = useEditor((s) => s.selectedMaterialTarget)
  const setSelectedMaterialTarget = useEditor((s) => s.setSelectedMaterialTarget)
  const singleSelectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )

  useEffect(() => {
    return useScene.subscribe((state) => {
      const { buildingId, levelId, zoneId, selectedIds } = useViewer.getState().selection

      if (buildingId && !state.nodes[buildingId as AnyNodeId]) {
        useViewer.getState().setSelection({ buildingId: null })
        return
      }

      if (levelId && !state.nodes[levelId as AnyNodeId]) {
        useViewer.getState().setSelection({ levelId: null })
        return
      }

      if (zoneId && !state.nodes[zoneId as AnyNodeId]) {
        useViewer.getState().setSelection({ zoneId: null })
        return
      }

      if (selectedIds.length === 0) return

      const nextSelectedIds = selectedIds.filter((id) => state.nodes[id as AnyNodeId])
      if (nextSelectedIds.length !== selectedIds.length) {
        useViewer.getState().setSelection({ selectedIds: nextSelectedIds })
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedMaterialTarget) return

    if (!singleSelectedId) {
      setSelectedMaterialTarget(null)
      return
    }

    const selectedNode = useScene.getState().nodes[singleSelectedId as AnyNodeId]
    if (
      !selectedNode ||
      (selectedNode.type !== 'wall' && selectedNode.type !== 'stair' && selectedNode.type !== 'roof')
    ) {
      setSelectedMaterialTarget(null)
      return
    }

    if (selectedMaterialTarget.nodeId !== selectedNode.id) {
      setSelectedMaterialTarget(null)
    }
  }, [selectedMaterialTarget, setSelectedMaterialTarget, singleSelectedId])

  return null
}

const SelectionMaterialSync = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const hoverHighlightMode = useViewer((s) => s.hoverHighlightMode)
  const activeHighlightKindsRef = useRef(new Map<string, HighlightKind>())
  const highlightedMaterialsRef = useRef(
    new Map<
      Mesh,
      {
        originalMaterial: Material | Material[]
        highlightedMaterial: Material | Material[]
        kind: HighlightKind
      }
    >(),
  )

  const syncSelectionMaterials = useCallback(() => {
    const activeMeshes = new Set<Mesh>()

    for (const [id, kind] of activeHighlightKindsRef.current.entries()) {
      const node = useScene.getState().nodes[id as AnyNodeId]
      if (node?.type === 'wall') {
        continue
      }

      const rootObject = sceneRegistry.nodes.get(id)
      if (!rootObject) {
        continue
      }

      rootObject.traverse((child) => {
        if (!isHighlightableMesh(child)) {
          return
        }

        activeMeshes.add(child)
        const existingEntry = highlightedMaterialsRef.current.get(child)
        if (existingEntry) {
          const materialWasOverwritten = child.material !== existingEntry.highlightedMaterial
          if (materialWasOverwritten || existingEntry.kind !== kind) {
            disposeHighlightedMaterials(existingEntry.highlightedMaterial)
            const originalMaterial = materialWasOverwritten
              ? child.material
              : existingEntry.originalMaterial
            const highlightedMaterial = createHighlightedMaterials(originalMaterial, kind)
            child.material = highlightedMaterial
            highlightedMaterialsRef.current.set(child, {
              originalMaterial,
              highlightedMaterial,
              kind,
            })
          }
          return
        }

        const originalMaterial = child.material
        const highlightedMaterial = createHighlightedMaterials(originalMaterial, kind)
        child.material = highlightedMaterial
        highlightedMaterialsRef.current.set(child, {
          originalMaterial,
          highlightedMaterial,
          kind,
        })
      })
    }

    for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
      if (activeMeshes.has(mesh)) {
        continue
      }

      if (mesh.material === entry.highlightedMaterial) {
        mesh.material = entry.originalMaterial
      }
      disposeHighlightedMaterials(entry.highlightedMaterial)
      highlightedMaterialsRef.current.delete(mesh)
    }
  }, [])

  useEffect(() => {
    const nextHighlightKinds = new Map<string, HighlightKind>()

    for (const id of new Set([...selectedIds, ...previewSelectedIds])) {
      if (shouldSkipSelectionMaterial(id)) {
        continue
      }

      nextHighlightKinds.set(id, 'selection')
    }

    if (hoverHighlightMode === 'delete' && hoveredId) {
      nextHighlightKinds.set(hoveredId, 'delete')
    }

    activeHighlightKindsRef.current = nextHighlightKinds
    syncSelectionMaterials()
  }, [hoverHighlightMode, hoveredId, previewSelectedIds, selectedIds, syncSelectionMaterials])

  useEffect(() => {
    return useScene.subscribe(() => {
      syncSelectionMaterials()
    })
  }, [syncSelectionMaterials])

  useEffect(() => {
    const restoreForCapture = () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.highlightedMaterial) {
          mesh.material = entry.originalMaterial
        }
      }
    }

    const reapplyAfterCapture = () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.originalMaterial) {
          mesh.material = entry.highlightedMaterial
        }
      }
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const [mesh, entry] of highlightedMaterialsRef.current.entries()) {
        if (mesh.material === entry.highlightedMaterial) {
          mesh.material = entry.originalMaterial
        }
        disposeHighlightedMaterials(entry.highlightedMaterial)
      }

      highlightedMaterialsRef.current.clear()
    }
  }, [])

  return null
}

const EditorOutlinerSync = () => {
  const phase = useEditor((s) => s.phase)
  const selection = useViewer((s) => s.selection)
  const previewSelectedIds = useViewer((s) => s.previewSelectedIds)
  const hoveredId = useViewer((s) => s.hoveredId)
  const outliner = useViewer((s) => s.outliner)

  useEffect(() => {
    let idsToHighlight: string[] = []

    // 1. Determine what should be highlighted based on Phase
    switch (phase) {
      case 'site':
        // Only highlight the building if one is selected
        if (selection.buildingId) idsToHighlight = [selection.buildingId]
        break

      case 'structure':
        // Highlight selected items (walls/slabs)
        // We IGNORE buildingId even if it's set in the store
        idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        break

      case 'furnish':
        // Highlight selected furniture/items
        idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        break

      default:
        // Pure Viewer mode: Highlight based on the "deepest" selection
        if (selection.selectedIds.length > 0 || previewSelectedIds.length > 0) {
          idsToHighlight = Array.from(new Set([...selection.selectedIds, ...previewSelectedIds]))
        } else if (selection.levelId) {
          idsToHighlight = [selection.levelId]
        } else if (selection.buildingId) {
          idsToHighlight = [selection.buildingId]
        }
    }

    // 2. Sync with the imperative outliner arrays (mutate in place to keep references)
    outliner.selectedObjects.length = 0
    for (const id of idsToHighlight) {
      if (shouldSkipSelectionOutline(id)) {
        continue
      }

      const obj = sceneRegistry.nodes.get(id)
      if (obj?.parent) outliner.selectedObjects.push(obj)
    }

    outliner.hoveredObjects.length = 0
    if (hoveredId) {
      const obj = sceneRegistry.nodes.get(hoveredId)
      if (obj?.parent) outliner.hoveredObjects.push(obj)
    }
  }, [phase, previewSelectedIds, selection, hoveredId, outliner])

  return null
}
