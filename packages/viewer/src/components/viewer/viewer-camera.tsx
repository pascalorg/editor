import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import useViewer from '../../store/use-viewer'
import { useSceneGroundReplacement } from './scene-ground-replacement'

export const ViewerCamera = () => {
  const cameraMode = useViewer((state) => state.cameraMode)
  // Exterior ground can include a coarse ocean horizon beyond the local terrain.
  const far = useSceneGroundReplacement() ? 20_000 : 1000

  return cameraMode === 'perspective' ? (
    <PerspectiveCamera far={far} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
  ) : (
    <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
  )
}
