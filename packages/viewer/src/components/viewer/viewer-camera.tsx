import { OrthographicCamera, PerspectiveCamera } from "@react-three/drei"
import useViewer from "../../store/use-viewer"

export const ViewerCamera = () => {
  const cameraMode = useViewer((state) => state.cameraMode)
  return cameraMode === 'perspective' ? (
        <PerspectiveCamera far={1000} fov={50} makeDefault near={0.1} position={[10, 10, 10]} />
      ) : (
        <OrthographicCamera far={1000} makeDefault near={-1000} position={[10, 10, 10]} zoom={20} />
      )
}