import type { CurtainGrid, CurtainPanelType, CurtainWallConfig, DoorNode } from '@pascal-app/core'

export function curtainGridPositions(length: number, grid: CurtainGrid): number[] {
  if (!Number.isFinite(length) || length <= 0) return [0]
  const count = grid.layout === 'count' ? grid.count : Math.ceil(length / grid.spacing)
  const bounded = Math.max(1, Math.min(32, count))
  if (grid.layout !== 'fixed-spacing' || count > 32) {
    return Array.from({ length: bounded + 1 }, (_, index) => (length * index) / bounded)
  }
  const whole = Math.floor(length / grid.spacing)
  const remainder = length - whole * grid.spacing
  const offset =
    grid.alignment === 'start' ? 0 : grid.alignment === 'end' ? remainder : remainder / 2
  const positions = [0]
  for (let index = 0; index <= whole; index++) {
    const value = offset + index * grid.spacing
    if (value > 1e-6 && value < length - 1e-6) positions.push(value)
  }
  positions.push(length)
  // A centered remainder can introduce two edge cells.
  return positions.length <= 33
    ? positions
    : Array.from({ length: 33 }, (_, i) => (length * i) / 32)
}

export type CurtainWallPiece = {
  left: number
  right: number
  bottom: number
  top: number
  front: number
  back: number
  role: 'frame' | 'glass' | 'solid'
}

export function curtainPanelType(
  config: CurtainWallConfig,
  column: number,
  row: number,
  rowCount: number,
): CurtainPanelType {
  const override = config.panels.find((panel) => panel.column === column && panel.row === row)
  if (override) return override.type
  if (
    (config.spandrel === 'bottom' && row === 0) ||
    (config.spandrel === 'top' && row === rowCount - 1)
  )
    return 'solid'
  return config.panelType
}

export function buildCurtainWallLayout(
  length: number,
  height: number,
  depth: number,
  config: CurtainWallConfig,
  openings: readonly (Pick<DoorNode, 'position' | 'width' | 'height' | 'openingShape'> & {
    type: 'door' | 'window'
  })[] = [],
  baseElevation = 0,
): CurtainWallPiece[] {
  if (length <= 1e-6 || height <= 1e-6 || depth <= 0) return []
  const xs = curtainGridPositions(length, config.columns)
  const ys = curtainGridPositions(height, config.rows)
  const pieces: CurtainWallPiece[] = []
  const panelDepth = Math.min(config.glassThickness, depth * 0.45)
  const panelFront = depth / 2 - Math.min(0.005, depth * 0.05)
  const panelBack = panelFront - panelDepth
  const add = (
    left: number,
    right: number,
    bottom: number,
    top: number,
    front: number,
    role: CurtainWallPiece['role'],
    back = -depth / 2,
  ) => {
    if (right - left > 1e-6 && top - bottom > 1e-6 && front - back > 1e-6)
      pieces.push({ left, right, bottom, top, front, back, role })
  }
  const verticalCap = config.framing === 'capped' || config.framing === 'vertical-caps'
  const horizontalCap = config.framing === 'capped' || config.framing === 'horizontal-caps'
  if (config.construction === 'stick') {
    const verticalBounds = xs.map((x, index): [number, number] => {
      if (index === 0) return [0, Math.min(config.perimeterWidth, (xs[1]! - x) * 0.4)]
      if (index === xs.length - 1)
        return [length - Math.min(config.perimeterWidth, (x - xs[index - 1]!) * 0.4), length]
      return [
        x - Math.min(config.mullionWidth / 2, (x - xs[index - 1]!) * 0.4),
        x + Math.min(config.mullionWidth / 2, (xs[index + 1]! - x) * 0.4),
      ]
    })
    const horizontalBounds = ys.map((y, index): [number, number] => {
      if (index === 0) return [0, Math.min(config.perimeterWidth, (ys[1]! - y) * 0.4)]
      if (index === ys.length - 1)
        return [height - Math.min(config.perimeterWidth, (y - ys[index - 1]!) * 0.4), height]
      return [
        y - Math.min(config.transomWidth / 2, (y - ys[index - 1]!) * 0.4),
        y + Math.min(config.transomWidth / 2, (ys[index + 1]! - y) * 0.4),
      ]
    })

    for (const [left, right] of verticalBounds)
      add(left, right, 0, height, verticalCap ? depth / 2 : panelBack, 'frame')
    for (const [bottom, top] of horizontalBounds) {
      for (let column = 0; column < xs.length - 1; column++) {
        add(
          verticalBounds[column]![1],
          verticalBounds[column + 1]![0],
          bottom,
          top,
          horizontalCap ? depth / 2 : panelBack,
          'frame',
        )
      }
    }

    for (let column = 0; column < xs.length - 1; column++) {
      for (let row = 0; row < ys.length - 1; row++) {
        const type = curtainPanelType(config, column, row, ys.length - 1)
        if (type === 'empty') continue
        add(
          verticalBounds[column]![1],
          verticalBounds[column + 1]![0],
          horizontalBounds[row]![1],
          horizontalBounds[row + 1]![0],
          panelFront,
          type,
          panelBack,
        )
      }
    }
  } else {
    for (let column = 0; column < xs.length - 1; column++) {
      for (let row = 0; row < ys.length - 1; row++) {
        const x0 = xs[column]!,
          x1 = xs[column + 1]!,
          y0 = ys[row]!,
          y1 = ys[row + 1]!
        const gap =
          config.construction === 'unitized'
            ? Math.min(config.jointWidth / 2, (x1 - x0) / 10, (y1 - y0) / 10)
            : 0
        const left = x0 + (column === 0 ? 0 : gap),
          right = x1 - (column === xs.length - 2 ? 0 : gap)
        const bottom = y0 + (row === 0 ? 0 : gap),
          top = y1 - (row === ys.length - 2 ? 0 : gap)
        const lw = Math.min(
          column === 0 ? config.perimeterWidth : config.mullionWidth / 2,
          (right - left) * 0.4,
        )
        const rw = Math.min(
          column === xs.length - 2 ? config.perimeterWidth : config.mullionWidth / 2,
          (right - left) * 0.4,
        )
        const bw = Math.min(
          row === 0 ? config.perimeterWidth : config.transomWidth / 2,
          (top - bottom) * 0.4,
        )
        const tw = Math.min(
          row === ys.length - 2 ? config.perimeterWidth : config.transomWidth / 2,
          (top - bottom) * 0.4,
        )
        add(left, left + lw, bottom, top, verticalCap ? depth / 2 : panelBack, 'frame')
        add(right - rw, right, bottom, top, verticalCap ? depth / 2 : panelBack, 'frame')
        add(
          left + lw,
          right - rw,
          bottom,
          bottom + bw,
          horizontalCap ? depth / 2 : panelBack,
          'frame',
        )
        add(left + lw, right - rw, top - tw, top, horizontalCap ? depth / 2 : panelBack, 'frame')
        const type = curtainPanelType(config, column, row, ys.length - 1)
        if (type === 'empty') continue
        const joint = Math.min(config.jointWidth / 2, (right - left) * 0.1, (top - bottom) * 0.1)
        add(
          left + (verticalCap ? lw : joint),
          right - (verticalCap ? rw : joint),
          bottom + (horizontalCap ? bw : joint),
          top - (horizontalCap ? tw : joint),
          panelFront,
          type,
          panelBack,
        )
      }
    }
  }
  let fitted = pieces
  for (const opening of openings) {
    if (opening.openingShape !== 'rectangle') continue
    const left = opening.position[0] - opening.width / 2
    const right = opening.position[0] + opening.width / 2
    const bottom = opening.position[1] - opening.height / 2 - baseElevation
    const top = bottom + opening.height
    if (right <= 0 || left >= length || top <= 0 || bottom >= height) continue
    const outerLeft = Math.max(0, left - config.perimeterWidth)
    const outerRight = Math.min(length, right + config.perimeterWidth)
    const outerBottom = Math.max(
      0,
      bottom - (opening.type === 'window' ? config.perimeterWidth : 0),
    )
    const outerTop = Math.min(height, top + config.perimeterWidth)
    // Replace intersecting infill and grid members with a continuous entrance subframe.
    fitted = fitted.flatMap((piece) => {
      const x0 = Math.max(piece.left, outerLeft)
      const x1 = Math.min(piece.right, outerRight)
      const y0 = Math.max(piece.bottom, outerBottom)
      const y1 = Math.min(piece.top, outerTop)
      if (x1 <= x0 || y1 <= y0) return [piece]
      return [
        { ...piece, right: x0 },
        { ...piece, left: x1 },
        { ...piece, left: x0, right: x1, top: y0 },
        { ...piece, left: x0, right: x1, bottom: y1 },
      ].filter((part) => part.right - part.left > 1e-6 && part.top - part.bottom > 1e-6)
    })
    const frame = { front: depth / 2, back: -depth / 2, role: 'frame' as const }
    fitted.push(
      ...[
        ...(opening.type === 'window'
          ? [
              {
                ...frame,
                left: Math.max(0, left),
                right: Math.min(length, right),
                bottom: outerBottom,
                top: Math.min(height, bottom),
              },
            ]
          : []),
        {
          ...frame,
          left: outerLeft,
          right: Math.min(length, left),
          bottom: outerBottom,
          top: outerTop,
        },
        {
          ...frame,
          left: Math.max(0, right),
          right: outerRight,
          bottom: outerBottom,
          top: outerTop,
        },
        {
          ...frame,
          left: Math.max(0, left),
          right: Math.min(length, right),
          bottom: Math.max(0, top),
          top: outerTop,
        },
      ].filter((part) => part.right - part.left > 1e-6 && part.top - part.bottom > 1e-6),
    )
  }
  return fitted
}
