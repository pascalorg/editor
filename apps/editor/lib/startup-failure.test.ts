import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isSchemaPermissionError } from '../instrumentation'

/**
 * BEKÇİ: hangi açılış hatası süreci öldürür, hangisi öldürmez.
 *
 * ## Kapatılan hata
 *
 * İki açılış yolu da şemasını kendisi kuruyor — sahne deposu ilk kullanımda,
 * konsol kendi SQL dosyalarından. 12 Ağustos'ta veri tabanı boyut kotasını
 * aşınca sağlayıcı DDL yetkisini kesti, `CREATE command denied` geldi,
 * `instrumentation` süreci öldürdü, sunucu yeniden başlattı ve site döngüye
 * girip 503 verdi.
 *
 * Oysa **bütün tablolar yerindeydi**; her sorgu çalışırdı. Giriş sayfası bile
 * açılmadı ve hiçbir yerde sebebi yazmıyordu.
 *
 * ## İki yön de ölçülüyor
 *
 * Yalnız "artık ölmüyor" demek yetmez: her hatayı yutan bir düzeltme de o
 * testi geçerdi, ve veri tabanısız bir dağıtımın sessizce açılmasına yol
 * açardı — ki yayın iş akışının duman testi tam olarak o reddedişe bel bağlıyor
 * (`deploy-bundle.yml`: "refused to boot without a database").
 */

function mysqlError(code: string): Error {
  return Object.assign(new Error(`${code} raised`), { code })
}

describe('şema yetkisi hatası ayırt ediliyor', () => {
  test('DDL reddi ölümcül değil', () => {
    expect(isSchemaPermissionError(mysqlError('ER_TABLEACCESS_DENIED_ERROR'))).toBe(true)
  })

  /**
   * Bu üçü ölümcül KALMALI: hiçbiri "okuyabiliyorum ama şemayı değiştiremem"
   * demiyor — üçü de verisine ulaşamayan bir dağıtımı tarif ediyor.
   */
  test.each([
    'ER_ACCESS_DENIED_ERROR',
    'ER_DBACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
    'ECONNREFUSED',
    'ENOTFOUND',
  ])('%s hâlâ ölümcül sayılıyor', (code) => {
    expect(isSchemaPermissionError(mysqlError(code))).toBe(false)
  })

  /**
   * Reddedilen bir TCP bağlantısı bize her adres için bir hata taşıyan bir
   * `AggregateError` olarak geliyor — kodu dıştaki nesnede değil, içeridekinde.
   * Düzleştirmeyi atlayan bir denetim, gerçek olayda hiç ateşlemezdi.
   */
  test('AggregateError içindeki kodu görüyor', () => {
    const wrapped = new AggregateError([mysqlError('ER_TABLEACCESS_DENIED_ERROR')], '')
    expect(isSchemaPermissionError(wrapped)).toBe(true)

    const refused = new AggregateError([mysqlError('ECONNREFUSED')], '')
    expect(isSchemaPermissionError(refused)).toBe(false)
  })

  test('hata olmayan bir değer ölümcül sayılıyor', () => {
    expect(isSchemaPermissionError('boom')).toBe(false)
    expect(isSchemaPermissionError(null)).toBe(false)
  })
})

describe('açılış yolu bu kararı gerçekten kullanıyor', () => {
  const source = readFileSync(path.join(import.meta.dir, '../instrumentation.ts'), 'utf8')

  /**
   * Saf yüklem doğru olup da bağlanmamış olabilir. İki `catch` de ortak karara
   * gitmezse, biri hâlâ koşulsuz `process.exit(1)` yapar ve site yine ölür.
   */
  test('her iki catch de ortak karara gidiyor', () => {
    const calls = source.match(/reportStartupFailure\(/g) ?? []
    // İki çağrı artı tanımın kendisi.
    expect(calls.length).toBe(3)
  })

  /**
   * Tek bir çıkış var ve o da kararın arkasında. Sayı iki yönü birden tutuyor:
   * ikinci bir `process.exit(1)` kararı atlayan bir yol demek, sıfır tane ise
   * veri tabanısız bir dağıtımın sessizce açılması — ki duman testi tam olarak
   * onu reddediyor.
   */
  test('tek bir çıkış var, o da kararın arkasında', () => {
    const exits = source.match(/process\.exit\(1\)/g) ?? []
    expect(exits.length).toBe(1)
  })
})
