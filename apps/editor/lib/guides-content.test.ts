import { describe, expect, test } from 'bun:test'
import { guidesFor } from './guides-content'

/**
 * BEKÇİ: kılavuz, var olmayan bir düğümü tarif etmesin.
 *
 * ## Kapatılan hata
 *
 * Kılavuz üç yerde tuvalin üstünde duran "All scenes" bağlantısını ve
 * "Son sahneleri aç" adlı bir üst şeridi anlatıyordu. İlki kaldırıldı, ikincisi
 * **hiç var olmadı** — depoda o dizgi yalnız kılavuz metninde geçiyordu.
 *
 * Bu, sessiz bozulmanın en pahalı çeşidi: hiçbir test kırılmaz, hiçbir tip
 * uyuşmaz, uygulama sorunsuz derlenir. Yalnız kullanıcı, tarif edilen düğümü
 * ekranda arar ve bulamaz.
 *
 * ## Neden dizgi taraması
 *
 * Ölçülecek şey bir davranış değil, bir TUTARLILIK: kılavuzun andığı her
 * denetimin arayüzde bir karşılığı olması. Bunu genel olarak kanıtlamak mümkün
 * değil, ama bilinen ölüleri anmadığını kanıtlamak mümkün — ve kaldırılan her
 * denetim buraya bir satır olarak eklenecek.
 */

/** Kaldırılmış ya da hiç var olmamış denetim adları — iki dilde. */
const GONE = [
  'All scenes',
  'Light preview',
  'Open recent scenes',
  'Create new scene',
  'Tüm sahneler',
  'Son sahneleri aç',
]

const TEXT = `${JSON.stringify(guidesFor('en'))}\n${JSON.stringify(guidesFor('tr'))}`

describe('kılavuz metni arayüzle tutarlı', () => {
  test.each(GONE)('kaldırılan "%s" denetimini anmıyor', (name) => {
    expect(TEXT).not.toContain(name)
  })

  /**
   * Ters yön. Yukarıdaki testler yalnız "yokluk" ölçüyor; kılavuz tamamen
   * boşalsa da yeşil yanardı. Sahne listesinin yeni evi kenar çubuğundaki
   * Scenes sekmesi ve kılavuzun onu SÖYLEMESİ gerekiyor — iki dilde de.
   */
  test.each([
    ['en', 'Scenes tab in the left sidebar'],
    ['tr', 'Sahneler sekmesi'],
  ] as const)('%s kılavuzu sahne listesinin yeni yerini söylüyor', (lang, phrase) => {
    expect(JSON.stringify(guidesFor(lang))).toContain(phrase)
  })
})
