import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { createSceneBvhMaintainer } from './scene-bvh-maintainer'

/**
 * BEKÇİ: BVH bakımı sürekli, tek seferlik değil.
 *
 * Bu bileşenin önceki hâli SADECE mount anında bir kez tarıyordu — sahne o
 * anda henüz boş (renderer'lar sonraki karelerde dolduruyor), yani hiçbir
 * şey indekslenmiyordu ve hiçbir test kırılmıyordu: raycast indekssiz de
 * doğru cevap verir, sadece kullanıcının kaydında ölçtüğümüz gibi kare
 * başına 175 ms'ye mal olur. Buradaki testler o sessiz geri dönüşü ölçer:
 * "sonradan gelen geometri indeksleniyor mu" sorusunun cevabı hayırsa
 * kırmızı yanarlar, davranış hâlâ doğru görünse bile.
 */

function makeMesh(name = 'mesh') {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  mesh.name = name
  return mesh
}

function drain(maintainer: { step(): void }, steps: number) {
  for (let index = 0; index < steps; index += 1) maintainer.step()
}

describe('createSceneBvhMaintainer', () => {
  test('mount sonrasında eklenen mesh indeksleniyor — tek seferlik tarayıcının sessiz hatası', () => {
    const root = new Group()
    const maintainer = createSceneBvhMaintainer(root, { scanInterval: 2 })

    maintainer.step() // ilk tarama: sahne boş
    const late = makeMesh('late')
    root.add(late)
    drain(maintainer, 3) // scanInterval'i aş

    expect(late.raycast).toBe(acceleratedRaycast)
    expect(late.geometry.boundsTree).toBeDefined()
  })

  test('geometri değişimi (duvar düzenlemesi) yeni geometriyi indeksliyor', () => {
    const root = new Group()
    const mesh = makeMesh('wall')
    root.add(mesh)
    const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
    drain(maintainer, 2)
    expect(mesh.geometry.boundsTree).toBeDefined()

    mesh.geometry = new BoxGeometry(2, 2, 2) // düzenleme: geometri takası
    drain(maintainer, 2)

    expect(mesh.geometry.boundsTree).toBeDefined()
  })

  test('excludeFromBvh işaretli mesh hiç dokunulmuyor', () => {
    const root = new Group()
    const excluded = makeMesh('overlay')
    excluded.userData.excludeFromBvh = true
    root.add(excluded)
    const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
    drain(maintainer, 3)

    expect(excluded.raycast).toBe(Mesh.prototype.raycast)
    expect(excluded.geometry.boundsTree).toBeUndefined()
  })

  test('bütçe işi ertelese de her adımda en az bir inşa ilerliyor', () => {
    const root = new Group()
    const meshes = Array.from({ length: 5 }, (_, index) => makeMesh(`m${index}`))
    for (const mesh of meshes) root.add(mesh)
    // budgetMs 0 + sahte saat: her step tek inşadan sonra bütçeyi aşar.
    let tick = 0
    const maintainer = createSceneBvhMaintainer(root, {
      scanInterval: 1,
      budgetMs: 0,
      now: () => tick++,
    })

    maintainer.step() // tarama + 1 inşa
    const builtAfterOne = meshes.filter((mesh) => mesh.geometry.boundsTree).length
    expect(builtAfterOne).toBe(1)

    drain(maintainer, 4)
    expect(meshes.every((mesh) => mesh.geometry.boundsTree)).toBe(true)
  })

  test('dispose raycast fonksiyonlarını ve ağaçları geri alıyor', () => {
    const root = new Group()
    const mesh = makeMesh()
    root.add(mesh)
    const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
    drain(maintainer, 2)
    expect(mesh.geometry.boundsTree).toBeDefined()

    maintainer.dispose()

    expect(mesh.raycast).toBe(Mesh.prototype.raycast)
    expect(mesh.geometry.boundsTree).toBeFalsy()
  })

  test('üçgensiz geometri kuyruğa girmiyor', () => {
    const root = new Group()
    const empty = new Mesh(undefined, new MeshBasicMaterial())
    empty.name = 'empty'
    root.add(empty)
    const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
    drain(maintainer, 3)

    expect(empty.geometry?.boundsTree).toBeUndefined()
  })
})
