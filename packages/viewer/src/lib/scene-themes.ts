import type { SurfaceRole } from '@pascal-app/core'

export type SceneTheme = {
  id: string
  name: string
  // Drives the 2D scene chrome that used to follow the removed light/dark toggle:
  // canvas backdrop, grid line colours, measurement-label/cursor contrast, and
  // the site ground fill. The 3D background + lights come from the fields below.
  appearance: 'light' | 'dark'
  background: string
  // Colour of the site ground fill + infinite ground-occluder plane. Kept
  // separate from `background` so dark themes can have a lit ground that reads
  // as ground rather than going near-black.
  ground: string
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
    appearance: 'light',
    background: '#ffffff',
    ground: '#f4f4f2',
    ambient: { color: '#ffffff', intensity: 0.15 },
    hemi: { sky: '#ffffff', ground: '#aaa49a', intensity: 0.6 },
    lights: [
      { position: [10, 10, 10], color: '#ffffff', intensity: 4, castShadow: true },
      { position: [-10, 10, -10], color: '#ffffff', intensity: 0.75 },
    ],
    toneMappingExposure: 0.9,
    clayTints: {
      wall: '#e9e5db',
      floor: '#d8d2c4',
      ceiling: '#f1ede4',
      roof: '#c4bba6',
      glazing: '#cdd8df',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    appearance: 'light',
    background: '#ede9df',
    ground: '#e7e1d3',
    ambient: { color: '#fff9eb', intensity: 0.55 },
    hemi: { sky: '#fff5d9', ground: '#c2b89c', intensity: 0.35 },
    lights: [
      { position: [16, 22, 12], color: '#fff1c8', intensity: 2.6, castShadow: true },
      { position: [-14, 10, -6], color: '#dde5ff', intensity: 0.35 },
    ],
    toneMappingExposure: 1,
    clayTints: {
      wall: '#efe9da',
      floor: '#ddd4bf',
      ceiling: '#f5efe0',
      roof: '#b9b09a',
      glazing: '#cdd5d8',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    appearance: 'light',
    background: '#f6e8d4',
    ground: '#ecd9bf',
    ambient: { color: '#ffd9a8', intensity: 0.45 },
    hemi: { sky: '#ffd9a8', ground: '#5b4634', intensity: 0.4 },
    lights: [
      { position: [22, 8, 8], color: '#ffb070', intensity: 3.4, castShadow: true },
      { position: [-14, 16, -10], color: '#a4b8ff', intensity: 0.4 },
    ],
    toneMappingExposure: 1,
    clayTints: {
      wall: '#f3e3cf',
      floor: '#e2cdab',
      ceiling: '#f6e7d2',
      roof: '#a6764f',
      glazing: '#e7c9a8',
    },
  },
  {
    id: 'overcast',
    name: 'Overcast',
    appearance: 'light',
    background: '#e6e7e6',
    ground: '#dadcd9',
    ambient: { color: '#eef0ef', intensity: 1.1 },
    hemi: { sky: '#f4f5f3', ground: '#bcbfbb', intensity: 0.9 },
    lights: [{ position: [12, 28, 10], color: '#f4f5f3', intensity: 0.8, castShadow: true }],
    toneMappingExposure: 0.95,
    clayTints: {
      wall: '#dedfdc',
      floor: '#cdcec9',
      ceiling: '#e8e9e6',
      roof: '#a3a49e',
      glazing: '#c6cdd0',
    },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    appearance: 'light',
    background: '#dde6ef',
    ground: '#c9d6e6',
    ambient: { color: '#cfdcec', intensity: 0.7 },
    hemi: { sky: '#dfeaf6', ground: '#5b6b80', intensity: 0.55 },
    lights: [
      { position: [16, 24, 12], color: '#e6efff', intensity: 1.8, castShadow: true },
      { position: [-12, 10, -8], color: '#9fb6d8', intensity: 0.4 },
    ],
    toneMappingExposure: 0.95,
    clayTints: {
      wall: '#9fb6d2',
      floor: '#8ba2c2',
      ceiling: '#aec0d8',
      roof: '#5f789b',
      glazing: '#b6d7ea',
    },
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    appearance: 'light',
    background: '#bdd6e8',
    ground: '#ddd2bb',
    ambient: { color: '#d6e6f3', intensity: 0.5 },
    hemi: { sky: '#a8c8e2', ground: '#d8c9a4', intensity: 0.6 },
    lights: [
      { position: [18, 20, 12], color: '#fff4d4', intensity: 3.6, castShadow: true },
      { position: [-12, 8, -8], color: '#8fb3d8', intensity: 0.7 },
    ],
    toneMappingExposure: 0.9,
    clayTints: {
      wall: '#f6f1e6',
      floor: '#e0d6c2',
      ceiling: '#f3ede0',
      roof: '#3e6585',
      glazing: '#bcd3e2',
    },
  },
  {
    id: 'twilight',
    name: 'Twilight',
    appearance: 'dark',
    background: '#3a3550',
    ground: '#4a4566',
    ambient: { color: '#a89cc8', intensity: 0.35 },
    hemi: { sky: '#d8a8c0', ground: '#1c1830', intensity: 0.5 },
    lights: [
      { position: [-14, 22, -10], color: '#a4b6e8', intensity: 1.4, castShadow: true },
      { position: [14, 6, 8], color: '#ffb070', intensity: 0.9 },
    ],
    toneMappingExposure: 1.1,
    clayTints: {
      wall: '#c5b9cf',
      floor: '#ad9fbb',
      ceiling: '#d2c6dc',
      roof: '#5b4f74',
      glazing: '#c3b6d4',
    },
  },
  {
    id: 'night',
    name: 'Night',
    appearance: 'dark',
    background: '#1f2433',
    ground: '#2b3247',
    ambient: { color: '#a0b0ff', intensity: 0.07 },
    hemi: { sky: '#3a4666', ground: '#0e111c', intensity: 0.4 },
    lights: [
      { position: [10, 10, 10], color: '#e0e5ff', intensity: 0.8, castShadow: true },
      { position: [-10, 10, -10], color: '#8090ff', intensity: 0.2 },
    ],
    toneMappingExposure: 0.9,
    clayTints: {
      wall: '#aab3c6',
      floor: '#98a1b5',
      ceiling: '#b7bfd0',
      roof: '#5b6680',
      glazing: '#aebbd0',
    },
  },
  {
    id: 'verdant',
    name: 'Verdant',
    appearance: 'light',
    background: '#d6e4d2',
    ground: '#c7d6b4',
    ambient: { color: '#e3efdd', intensity: 0.5 },
    hemi: { sky: '#cfe6cf', ground: '#8ea06f', intensity: 0.65 },
    lights: [
      { position: [16, 22, 12], color: '#fff6d8', intensity: 3, castShadow: true },
      { position: [-12, 10, -8], color: '#bfe0c2', intensity: 0.5 },
    ],
    toneMappingExposure: 0.95,
    clayTints: {
      wall: '#eef0e6',
      floor: '#d8ddc6',
      ceiling: '#f1f3ea',
      roof: '#6f8a5a',
      glazing: '#c4dcd0',
    },
  },
]

export const SCENE_THEME_IDS = SCENE_THEMES.map((theme) => theme.id)

const SCENE_THEME_BY_ID = new Map(SCENE_THEMES.map((theme) => [theme.id, theme]))

export function getSceneTheme(id: string): SceneTheme {
  return SCENE_THEME_BY_ID.get(id) ?? SCENE_THEMES[0]!
}
