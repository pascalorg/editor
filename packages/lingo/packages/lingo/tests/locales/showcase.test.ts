import { describe, expect, it } from 'vitest'
import { createLingo } from '../../src/index'
import { enGb } from '../../src/locales/en-gb'
import { es } from '../../src/locales/es'
import { fr } from '../../src/locales/fr'
import { ja } from '../../src/locales/ja'
import { pt } from '../../src/locales/pt'
import { zh } from '../../src/locales/zh'

type ShowcaseLocale = 'auto' | 'en' | 'es' | 'fr' | 'pt' | 'zh' | 'ja' | 'en-gb'
type ExpectedLocale = Exclude<ShowcaseLocale, 'auto'>

interface ShowcaseExample {
  expectedLocale: ExpectedLocale
  input: string
}

const EXAMPLES: Record<ShowcaseLocale, readonly ShowcaseExample[]> = {
  auto: [
    { input: '72 in to cm', expectedLocale: 'en' },
    { input: 'dos kg', expectedLocale: 'es' },
    { input: 'entre 5 et 10 kg', expectedLocale: 'fr' },
    { input: '5公斤', expectedLocale: 'zh' },
    { input: '暑い', expectedLocale: 'ja' },
  ],
  en: [
    { input: '2 ft', expectedLocale: 'en' },
    { input: '72 in to cm', expectedLocale: 'en' },
    { input: 'between 5 and 10 kg', expectedLocale: 'en' },
    { input: '5 meters', expectedLocale: 'en' },
    { input: "it's hot", expectedLocale: 'en' },
  ],
  es: [
    { input: 'dos kg', expectedLocale: 'es' },
    { input: 'entre 5 y 10 kg', expectedLocale: 'es' },
    { input: '72 pulgadas a cm', expectedLocale: 'es' },
    { input: 'dos metros y medio', expectedLocale: 'es' },
    { input: 'al menos 2 m', expectedLocale: 'es' },
  ],
  fr: [
    { input: 'deux kg', expectedLocale: 'fr' },
    { input: 'entre 5 et 10 kg', expectedLocale: 'fr' },
    { input: '72 pouces en cm', expectedLocale: 'fr' },
    { input: 'deux metres et demi', expectedLocale: 'fr' },
    { input: 'au moins 2 m', expectedLocale: 'fr' },
  ],
  pt: [
    { input: 'dois kg', expectedLocale: 'pt' },
    { input: 'entre 5 e 10 kg', expectedLocale: 'pt' },
    { input: '72 polegadas em cm', expectedLocale: 'pt' },
    { input: 'pelo menos 2 m', expectedLocale: 'pt' },
  ],
  zh: [
    { input: '5公斤', expectedLocale: 'zh' },
    { input: '3米', expectedLocale: 'zh' },
    { input: '5到10公斤', expectedLocale: 'zh' },
    { input: '很热', expectedLocale: 'zh' },
  ],
  ja: [
    { input: '5キロ', expectedLocale: 'ja' },
    { input: '3メートル', expectedLocale: 'ja' },
    { input: '5から10キロ', expectedLocale: 'ja' },
    { input: '暑い', expectedLocale: 'ja' },
  ],
  'en-gb': [
    { input: '12 stone', expectedLocale: 'en-gb' },
    { input: '3 quid', expectedLocale: 'en-gb' },
    { input: 'roundabout 2 m', expectedLocale: 'en-gb' },
  ],
}

const lingo = createLingo({ locales: [es, fr, pt, zh, ja, enGb] })

describe('locale showcase examples', () => {
  for (const [choice, examples] of Object.entries(EXAMPLES) as Array<
    [ShowcaseLocale, readonly ShowcaseExample[]]
  >) {
    it(`${choice} examples parse with pinned and auto locales`, () => {
      for (const example of examples) {
        const explicit = lingo.parse(example.input, {
          ...kindOption(example.input),
          locale: choice === 'auto' ? example.expectedLocale : choice,
        })
        expect(explicit.ok, `${example.input}: ${JSON.stringify(explicit.issues)}`).toBe(true)
        if (explicit.ok) {
          expect(explicit.locale).toBe(example.expectedLocale)
        }

        const auto = lingo.parse(example.input, kindOption(example.input))
        expect(auto.ok, `${example.input}: ${JSON.stringify(auto.issues)}`).toBe(true)
        if (auto.ok) {
          expect(auto.locale).toBe(example.expectedLocale)
        }
      }
    })
  }
})

function kindOption(input: string): { kind?: 'temperature' } {
  return /hot|热|暑い/i.test(input) ? { kind: 'temperature' } : {}
}
