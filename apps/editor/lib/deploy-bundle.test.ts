import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * BEKÇİ: paket neyle DERLENDİYSE onunla ÇALIŞTIRILMALI.
 *
 * ## Yayına mal olan hata
 *
 * Upstream beta.5 merge'i kök `package.json`'a `overrides.next: 16.3.0` ekledi,
 * yani uygulama 16.3.0 ile derlenmeye başladı. Yayın paketinin kendi
 * `package.json`'ı ise `next: 16.2.9`'da kaldı ve sunucu onunla koşuyordu.
 *
 * 16.3.0'ın ürettiği `.next` çıktısı, 16.2.9 çalışma zamanına veriliyordu.
 * Sonuç, hata değil SESSİZLİK: derleme yeşil, paketleme yeşil, sunucu açılıyor,
 * veritabanına bağlanıyor, yedi göçü uyguluyor, "hazır" diyor — ve sonra hiçbir
 * rota çözülmüyor. `/api/health` bir dakika boyunca boş döndü, günlükte tek
 * satır yok. Yayın kapısı yayınlamayı reddetti, iki kez.
 *
 * ## Neden burada, ve neden metin karşılaştırması
 *
 * İki dosya birbirini hiç görmüyor: `.github/deploy/package.json` paketin
 * çalışma zamanı, kök `package.json` derlemenin. Aralarında tek bağ, birinin
 * ötekiyle uyumlu olduğu VARSAYIMI. Bu test o varsayımı bir iddiaya çeviriyor.
 *
 * Sürümü yükseltmek yasak değil — ikisini BİRLİKTE yükseltmek şart.
 */

const repoRoot = path.join(import.meta.dir, '../../..')

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'))
}

const root = readJson('package.json')
const bundle = readJson('.github/deploy/package.json')

const rootOverrides = (root.overrides ?? {}) as Record<string, string>
const bundleDeps = (bundle.dependencies ?? {}) as Record<string, string>

describe('yayın paketi derleme sürümleriyle aynı hizada', () => {
  /**
   * Asıl iddia. `overrides` derlemenin gerçekten kullandığı sürümü sabitliyor;
   * paket onu çalıştıracaksa aynı sayıyı taşımak zorunda.
   */
  test('next: derleme ve çalışma zamanı aynı sürüm', () => {
    expect({ build: rootOverrides.next, runtime: bundleDeps.next }).toEqual({
      build: rootOverrides.next,
      runtime: rootOverrides.next,
    })
  })

  /**
   * `overrides.next` silinirse yukarıdaki test iki `undefined`'ı karşılaştırıp
   * yeşil yanardı — bekçiyi susturmanın en sessiz yolu. Sabitin var olduğu
   * ayrıca sınanıyor.
   */
  test('kök overrides next sürümünü gerçekten sabitliyor', () => {
    expect(typeof rootOverrides.next).toBe('string')
    expect(rootOverrides.next).toMatch(/^\d+\.\d+\.\d+$/)
  })

  /**
   * Paket bağımlılıkları tam sürüm taşımak zorunda. Bir aralık (`^16.3.0`)
   * `npm install`'un paketi bir sonraki yayında sessizce başka bir Next'e
   * kaydırmasına izin verirdi — aynı ayrışma, bu sefer hiçbir commit
   * değişmeden.
   */
  test('paket bağımlılıkları tam sürüm, aralık değil', () => {
    const loose = Object.entries(bundleDeps).filter(([, range]) => /[\^~*x]|\s-\s/.test(range))
    expect(loose).toEqual([])
  })
})
