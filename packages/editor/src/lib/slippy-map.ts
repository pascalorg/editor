/**
 * Slippy-map arithmetic — the Web Mercator tile scheme every raster tile
 * server uses.
 *
 * Pure functions, no dependencies and no DOM. Written out rather than pulled
 * from Leaflet or MapLibre because the map here is a *location picker*, not a
 * map: a few hundred bytes of arithmetic beats adding a mapping library to a
 * package that embedders install.
 */

export type LonLat = { longitude: number; latitude: number }

/** Fractional tile coordinates — the integer part is the tile, the rest is the offset inside it. */
export type TilePoint = { x: number; y: number }

export const TILE_SIZE = 256
export const MIN_ZOOM = 1
export const MAX_ZOOM = 19

/**
 * Web Mercator cannot represent the poles, and clamps at ±85.0511° — the
 * latitude where the projection turns square.
 */
export const MAX_LATITUDE = 85.05112878

export const clampLatitude = (latitude: number): number =>
  Math.min(MAX_LATITUDE, Math.max(-MAX_LATITUDE, latitude))

/**
 * Wrap into `[-180, 180)` so panning past the date line keeps working.
 *
 * The two spellings of the anti-meridian collapse to `-180`, which is the
 * convention every mapping library uses — and the one that makes the world's
 * left edge read as its left edge.
 */
export function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

export const clampZoom = (zoom: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))

export function lonLatToTile({ longitude, latitude }: LonLat, zoom: number): TilePoint {
  const scale = 2 ** zoom
  const lat = clampLatitude(latitude) * (Math.PI / 180)
  return {
    x: ((wrapLongitude(longitude) + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  }
}

export function tileToLonLat({ x, y }: TilePoint, zoom: number): LonLat {
  const scale = 2 ** zoom
  const n = Math.PI - (2 * Math.PI * y) / scale
  return {
    longitude: wrapLongitude((x / scale) * 360 - 180),
    latitude: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  }
}

export type TileRef = {
  /** Tile index, already wrapped in X so panning across the date line loads real tiles. */
  x: number
  y: number
  zoom: number
  /** Where the tile's top-left corner sits in the viewport, in CSS pixels. */
  left: number
  top: number
}

/**
 * Every tile needed to cover a viewport centred on `center`.
 *
 * Tiles outside the vertical range are dropped rather than clamped — past the
 * poles there is nothing to draw, and a clamped tile would repeat the top row
 * down the screen.
 */
export function visibleTiles(
  center: LonLat,
  zoom: number,
  width: number,
  height: number,
): TileRef[] {
  const scale = 2 ** zoom
  const centerTile = lonLatToTile(center, zoom)

  // Pixel position of the viewport's top-left corner in world-tile space.
  const originX = centerTile.x - width / 2 / TILE_SIZE
  const originY = centerTile.y - height / 2 / TILE_SIZE

  const firstX = Math.floor(originX)
  const firstY = Math.floor(originY)
  const lastX = Math.floor(originX + width / TILE_SIZE)
  const lastY = Math.floor(originY + height / TILE_SIZE)

  const tiles: TileRef[] = []
  for (let ty = firstY; ty <= lastY; ty++) {
    if (ty < 0 || ty >= scale) continue
    for (let tx = firstX; tx <= lastX; tx++) {
      tiles.push({
        // Longitude wraps, so the tile column does too.
        x: ((tx % scale) + scale) % scale,
        y: ty,
        zoom,
        left: Math.round((tx - originX) * TILE_SIZE),
        top: Math.round((ty - originY) * TILE_SIZE),
      })
    }
  }
  return tiles
}

/** Move the centre by a pixel drag, in the opposite direction to the pointer. */
export function panCenter(
  center: LonLat,
  zoom: number,
  deltaXPixels: number,
  deltaYPixels: number,
): LonLat {
  const tile = lonLatToTile(center, zoom)
  return tileToLonLat(
    { x: tile.x - deltaXPixels / TILE_SIZE, y: tile.y - deltaYPixels / TILE_SIZE },
    zoom,
  )
}

/** The coordinate under a point in the viewport, measured from its top-left. */
export function viewportPointToLonLat(
  center: LonLat,
  zoom: number,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): LonLat {
  const tile = lonLatToTile(center, zoom)
  return tileToLonLat(
    {
      x: tile.x + (offsetX - width / 2) / TILE_SIZE,
      y: tile.y + (offsetY - height / 2) / TILE_SIZE,
    },
    zoom,
  )
}

/** OpenStreetMap's standard raster tile URL. Attribution is required wherever these are shown. */
export function osmTileUrl(tile: Pick<TileRef, 'x' | 'y' | 'zoom'>): string {
  return `https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`
}

/** Round-trip-safe display form: enough decimals for a building, not a survey. */
export const formatCoordinate = (value: number): string => value.toFixed(4)

/**
 * Trim a coordinate to the precision a map click actually carries.
 *
 * Six decimals is about 0.1 m — finer than any site placement needs, and far
 * finer than a pixel on the map. Storing the raw float instead would write
 * fourteen digits into the scene and claim survey accuracy the click never had.
 */
export const roundCoordinate = (value: number): number => Number.parseFloat(value.toFixed(6))
