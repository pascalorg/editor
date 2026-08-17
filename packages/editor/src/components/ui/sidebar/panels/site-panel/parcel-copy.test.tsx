import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { hasTranslation } from '../../../../../lib/i18n-core'
import { ParcelFacts } from './parcel-section'

/**
 * The parcel and zoning surfaces are the copy-heaviest thing in the app, and a
 * string that never reached the dictionary fails silently — it just renders in
 * English on a Turkish-default product. These two tests are the acceptance
 * criterion of #63 in executable form.
 */

const SURFACE_FILES = ['parcel-importer.tsx', 'parcel-section.tsx', 'zoning-section.tsx']

describe('parcel surface copy', () => {
  test('every t() string in the parcel surfaces has a Turkish entry', () => {
    const seen: string[] = []
    const untranslated: string[] = []
    for (const file of SURFACE_FILES) {
      const source = readFileSync(join(import.meta.dir, file), 'utf8')
      for (const match of source.matchAll(/\bt\((['"])((?:(?!\1)[^\\]|\\.)*)\1\)/g)) {
        const text = match[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"')
        seen.push(text)
        if (!hasTranslation(text)) untranslated.push(text)
      }
    }
    // A scan that matched nothing would pass vacuously, which is the one way
    // this test could quietly stop guarding anything.
    expect(seen.length).toBeGreaterThan(15)
    expect(untranslated).toEqual([])
  })

  test('the panel copy rendered as plain JSX text is translated', () => {
    // These are written as bare children, so `translateReactNode` reaches them
    // through PanelSection rather than through a t() call the scan above sees.
    const copy = [
      'Parcel',
      'Location',
      'Block / parcel',
      'Quality',
      'Sheet',
      'Registered area',
      'Measured area',
      'Land registry reference data — not a surveyed site plan.',
      'Edited by hand — no longer the registry outline.',
      'Setbacks',
      'Edge',
      'Road',
      'Neighbour',
      'Rear',
      'Distance',
      'Apply to all edges',
      'Parcel area',
      'Buildable area',
      'No buildable ground is left after these setbacks.',
      "The presets are common values. The binding distances are the ones on your municipality's zoning certificate.",
      'Zoning Limits',
      'KAKS (Emsal)',
      'Floors',
      'Height',
      'Building Status',
      'Footprint (TAKS)',
      'Total Area (KAKS)',
      'Current design exceeds zoning limits.',
    ]
    expect(copy.filter((text) => !hasTranslation(text))).toEqual([])
  })

  // A dictionary entry is not the same thing as a translated screen. These
  // labels each had one and still rendered in English, because `PanelSection`
  // walks the JSX it is handed and `ParcelFacts` is a component — its strings
  // do not exist until React renders it, so the walk never reaches them.
  // Rendering is the only way to catch that class of miss.
  test('the parcel facts render in Turkish, not just resolve in the dictionary', () => {
    const html = renderToStaticMarkup(
      createElement(ParcelFacts, {
        computedArea: '883,60 m²',
        unit: 'metric' as const,
        parcel: {
          source: 'tkgm' as const,
          il: 'Ankara',
          ilce: 'Çankaya',
          mahalle: 'Kavaklı Dere',
          mahalleId: 1161,
          ada: '2515',
          parsel: '102',
          registeredArea: 870,
          nitelik: 'Kargir Apartman',
          pafta: 'A12',
          fetchedAt: '2026-08-17T00:00:00.000Z',
          edited: false,
        },
      }),
    )

    for (const turkish of ['Konum', 'Ada / parsel', 'Nitelik', 'Pafta', 'Kayıtlı alan', 'Ölçülen alan']) {
      expect(html).toContain(turkish)
    }
    for (const english of ['Location', 'Block / parcel', 'Quality', 'Sheet', 'Registered area', 'Measured area']) {
      expect(html).not.toContain(english)
    }
  })
})
