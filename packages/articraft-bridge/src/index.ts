// ─── Articraft Bridge — Public API ───────────────────────────────────────

export type {
  ArticraftJoint,
  ArticraftJointType,
  ArticraftLink,
  ArticraftMeshAsset,
  ArticraftModelData,
  ArticraftOrigin,
  ArticraftVisual,
  ArticraftVisualGeometry,
  GenerateOptions,
  SceneNodeResult,
  Vec3,
  Vec4,
} from './types'

export { generateModel, regenerateModel } from './cli'
export { convertToSceneNodes, createModelNodes } from './scene-converter'
