import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * BEKÇİ: bir denetimi çizen düğme ile onun paneli ayrı düşmesin.
 *
 * ## Kapatılan iki boşluk
 *
 * 1. **`ViewToggles` hiç çağrılmıyordu.** Bu fork kendi araç çubuğunu yazınca
 *    upstream'inkini çizmeyi bıraktı, ve o bileşenin taşıdığı dört özellik —
 *    Scans, Guides, **referans kat altlığı**, **DWV riser** — kodu tam olduğu
 *    hâlde arayüzden ulaşılamaz kaldı.
 *
 * 2. **Riser paneli yalnız v1 düzeninde mount ediliyordu**, biz v2 kullanıyoruz.
 *    Yani birinci boşluk kapatılıp ikincisi kapatılmasaydı, riser düğmesi
 *    basıldığında bir bayrağı çevirip **hiçbir şey göstermeyecekti** — hiç
 *    olmayan bir düğmeden daha kötü.
 *
 * ## Neden kaynağa bakıyor
 *
 * Ölçülecek şey bir davranış değil, bir MONTAJ: iki dosyanın birbirini anıyor
 * olması. İkisi de tek başına kusursuz derlenir, tip verir, test geçer. Yanlış
 * olan tek şey birinin ötekini çizmemesi.
 */

const REPO_ROOT = path.join(import.meta.dir, '../../..')

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8')
}

describe('görünüm anahtarları arayüze bağlı', () => {
  test('sol araç çubuğu ViewToggles kümesini çiziyor', () => {
    const toolbar = read('apps/editor/components/viewer-toolbar.tsx')
    expect(toolbar).toContain('<ViewToggles />')
  })

  /**
   * Asıl iddia. Düğme kümesi geri geldi; panelsiz bir riser düğmesi sessizce
   * hiçbir şey yapar, ve bunu ancak birisi deneyip şaşırınca öğreniriz.
   */
  test('v2 düzeni riser panelini mount ediyor', () => {
    const layout = read('packages/editor/src/components/editor/index.tsx')

    // Pencere `<EditorLayoutV2`'nin `overlays` yığını. Bir kez yanlış yaptım:
    // `layoutVersion === 'v2'` dalından dosya sonuna kadar dilimlemek, DAHA
    // AŞAĞIDA duran v1 mount'unu da kapsıyor ve bekçi mutasyonda yeşil kalıyor.
    // Dar pencere şart — geniş pencere hiçbir şey ölçmüyordu.
    const start = layout.indexOf('<EditorLayoutV2')
    const end = layout.indexOf('renderTabContent={renderTabContent}', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    expect(layout.slice(start, end)).toContain('<RiserDiagramPanel />')
  })
})
