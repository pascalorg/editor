import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { GRID_LAYER, OVERLAY_LAYER, ZONE_LAYER } from '../../lib/layers'
import useViewer from '../../store/use-viewer'
import { useSceneGroundReplacement } from './scene-ground-replacement'

export const ViewerCamera = ({ immersive = false }: { immersive?: boolean }) => {
  const cameraMode = useViewer((state) => state.cameraMode)
  // Exterior ground can include a coarse ocean horizon beyond the local terrain.
  const far = useSceneGroundReplacement() ? 20_000 : 1000

  if (immersive)
    return (
      <PerspectiveCamera
        far={10_000}
        fov={50}
        makeDefault
        near={0.001}
        ref={(camera) => {
          camera?.layers.enable(OVERLAY_LAYER)
          camera?.layers.enable(ZONE_LAYER)
          camera?.layers.enable(GRID_LAYER)
        }}
      />
    )

  return cameraMode === 'perspective' ? (
    <PerspectiveCamera far={far} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
  ) : (
    <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
  )
}
