import type { SurfaceRole } from '@pascal-app/core'

export type SceneTheme = {
  id: string
  name: string
  background: string
  ambient: { color: string; intensity: number }
  hemi?: { sky: string; ground: string; intensity: number }
  lights: Array<{
    position: [number, number, number]
    color: string
    intensity: number
    castShadow?: boolean
  }>
  toneMappingExposure: number
  clayTints?: Partial<Record<SurfaceRole, string>>
}

export const SCENE_THEMES: SceneTheme[] = [
  {
    id: 'studio',
    name: 'Studio',
    background: '#ffffff',
    ambient: { color: '#ffffff', intensity: 0.15 },
    hemi: { sky: '#ffffff', ground: '#aaa49a', intensity: 0.6 },
    lights: [
      { position: [10, 10, 10], color: '#ffffff', intensity: 4, castShadow: true },
      { position: [-10, 10, -10], color: '#ffffff', intensity: 0.75 },
    ],
    toneMappingExposure: 0.9,
  },
  {
    id: 'paper',
    name: 'Paper',
    background: '#ede9df',
    ambient: { color: '#fff9eb', intensity: 0.55 },
    hemi: { sky: '#fff5d9', ground: '#c2b89c', intensity: 0.35 },
    lights: [
      { position: [16, 22, 12], color: '#fff1c8', intensity: 2.6, castShadow: true },
      { position: [-14, 10, -6], color: '#dde5ff', intensity: 0.35 },
    ],
    toneMappingExposure: 1,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    background: '#f6e8d4',
    ambient: { color: '#ffd9a8', intensity: 0.45 },
    hemi: { sky: '#ffd9a8', ground: '#5b4634', intensity: 0.4 },
    lights: [
      { position: [22, 8, 8], color: '#ffb070', intensity: 3.4, castShadow: true },
      { position: [-14, 16, -10], color: '#a4b8ff', intensity: 0.4 },
    ],
    toneMappingExposure: 1,
  },
  {
    id: 'overcast',
    name: 'Overcast',
    background: '#e6e7e6',
    ambient: { color: '#eef0ef', intensity: 1.1 },
    hemi: { sky: '#f4f5f3', ground: '#bcbfbb', intensity: 0.9 },
    lights: [{ position: [12, 28, 10], color: '#f4f5f3', intensity: 0.8, castShadow: true }],
    toneMappingExposure: 0.95,
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    background: '#dde6ef',
    ambient: { color: '#cfdcec', intensity: 0.7 },
    hemi: { sky: '#dfeaf6', ground: '#5b6b80', intensity: 0.55 },
    lights: [
      { position: [16, 24, 12], color: '#e6efff', intensity: 1.8, castShadow: true },
      { position: [-12, 10, -8], color: '#9fb6d8', intensity: 0.4 },
    ],
    toneMappingExposure: 0.95,
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    background: '#bdd6e8',
    ambient: { color: '#d6e6f3', intensity: 0.5 },
    hemi: { sky: '#a8c8e2', ground: '#d8c9a4', intensity: 0.6 },
    lights: [
      { position: [18, 20, 12], color: '#fff4d4', intensity: 3.6, castShadow: true },
      { position: [-12, 8, -8], color: '#8fb3d8', intensity: 0.7 },
    ],
    toneMappingExposure: 0.9,
  },
  {
    id: 'twilight',
    name: 'Twilight',
    background: '#3a3550',
    ambient: { color: '#a89cc8', intensity: 0.35 },
    hemi: { sky: '#d8a8c0', ground: '#1c1830', intensity: 0.5 },
    lights: [
      { position: [-14, 22, -10], color: '#a4b6e8', intensity: 1.4, castShadow: true },
      { position: [14, 6, 8], color: '#ffb070', intensity: 0.9 },
    ],
    toneMappingExposure: 1.1,
  },
  {
    id: 'night',
    name: 'Night',
    background: '#1f2433',
    ambient: { color: '#a0b0ff', intensity: 0.07 },
    hemi: { sky: '#3a4666', ground: '#0e111c', intensity: 0.4 },
    lights: [
      { position: [10, 10, 10], color: '#e0e5ff', intensity: 0.8, castShadow: true },
      { position: [-10, 10, -10], color: '#8090ff', intensity: 0.2 },
    ],
    toneMappingExposure: 0.9,
  },
]

export const SCENE_THEME_IDS = SCENE_THEMES.map((theme) => theme.id)

const SCENE_THEME_BY_ID = new Map(SCENE_THEMES.map((theme) => [theme.id, theme]))

export function getSceneTheme(id: string): SceneTheme {
  return SCENE_THEME_BY_ID.get(id) ?? SCENE_THEMES[0]!
}
