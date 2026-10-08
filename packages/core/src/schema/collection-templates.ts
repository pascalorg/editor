/** Collections a scene commonly needs, each with its default name and colour. */
export const COLLECTION_TEMPLATES = {
  lights: { name: 'Lights', color: '#f5b83d' },
  windows: { name: 'Windows', color: '#5aa9e6' },
  doors: { name: 'Doors', color: '#a0714f' },
  electrical: { name: 'Electrical', color: '#e5533d' },
  plumbing: { name: 'Plumbing', color: '#2f80c2' },
  framing: { name: 'Framing', color: '#c9a36a' },
  masonry: { name: 'Masonry', color: '#b5653f' },
  roof: { name: 'Roof', color: '#6b6f7a' },
  cabinetry: { name: 'Cabinetry', color: '#8a6bbf' },
  'kitchen-cabinetry': { name: 'Kitchen cabinetry', color: '#4fae7f' },
} as const

export type CollectionTemplateId = keyof typeof COLLECTION_TEMPLATES

export const COLLECTION_TEMPLATE_IDS = Object.keys(COLLECTION_TEMPLATES) as [
  CollectionTemplateId,
  ...CollectionTemplateId[],
]
