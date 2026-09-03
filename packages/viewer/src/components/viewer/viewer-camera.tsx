import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Layers } from 'three'
import { GRID_LAYER, OVERLAY_LAYER, ZONE_LAYER } from '../../lib/layers'
import useViewer from '../../store/use-viewer'

const IMMERSIVE_XR_VISIBLE_LAYERS = [OVERLAY_LAYER, ZONE_LAYER, GRID_LAYER] as const

export function enableImmersiveXRViewLayers(cameraLayers: Layers, raycasterLayers: Layers) {
  const cameraMask = cameraLayers.mask
  const raycasterMask = raycasterLayers.mask
  for (const layer of IMMERSIVE_XR_VISIBLE_LAYERS) {
    cameraLayers.enable(layer)
    raycasterLayers.enable(layer)
  }
  return () => {
    cameraLayers.mask = cameraMask
    raycasterLayers.mask = raycasterMask
  }
}

function ImmersiveXRViewLayers({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera)
  const raycaster = useThree((state) => state.raycaster)

  useEffect(() => {
    if (!enabled) return
    return enableImmersiveXRViewLayers(camera.layers, raycaster.layers)
  }, [camera, enabled, raycaster])

  return null
}

export function viewerCameraClipping(immersiveXR: boolean) {
  return immersiveXR ? { far: 10_000, near: 0.001 } : { far: 1000, near: 0.1 }
}

export function applyViewerCameraClipping(
  camera: { far: number; near: number; updateProjectionMatrix(): void },
  immersiveXR: boolean,
) {
  const clipping = viewerCameraClipping(immersiveXR)
  camera.far = clipping.far
  camera.near = clipping.near
  camera.updateProjectionMatrix()
}

export function viewerUsesPerspectiveCamera(cameraMode: string, immersiveXR: boolean) {
  return immersiveXR || cameraMode === 'perspective'
}

export const ViewerCamera = ({ immersiveXR = false }: { immersiveXR?: boolean }) => {
  const cameraMode = useViewer((state) => state.cameraMode)
  const clipping = viewerCameraClipping(immersiveXR)

  return (
    <>
      {viewerUsesPerspectiveCamera(cameraMode, immersiveXR) ? (
        <PerspectiveCamera
          far={clipping.far}
          fov={50}
          makeDefault
          near={clipping.near}
          position={[10, 10, 10]}
        />
      ) : (
        <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
      )}
      <ImmersiveXRViewLayers enabled={immersiveXR} />
    </>
  )
}
