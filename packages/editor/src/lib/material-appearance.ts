import type { MaterialGradient, MaterialProperties, MaterialSchema } from '@pascal-app/core'

export const DEFAULT_CUSTOM_MATERIAL_PROPERTIES: MaterialProperties = {
  color: '#ffffff',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  transparent: false,
  side: 'front',
}

export const DEFAULT_MATERIAL_GRADIENT: MaterialGradient = {
  type: 'linear',
  space: 'uv',
  axis: 'y',
  angle: 0,
  stops: [
    { offset: 0, color: '#ffffff', opacity: 1 },
    { offset: 1, color: '#4f46e5', opacity: 1 },
  ],
}

export function resolveMaterialProperties(value?: MaterialSchema): MaterialProperties {
  return {
    ...DEFAULT_CUSTOM_MATERIAL_PROPERTIES,
    ...value?.properties,
  }
}

export function materialHasTransparency(material?: MaterialSchema) {
  return Boolean(
    (material?.properties?.opacity ?? 1) < 1 ||
      material?.properties?.transparent ||
      material?.gradient?.stops.some((stop) => stop.opacity < 1),
  )
}

export function withMaterialProperties(
  material: MaterialSchema | undefined,
  updates: Partial<MaterialProperties>,
): MaterialSchema {
  const properties = {
    ...DEFAULT_CUSTOM_MATERIAL_PROPERTIES,
    ...material?.properties,
    ...updates,
  }
  return {
    ...material,
    preset: 'custom',
    properties: {
      ...properties,
      transparent:
        properties.opacity < 1 ||
        updates.transparent === true ||
        material?.gradient?.stops.some((stop) => stop.opacity < 1) === true,
    },
  }
}

export function getMaterialGradient(value?: MaterialSchema): MaterialGradient {
  return {
    ...DEFAULT_MATERIAL_GRADIENT,
    ...value?.gradient,
    stops:
      value?.gradient?.stops && value.gradient.stops.length >= 2
        ? value.gradient.stops
        : DEFAULT_MATERIAL_GRADIENT.stops,
  }
}

export function buildGradientPreview(gradient: MaterialGradient) {
  const stops = [...gradient.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((stop) => `${hexToRgba(stop.color, stop.opacity)} ${Math.round(stop.offset * 100)}%`)
    .join(', ')
  const angle = gradient.axis === 'x' ? 90 : gradient.axis === 'z' ? 135 : 0
  return `linear-gradient(${angle}deg, ${stops})`
}

export function getMaterialPreviewBackground(material?: MaterialSchema, fallbackColor = '#ffffff') {
  if (material?.gradient) return buildGradientPreview(getMaterialGradient(material))
  return material?.properties?.color ?? fallbackColor
}

function hexToRgba(hex: string, opacity = 1) {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#ffffff'
  const value = Number.parseInt(normalized.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
