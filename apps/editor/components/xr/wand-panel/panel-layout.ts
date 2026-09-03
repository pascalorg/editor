export const XR_WAND_PANEL_LAYOUT = {
  faceRadius: 0.076,
  faceScale: 0.2925,
  faceWidth: 0.82,
  faceHeight: 1.04,
  faceCornerRadius: 0.05,
  faceAngles: [0, 120, 240] as const,
  attachment: {
    gripAxisOffset: -0.085,
    gripScale: 0.66,
    handSpace: 'middle-finger-metacarpal' as const,
    handPosition: [0, -0.01, -0.05] as [number, number, number],
    handRotation: [-0.2, 0, Math.PI] as [number, number, number],
    handScale: 0.85,
  },
} as const

export const XR_WAND_PANEL_INPUT_NAME = 'xr-editor-wand-panel'

export function resolveWandPanelFacePose(index: number, handedness: XRHandedness = 'left') {
  const angleDegrees = XR_WAND_PANEL_LAYOUT.faceAngles[index] ?? 0
  const angle = (angleDegrees * Math.PI) / 180
  const mirror = handedness === 'right' ? -1 : 1
  const radialX = Math.sin(angle) * mirror
  return {
    position: [
      radialX * XR_WAND_PANEL_LAYOUT.faceRadius,
      Math.cos(angle) * XR_WAND_PANEL_LAYOUT.faceRadius,
      0,
    ] as [number, number, number],
    rotation: [-Math.PI / 2, Math.atan2(radialX, Math.cos(angle)), 0] as [number, number, number],
  }
}

export function getPage<T>(items: readonly T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(Math.max(0, page), pageCount - 1)
  return {
    currentPage,
    pageCount,
    items: items.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
  }
}

export function getPageWithPinnedFirst<T>(items: readonly T[], page: number, pageSize: number) {
  const pinned = items[0]
  const current = getPage(items.slice(1), page, Math.max(1, pageSize - 1))
  return {
    ...current,
    items: pinned === undefined ? current.items : [pinned, ...current.items],
  }
}
