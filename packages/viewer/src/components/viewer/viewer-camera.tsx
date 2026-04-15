import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import useViewer from '../../store/use-viewer'

// Orbit FOV — a photographic ~50° framing used for the default
// outside-looking-in view. Walkthrough FOV lives in useViewer state
// (walkthroughFov) because it's user-adjustable at runtime via the
// WalkthroughFovSlider.
const ORBIT_FOV = 50

export const ViewerCamera = () => {
  const cameraMode = useViewer((state) => state.cameraMode)
  const walkthroughMode = useViewer((state) => state.walkthroughMode)
  const walkthroughFov = useViewer((state) => state.walkthroughFov)

  return cameraMode === 'perspective' ? (
    <PerspectiveCamera
      far={1000}
      fov={walkthroughMode ? walkthroughFov : ORBIT_FOV}
      makeDefault
      near={0.1}
      position={[10, 10, 10]}
    />
  ) : (
    <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
  )
}
