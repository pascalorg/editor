import { getSceneTheme } from '../lib/scene-themes'

export function immersiveXRBackgroundColor(sceneTheme: string) {
  return getSceneTheme(sceneTheme).background
}
