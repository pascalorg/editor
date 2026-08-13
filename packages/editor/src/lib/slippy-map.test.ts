import { describe, expect, test } from 'bun:test'
import {
  clampLatitude,
  clampZoom,
  lonLatToTile,
  MAX_LATITUDE,
  osmTileUrl,
  panCenter,
  roundCoordinate,
  TILE_SIZE,
  tileToLonLat,
  viewportPointToLonLat,
  visibleTiles,
  wrapLongitude,
} from './slippy-map'

const ISTANBUL = { longitude: 28.9784, latitude: 41.0082 }

describe('wrapLongitude', () => {
  test('leaves an in-range longitude alone', () => {
    expect(wrapLongitude(28.9784)).toBeCloseTo(28.9784, 9)
    expect(wrapLongitude(-77)).toBeCloseTo(-77, 9)
  })

  test('wraps past the date line so panning keeps working', () => {
    expect(wrapLongitude(190)).toBeCloseTo(-170, 9)
    expect(wrapLongitude(-190)).toBeCloseTo(170, 9)
  })

  test('collapses the two spellings of the anti-meridian to one', () => {
    expect(wrapLongitude(-180)).toBe(-180)
    expect(wrapLongitude(180)).toBe(-180)
  })
})

describe('clampLatitude', () => {
  test('clamps at the Mercator limit, not at the pole', () => {
    expect(clampLatitude(89)).toBeCloseTo(MAX_LATITUDE, 6)
    expect(clampLatitude(-89)).toBeCloseTo(-MAX_LATITUDE, 6)
  })

  test('leaves ordinary latitudes alone', () => {
    expect(clampLatitude(41.0082)).toBe(41.0082)
  })
})

describe('clampZoom', () => {
  test('keeps the zoom whole and inside the tile server range', () => {
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(99)).toBe(19)
    expect(clampZoom(12.4)).toBe(12)
  })
})

describe('lonLatToTile / tileToLonLat', () => {
  test('null island is the centre of the world at every zoom', () => {
    for (const zoom of [1, 5, 12]) {
      const scale = 2 ** zoom
      const tile = lonLatToTile({ longitude: 0, latitude: 0 }, zoom)
      expect(tile.x).toBeCloseTo(scale / 2, 9)
      expect(tile.y).toBeCloseTo(scale / 2, 9)
    }
  })

  test('zoom 0 puts the whole world in one tile', () => {
    const corner = tileToLonLat({ x: 0, y: 0 }, 0)
    expect(corner.longitude).toBeCloseTo(-180, 6)
    expect(corner.latitude).toBeCloseTo(MAX_LATITUDE, 4)
  })

  test('round-trips a real coordinate', () => {
    for (const zoom of [3, 10, 18]) {
      const back = tileToLonLat(lonLatToTile(ISTANBUL, zoom), zoom)
      expect(back.longitude).toBeCloseTo(ISTANBUL.longitude, 9)
      expect(back.latitude).toBeCloseTo(ISTANBUL.latitude, 9)
    }
  })

  test('east is a larger tile X, north is a smaller tile Y', () => {
    const zoom = 8
    const here = lonLatToTile(ISTANBUL, zoom)
    const east = lonLatToTile({ ...ISTANBUL, longitude: 30 }, zoom)
    const north = lonLatToTile({ ...ISTANBUL, latitude: 42 }, zoom)

    expect(east.x).toBeGreaterThan(here.x)
    expect(north.y).toBeLessThan(here.y)
  })
})

describe('visibleTiles', () => {
  test('covers the viewport', () => {
    const tiles = visibleTiles(ISTANBUL, 10, 300, 200)
    expect(tiles.length).toBeGreaterThan(0)

    // Every viewport pixel must fall inside some tile's box.
    const covers = (px: number, py: number) =>
      tiles.some(
        (t) => px >= t.left && px < t.left + TILE_SIZE && py >= t.top && py < t.top + TILE_SIZE,
      )
    expect(covers(0, 0)).toBe(true)
    expect(covers(299, 199)).toBe(true)
    expect(covers(150, 100)).toBe(true)
  })

  test('the centre of the viewport shows the centre coordinate', () => {
    const zoom = 12
    const width = 300
    const height = 200
    const back = viewportPointToLonLat(ISTANBUL, zoom, width, height, width / 2, height / 2)
    expect(back.longitude).toBeCloseTo(ISTANBUL.longitude, 9)
    expect(back.latitude).toBeCloseTo(ISTANBUL.latitude, 9)
  })

  test('wraps the tile column across the date line instead of asking for a negative tile', () => {
    const tiles = visibleTiles({ longitude: 179.9, latitude: 0 }, 3, 600, 200)
    expect(tiles.every((t) => t.x >= 0 && t.x < 2 ** 3)).toBe(true)
  })

  test('drops rows past the poles rather than repeating the top tile', () => {
    const tiles = visibleTiles({ longitude: 0, latitude: MAX_LATITUDE }, 2, 300, 600)
    expect(tiles.every((t) => t.y >= 0 && t.y < 2 ** 2)).toBe(true)
  })
})

describe('panCenter', () => {
  test('dragging right moves the map west', () => {
    const panned = panCenter(ISTANBUL, 10, 100, 0)
    expect(panned.longitude).toBeLessThan(ISTANBUL.longitude)
  })

  test('dragging down moves the map north', () => {
    const panned = panCenter(ISTANBUL, 10, 0, 100)
    expect(panned.latitude).toBeGreaterThan(ISTANBUL.latitude)
  })

  test('a zero drag changes nothing', () => {
    const panned = panCenter(ISTANBUL, 10, 0, 0)
    expect(panned.longitude).toBeCloseTo(ISTANBUL.longitude, 9)
    expect(panned.latitude).toBeCloseTo(ISTANBUL.latitude, 9)
  })

  test('the same drag covers less ground the further you zoom in', () => {
    const near = panCenter(ISTANBUL, 16, 100, 0)
    const far = panCenter(ISTANBUL, 6, 100, 0)
    expect(Math.abs(near.longitude - ISTANBUL.longitude)).toBeLessThan(
      Math.abs(far.longitude - ISTANBUL.longitude),
    )
  })
})

describe('viewportPointToLonLat', () => {
  test('a click right of centre reads further east', () => {
    const point = viewportPointToLonLat(ISTANBUL, 10, 300, 200, 250, 100)
    expect(point.longitude).toBeGreaterThan(ISTANBUL.longitude)
  })

  test('a click above centre reads further north', () => {
    const point = viewportPointToLonLat(ISTANBUL, 10, 300, 200, 150, 20)
    expect(point.latitude).toBeGreaterThan(ISTANBUL.latitude)
  })
})

describe('osmTileUrl', () => {
  test('builds the standard z/x/y path', () => {
    expect(osmTileUrl({ zoom: 12, x: 2405, y: 1541 })).toBe(
      'https://tile.openstreetmap.org/12/2405/1541.png',
    )
  })
})

describe('roundCoordinate', () => {
  test('keeps about a decimetre of precision', () => {
    expect(roundCoordinate(39.95289162094154)).toBe(39.952892)
  })

  test('drops the false precision a raw map click carries', () => {
    expect(String(roundCoordinate(32.915847795703144)).length).toBeLessThan(
      String(32.915847795703144).length,
    )
  })

  test('leaves an already-short coordinate alone', () => {
    expect(roundCoordinate(41.0082)).toBe(41.0082)
    expect(roundCoordinate(0)).toBe(0)
  })

  test('a rounded coordinate still round-trips through the tile math', () => {
    const rounded = {
      longitude: roundCoordinate(28.97841234),
      latitude: roundCoordinate(41.00821234),
    }
    const back = tileToLonLat(lonLatToTile(rounded, 18), 18)
    expect(back.longitude).toBeCloseTo(rounded.longitude, 6)
    expect(back.latitude).toBeCloseTo(rounded.latitude, 6)
  })
})
