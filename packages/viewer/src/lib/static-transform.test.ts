import { describe, expect, test } from 'bun:test'
import { Object3D } from 'three'
import {
  freezeObjectTransform,
  stampFrozenTransform,
  thawObjectTransform,
} from './static-transform'

/**
 * BEKÇİ: dondurma sırası ve donmuş nesneye yazma.
 *
 * İki sessiz hata rejimi var:
 * 1. `matrixAutoUpdate = false` ÖNCE gelirse nesne eldeki (çoğu zaman birim)
 *    matrisle kalır ve orijinde çizilir — hiçbir istisna yok, sadece yanlış
 *    yerde bir duvar.
 * 2. Donmuş nesnenin alanına yazan imperatif kod (kat yükseltme sistemi)
 *    damgalamazsa yazdığı değer ekrana hiç yansımaz — yine istisnasız.
 * İkisini de matris içeriğinden ölçüyoruz; davranış "görünüyor" diye
 * geçen hiçbir şey burada geçmez.
 */
describe('static-transform', () => {
  test('freeze mevcut transformu damgalar — matris konumu içerir', () => {
    const object = new Object3D()
    object.position.set(5, 2, -3)

    freezeObjectTransform(object)

    expect(object.matrixAutoUpdate).toBe(false)
    // Matrisin son sütunu (elements 12-14) = konum.
    expect(object.matrix.elements[12]).toBe(5)
    expect(object.matrix.elements[13]).toBe(2)
    expect(object.matrix.elements[14]).toBe(-3)
    expect(object.matrixWorldNeedsUpdate).toBe(true)
  })

  test('donmuş nesneye alan yazımı damgasız görünmez, stamp ile görünür', () => {
    const object = new Object3D()
    freezeObjectTransform(object)

    object.position.y = 7 // FloorElevationSystem'in yaptığı yazım
    expect(object.matrix.elements[13]).toBe(0) // tuzak: matris eski

    stampFrozenTransform(object)
    expect(object.matrix.elements[13]).toBe(7)
  })

  test('stamp otomatik güncellenen nesnede matrise dokunmaz (no-op sözleşmesi)', () => {
    const object = new Object3D()
    object.position.x = 4
    const before = [...object.matrix.elements]

    stampFrozenTransform(object)

    // Otomatik nesnenin matrisi render döngüsünün işi; stamp karışmaz.
    expect(object.matrix.elements).toEqual(before)
    expect(object.matrixAutoUpdate).toBe(true)
  })

  test('thaw otomatik güncellemeyi geri açar ve dünya matrisini kirletir', () => {
    const object = new Object3D()
    freezeObjectTransform(object)
    object.matrixWorldNeedsUpdate = false

    thawObjectTransform(object)

    expect(object.matrixAutoUpdate).toBe(true)
    expect(object.matrixWorldNeedsUpdate).toBe(true)
  })
})
