import * as React from 'react'

/**
 * Wall display mode for the viewer
 */
export type WallMode = 'full' | 'cutaway' | 'hidden'

/**
 * Props for the SceneViewer component
 */
export interface SceneViewerProps {
  /** URL to load the scene JSON from */
  sceneUrl?: string
  /** Initial zoom level for orthographic camera (default: 80) */
  defaultZoom?: number
  /** When true, posts selection changes to parent window for iframe embedding */
  isEmbedded?: boolean
  /** Initial wall mode for viewer */
  defaultWallMode?: WallMode
  /** CSS class name for the container */
  className?: string
  /** Custom loading component */
  loadingComponent?: React.ReactNode
  /** Custom error component */
  errorComponent?: (error: string) => React.ReactNode
  /** Callback when scene is loaded */
  onSceneLoaded?: () => void
  /** Callback when an error occurs */
  onError?: (error: string) => void
  /** Callback when selection changes */
  onSelectionChange?: (selection: {
    selectedNodeIds: string[]
    selectedFloorId: string | null
    selectedZoneId: string | null
  }) => void
}

/**
 * SceneViewer - A standalone React component for viewing Pascal scenes.
 *
 * This component handles scene loading from URLs and provides a complete
 * 3D viewer with loading/error states.
 *
 * @example
 * ```tsx
 * import { SceneViewer } from '@pascal-app/viewer'
 *
 * function App() {
 *   return (
 *     <SceneViewer
 *       sceneUrl="https://example.com/scene.json"
 *       defaultZoom={80}
 *       onSelectionChange={(selection) => console.log(selection)}
 *     />
 *   )
 * }
 * ```
 */
export declare function SceneViewer(props: SceneViewerProps): React.JSX.Element

/**
 * Props for the Viewer component
 */
export interface ViewerProps {
  /** CSS class name for the canvas container */
  className?: string
  /** Initial zoom level for orthographic camera (default: 80) */
  defaultZoom?: number
  /** When true, posts selection changes to parent window for iframe embedding */
  isEmbedded?: boolean
  /** Initial wall mode for viewer */
  defaultWallMode?: WallMode
}

/**
 * Viewer - Low-level viewer component for advanced use cases.
 *
 * Use this when you need full control over the scene store initialization.
 * For most use cases, prefer SceneViewer which handles scene loading automatically.
 */
export declare function Viewer(props: ViewerProps): React.JSX.Element
