import { AnyNode, type AnyNodeType } from '@pascal/core'

export const CameraModes = ['perspective', 'orthographic'] as const
export type CameraMode = (typeof CameraModes)[number]

export const ControlModes = ['select', 'build', 'delete', 'edit', 'move'] as const
export type ControlMode = (typeof ControlModes)[number]

export const BuildingPresentationModes = ['stacked', 'exploded'] as const
export type BuildingPresentationMode = (typeof BuildingPresentationModes)[number]

export const BuildingViewModes = ['full', 'level'] as const
export type BuildingViewMode = (typeof BuildingViewModes)[number]

export type EditorState = {
  controlMode: ControlMode
  setControlMode: (mode: ControlMode) => void

  // Camera state management
  cameraMode: CameraMode
  setCameraMode: (mode: CameraMode) => void
  movingCamera: boolean
  setMovingCamera: (moving: boolean) => void

  // Tools
  activeTool: ControlMode | null
  setActiveTool: (tool: ControlMode | null) => void

  // Selected node IDs
  selectedNodeIds: string[]
  setSelectedNodeIds: (ids: string[]) => void

  // Selected building node
  selectedBuildingNodeId: string | null
  setSelectedBuildingNodeId: (id: string | null) => void

  // Selected level node
  selectedLevelNodeId: string | null
  setSelectedLevelNodeId: (id: string | null) => void

  // Building view mode
  buildingViewMode: BuildingViewMode
  setBuildingViewMode: (mode: BuildingViewMode) => void

  // Building presentation mode
  buildingPresentationMode: BuildingPresentationMode
  setBuildingPresentationMode: (mode: BuildingPresentationMode) => void
}
