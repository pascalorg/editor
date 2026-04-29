export type SmartHomePanelSize = {
  height: number
  width: number
}

export type SmartHomePanelResizeStart = SmartHomePanelSize & {
  startX: number
  startY: number
}

export type DeviceGroupColor = {
  background: string
  border: string
  dot: string
}

export const PLACEMENT_PILL_CLOSED_MIN_WIDTH = 56
const PLACEMENT_PILL_CLOSED_MAX_WIDTH = 240
const PLACEMENT_PILL_CLOSED_CHAR_WIDTH = 7.2
export const PLACEMENT_PILL_HEIGHT = 32
export const PLACEMENT_PILL_GAP = 16
export const PLACEMENT_LINE_GAP = 4
export const DEVICE_GROUP_CHIP_WIDTH = 112
export const DEVICE_GROUP_CHIP_HEIGHT = 34
export const DEVICE_GROUP_CELL_WIDTH = 140
export const DEVICE_GROUP_CELL_HEIGHT = 48
export const DEVICE_GRID_MIN_COLUMNS = 3
const DEVICE_GRID_MAX_COLUMNS = 5
export const DEVICE_SECTION_SCROLL_BOTTOM_SAFE_AREA = 28
export const SMART_HOME_PANEL_DEFAULT_WIDTH = 400
export const SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT = 196
export const SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT = 340
export const SMART_HOME_PANEL_DEFAULT_HEIGHT = SMART_HOME_PANEL_COLLAPSED_MIN_HEIGHT
const SMART_HOME_PANEL_MIN_WIDTH = 320
const SMART_HOME_PANEL_VIEWPORT_MARGIN_X = 32
const SMART_HOME_PANEL_TOP_OFFSET = 64
const SMART_HOME_PANEL_BOTTOM_MARGIN_MIN = 16
const SMART_HOME_PANEL_BOTTOM_MARGIN_RATIO = 0.15

const DEVICE_GROUP_COLORS: DeviceGroupColor[] = [
  { background: '#efd98d', border: '#d09b23', dot: '#efd98d' },
  { background: '#bee9f2', border: '#46a9bd', dot: '#bee9f2' },
  { background: '#bfe7d7', border: '#55ad8d', dot: '#bfe7d7' },
  { background: '#cddff8', border: '#6f98dc', dot: '#cddff8' },
  { background: '#f0cfe4', border: '#d675aa', dot: '#f0cfe4' },
  { background: '#dbd0f1', border: '#9b79d5', dot: '#dbd0f1' },
  { background: '#efcece', border: '#d16f6f', dot: '#efcece' },
  { background: '#c8e8e1', border: '#62aaa0', dot: '#c8e8e1' },
]

export function getDeviceGroupColor(index: number) {
  return DEVICE_GROUP_COLORS[index % DEVICE_GROUP_COLORS.length]!
}

export function getSnakeGridCoordinate(index: number, columns: number) {
  const y = Math.floor(index / columns)
  const offset = index % columns
  const x = y % 2 === 0 ? offset : columns - 1 - offset

  return { x, y }
}

export function getDeviceGridColumns(totalCells: number, availableColumns: number) {
  const cappedAvailableColumns = Math.max(
    DEVICE_GRID_MIN_COLUMNS,
    Math.min(DEVICE_GRID_MAX_COLUMNS, availableColumns),
  )
  const candidates = Array.from(
    { length: cappedAvailableColumns - DEVICE_GRID_MIN_COLUMNS + 1 },
    (_, index) => DEVICE_GRID_MIN_COLUMNS + index,
  )
  const exactCandidates = candidates.filter((columns) => totalCells % columns === 0)

  if (exactCandidates.length > 0) {
    return exactCandidates[exactCandidates.length - 1]!
  }

  return candidates.reduce((bestColumns, columns) => {
    const bestWaste = (bestColumns - (totalCells % bestColumns)) % bestColumns
    const waste = (columns - (totalCells % columns)) % columns
    if (waste !== bestWaste) {
      return waste < bestWaste ? columns : bestColumns
    }

    return columns > bestColumns ? columns : bestColumns
  }, candidates[0]!)
}

export function getDeviceGroupBorderPath(coordinates: Array<{ x: number; y: number }>) {
  const occupiedCells = new Set(coordinates.map((coordinate) => `${coordinate.x}:${coordinate.y}`))
  const borderSegments = coordinates.flatMap((coordinate) => {
    const x = coordinate.x * DEVICE_GROUP_CELL_WIDTH
    const y = coordinate.y * DEVICE_GROUP_CELL_HEIGHT
    const right = x + DEVICE_GROUP_CELL_WIDTH
    const bottom = y + DEVICE_GROUP_CELL_HEIGHT
    const segments: string[] = []

    if (!occupiedCells.has(`${coordinate.x}:${coordinate.y - 1}`)) {
      segments.push(`M${x} ${y}L${right} ${y}`)
    }
    if (!occupiedCells.has(`${coordinate.x + 1}:${coordinate.y}`)) {
      segments.push(`M${right} ${y}L${right} ${bottom}`)
    }
    if (!occupiedCells.has(`${coordinate.x}:${coordinate.y + 1}`)) {
      segments.push(`M${right} ${bottom}L${x} ${bottom}`)
    }
    if (!occupiedCells.has(`${coordinate.x - 1}:${coordinate.y}`)) {
      segments.push(`M${x} ${bottom}L${x} ${y}`)
    }

    return segments
  })

  return borderSegments.join('')
}

export function getPlacementPillWidth(label: string) {
  const normalizedLabel = label.trim() || 'Group'
  const estimatedWidth = 24 + normalizedLabel.length * PLACEMENT_PILL_CLOSED_CHAR_WIDTH
  return Math.max(
    PLACEMENT_PILL_CLOSED_MIN_WIDTH,
    Math.min(PLACEMENT_PILL_CLOSED_MAX_WIDTH, estimatedWidth),
  )
}

export function clampSmartHomePanelSize(
  size: SmartHomePanelSize,
  minHeight = SMART_HOME_PANEL_EXPANDED_MIN_HEIGHT,
): SmartHomePanelSize {
  const bottomMargin =
    typeof window === 'undefined'
      ? SMART_HOME_PANEL_BOTTOM_MARGIN_MIN
      : Math.max(
          SMART_HOME_PANEL_BOTTOM_MARGIN_MIN,
          Math.ceil(window.innerHeight * SMART_HOME_PANEL_BOTTOM_MARGIN_RATIO),
        )
  const maxWidth =
    typeof window === 'undefined'
      ? 960
      : Math.max(SMART_HOME_PANEL_MIN_WIDTH, window.innerWidth - SMART_HOME_PANEL_VIEWPORT_MARGIN_X)
  const maxHeight =
    typeof window === 'undefined'
      ? 760
      : Math.max(minHeight, window.innerHeight - SMART_HOME_PANEL_TOP_OFFSET - bottomMargin)

  return {
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
    width: Math.min(maxWidth, Math.max(SMART_HOME_PANEL_MIN_WIDTH, size.width)),
  }
}

export function getSmartHomeSectionOverflow(sectionBody: HTMLElement) {
  const sectionRect = sectionBody.getBoundingClientRect()
  const scrollOverflow = Math.max(0, sectionBody.scrollHeight - sectionBody.clientHeight)
  const nestedScrollOverflow = Array.from(
    sectionBody.querySelectorAll<HTMLElement>('[data-smart-home-scroll-body]'),
  ).reduce(
    (totalOverflow, element) =>
      totalOverflow + Math.max(0, element.scrollHeight - element.clientHeight),
    0,
  )
  const contentBottom = Array.from(sectionBody.querySelectorAll<HTMLElement>('*')).reduce(
    (bottom, element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        return bottom
      }

      return Math.max(bottom, rect.bottom)
    },
    sectionRect.bottom,
  )

  return Math.max(
    scrollOverflow,
    nestedScrollOverflow,
    Math.max(0, contentBottom - sectionRect.bottom),
  )
}
