import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Milestone 1: PascalOrg Eklenti Sözleşmesi & Bağımlılık Doğrulama Testi
 *
 * Bu test paketi:
 * 1. `@pascal-app/plugin-boots` paketinin monorepoda çözümlendiğini ve dinamik yüklenebildiğini,
 * 2. Dışa aktarılan `bootsPlugin` nesnesinin `@pascal-app/core` `Plugin` sözleşmesine uyduğunu,
 * 3. Dışa aktarılan `bootsHostPanel` nesnesinin `@pascal-app/editor` `EditorHostPanel` sözleşmesine uyduğunu,
 * 4. `JobNode` şemasının Zod doğrulama kurallarını karşıladığını,
 * 5. `apps/editor/package.json` ve `next.config.ts` yapılandırmalarının eksiksiz olduğunu doğrular.
 */

const appRoot = path.join(import.meta.dir, '..')

describe('Milestone 1: PascalOrg Boots Eklenti Entegrasyonu ve Sözleşme Doğrulaması', () => {
  test('apps/editor/package.json içerisinde @pascal-app/plugin-boots bağımlılığı tanımlı', () => {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'))
    const deps = pkg.dependencies ?? {}
    expect(deps['@pascal-app/plugin-boots']).toBeDefined()
    expect(typeof deps['@pascal-app/plugin-boots']).toBe('string')
  })

  test('next.config.ts transpilePackages listesinde @pascal-app/plugin-boots ve three-mesh-bvh mevcut', () => {
    const nextConfigContent = readFileSync(path.join(appRoot, 'next.config.ts'), 'utf8')
    expect(nextConfigContent).toContain("'@pascal-app/plugin-boots'")
    expect(nextConfigContent).toContain("'three-mesh-bvh'")
  })

  test('@pascal-app/plugin-boots modülü dinamik olarak import edilebiliyor ve beklenen sembolleri dışa aktarıyor', async () => {
    const bootsModule = await import('@pascal-app/plugin-boots')
    expect(bootsModule).toBeDefined()
    expect(bootsModule.bootsPlugin).toBeDefined()
    expect(bootsModule.bootsHostPanel).toBeDefined()
    expect(bootsModule.jobDefinition).toBeDefined()
    expect(bootsModule.JobNode).toBeDefined()
    expect(bootsModule.JobKind).toBeDefined()
    expect(bootsModule.JobStatus).toBeDefined()
  })

  test('bootsPlugin nesnesi Pascal Plugin arayüzü sözleşmesine (apiVersion: 1) tam uyumlu', async () => {
    const { bootsPlugin } = await import('@pascal-app/plugin-boots')
    expect(bootsPlugin.id).toBe('pascal:boots')
    expect(bootsPlugin.apiVersion).toBe(1)
    expect(Array.isArray(bootsPlugin.nodes)).toBe(true)
    expect(bootsPlugin.nodes?.length).toBeGreaterThan(0)

    const jobNodeDef = bootsPlugin.nodes?.[0]
    expect(jobNodeDef?.kind).toBe('boots:job')
    expect(jobNodeDef?.schemaVersion).toBe(1)
    expect(jobNodeDef?.category).toBe('furnish')
    expect(typeof jobNodeDef?.defaults).toBe('function')
  })

  test('bootsHostPanel nesnesi EditorHostPanel arayüz sözleşmesine tam uyumlu', async () => {
    const { bootsHostPanel, bootsPlugin } = await import('@pascal-app/plugin-boots')
    expect(bootsHostPanel.id).toBe('pascal:boots:panel')
    expect(bootsHostPanel.label).toBe('Boots')
    expect(bootsHostPanel.pluginId).toBe(bootsPlugin.id)
    expect(bootsHostPanel.defaultInstalled).toBe(false)
    expect(typeof bootsHostPanel.component).toBe('function')
    expect(bootsHostPanel.icon).toBeDefined()
  })

  test('JobNode şeması geçerli veri yapısını doğrular ve geçersiz alanları reddeder', async () => {
    const { JobNode } = await import('@pascal-app/plugin-boots')
    
    // Geçerli varsayılan node (id: 'job_*', type: 'boots:job')
    const validNode = {
      id: 'job_test_123',
      type: 'boots:job',
      position: [10, 0, 5],
      rotation: [0, 1.57, 0],
      job: 'inspect',
      status: 'open',
    }
    const parsed = JobNode.parse(validNode)
    expect(parsed.id).toBe('job_test_123')
    expect(parsed.type).toBe('boots:job')
    expect(parsed.job).toBe('inspect')
    expect(parsed.status).toBe('open')

    // Geçersiz status değeri reddedilmeli
    expect(() => {
      JobNode.parse({
        ...validNode,
        status: 'unknown-status',
      })
    }).toThrow()

    // Geçersiz id prefix reddedilmeli
    expect(() => {
      JobNode.parse({
        ...validNode,
        id: 'invalid_prefix_123',
      })
    }).toThrow()
  })
})
