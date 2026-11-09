import { cameraPoseStore } from '../store/camera-pose-store'
import useEditor from '../store/use-editor'
import { getActiveBuildingPose } from './world-grid-snap'

const QUARTER_TURN = Math.PI / 2

/**
 * The yaw, local to the active building and snapped to 90°, that turns a node's
 * front (local +Z) toward the camera — the view a placement starts from. Falls
 * back to the synced plan azimuth when the camera looks straight down, and to 0
 * before any view has been published.
 */
export function cameraFacingYaw(): number {
  const pose = cameraPoseStore.getState().pose
  let azimuth = useEditor.getState().navigationSyncPose?.azimuth ?? 0
  if (pose) {
    const dx = pose.position[0] - pose.target[0]
    const dz = pose.position[2] - pose.target[2]
    if (Math.hypot(dx, dz) > 1e-6) azimuth = Math.atan2(dx, dz)
  }
  const local = azimuth - (getActiveBuildingPose()?.rotationY ?? 0)
  const quarter = (((Math.round(local / QUARTER_TURN) % 4) + 4) % 4) as 0 | 1 | 2 | 3
  return quarter * QUARTER_TURN
}
