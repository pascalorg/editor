// Server-safe scene migrations shared by the client loader and the hosted
// scene authority. Everything exported here must stay pure data logic with no
// store, React, or Three.js imports so it can run in Server Components and
// API routes.
export { type HealSceneResult, healSceneNodes } from './heal-scene-graph'
export {
  type RetiredSceneNodeMigration,
  removeRetiredDrawingSheetNodes,
} from './retired-scene-nodes'
export {
  migrateVerticalSceneNodes,
  type VerticalSceneMigration,
} from './vertical-scene-migration'
