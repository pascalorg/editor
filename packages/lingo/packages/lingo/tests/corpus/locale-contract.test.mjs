import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createLingo } from '../../src/index.ts'
import { parseDate, parseDateRange } from '../../src/date/index.ts'
import { es } from '../../src/locales/es.ts'
import { fr } from '../../src/locales/fr.ts'
import { pt } from '../../src/locales/pt.ts'
import { zh } from '../../src/locales/zh.ts'
import { ja } from '../../src/locales/ja.ts'

const localePacks = [es, fr, pt, zh, ja]
const localeInstance = createLingo({ locales: localePacks })
const lingo = localeInstance.parse
const corpusDir = new URL('.', import.meta.url)
const sourceFiles = readdirSync(corpusDir)
  .filter((f) => /^locale-[a-z]+-source\.mjs$/.test(f))
  .sort()

describe('locale corpus contracts', () => {
  for (const sourceFile of sourceFiles) {
    const id = sourceFile.replace('locale-', '').replace('-source.mjs', '')
    const contractFile = `locale-${id}-contract-v1.json`

    it(`[${id}] matches the checked-in compatibility snapshot`, async () => {
      const mod = await import(`./${sourceFile}`)
      const contractPath = new URL(contractFile, corpusDir)
      const expected = JSON.parse(readFileSync(contractPath, 'utf8'))
      const current = mod.buildContract({ lingo, localePacks, parseDate, parseDateRange })
      expect(current).toEqual(expected)
    })
  }
})
