import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * BEKÇİ: ana adreste çizilen sahne veri tabanına gitmek ZORUNDA.
 *
 * ## Kapatılan hata
 *
 * `/` giriş yapmış kullanıcıya editörü çiziyordu, ama o editöre kayıt yolu
 * bağlanmamıştı. `<Editor>` bileşeni `onSave` verilmediğinde
 * `saveSceneToLocalStorage`'a düşüyor (`packages/editor/src/lib/scene.ts`), yani
 * ana adreste çizilen her duvar, her raf, her kat tek bir tarayıcı profilinde
 * kalıyor ve MySQL'e hiç ulaşmıyordu. Yalnız `/scene/[id]` gerçekten
 * kaydediyordu.
 *
 * ## Neden kaynağa bakıyor
 *
 * Ölçülecek şey bir çıktı değil, bir BAĞLANTI: kök rotanın kayıt yolu olan
 * bileşeni kullanıp kullanmadığı. Sunucu bileşenini testten çalıştırmak bir
 * oturum, bir veri tabanı ve Next'in istek bağlamını ister; kusur ise tek bir
 * satırdı — `return <EditorApp />`.
 */

const ROOT_PAGE = 'app/page.tsx'
const source = readFileSync(ROOT_PAGE, 'utf8')

/** Yorumlar hariç: dosya eski hâli yorumda ANLATIYOR. */
const code = source
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n')

describe('kök editör veri tabanına kaydediyor', () => {
  test('kayıt yolu olan bileşeni çiziyor', () => {
    expect(code.includes('<SceneLoader')).toBe(true)
  })

  /**
   * Asıl iddia. `<EditorApp />` kayıt yolu OLMAYAN sarmalayıcıydı; geri
   * gelmesi tam olarak hatanın geri gelmesi demek, ve hiçbir şey ses çıkarmaz —
   * ekran birebir aynı görünür, yalnız iş veri tabanına gitmez.
   */
  test('kayıtsız sarmalayıcıya geri dönmüyor', () => {
    expect(code.includes('<EditorApp')).toBe(false)
  })

  test('sahne satırını kullanıcıya bağlıyor', () => {
    expect(code.includes('loadOrCreateWorkspaceScene')).toBe(true)
  })

  /**
   * Kimliksiz bir kullanıcı buraya gelemez: `user` null iken
   * `loadOrCreateWorkspaceScene(user.id)` patlar, ama daha kötüsü — bir gün
   * kontrol gevşetilirse sahne SAHİPSİZ açılır ve herkes aynı satırı paylaşır.
   */
  test('oturumsuz ziyaretçiyi çevirip gönderiyor', () => {
    expect(code.includes("if (!user) redirect('/signin')")).toBe(true)
  })
})

describe('çalışma alanı satırı', () => {
  const lib = readFileSync('lib/workspace-scene.ts', 'utf8')

  /**
   * Satır `projectId` ile bulunuyor, adla değil. Ad kullanıcı tarafından
   * değiştirilebilir; çalışma alanını yeniden adlandıran bir kullanıcı, bir
   * sonraki ziyarette İKİNCİ bir çalışma alanı yaratırdı ve ilki kaybolmuş
   * görünürdü.
   */
  test('adla değil projectId ile bulunuyor', () => {
    expect(lib.includes('projectId: WORKSPACE_PROJECT_ID')).toBe(true)
  })

  /** Sahiple filtrelenmezse iki kullanıcı aynı satırı paylaşır. */
  test('sahiple filtreleniyor', () => {
    expect(/list\(\{[^}]*ownerId/s.test(lib)).toBe(true)
    expect(/save\(\{[^}]*ownerId/s.test(lib)).toBe(true)
  })
})
