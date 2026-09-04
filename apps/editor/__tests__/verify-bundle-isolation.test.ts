import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

describe('M4: Bundle Analysis & Dynamic Code Splitting Isolation Verification', () => {
  // apps/editor dizini ve .next çıktı yolları
  const editorDir = path.resolve(import.meta.dir, '..')
  const nextDir = path.join(editorDir, '.next')
  const buildManifestPath = path.join(nextDir, 'build-manifest.json')
  const reactLoadableManifestPath = path.join(nextDir, 'react-loadable-manifest.json')
  const staticChunksDir = path.join(nextDir, 'static', 'chunks')

  const targetPlugins = [
    {
      id: 'pascal:boots',
      pkg: '@pascal-app/plugin-boots',
      symbol: 'bootsPlugin',
      nodeKind: 'boots:job',
    },
    {
      id: 'pascal:trees',
      pkg: '@pascal-app/plugin-trees',
      symbol: 'treesPlugin',
      nodeKind: 'trees:tree',
    },
    {
      id: 'pascal:bones',
      pkg: '@pascal-app/plugin-bones',
      symbol: 'bonesPlugin',
      nodeKind: 'bones:lumber',
    },
    {
      id: 'ovurrsl:warehouse',
      pkg: '@ovurrsl/plugin-warehouse',
      symbol: 'warehousePlugin',
      nodeKind: 'warehouse:pallet',
    },
    {
      id: 'pascal:articraft',
      pkg: '@pascal-app/plugin-articraft',
      symbol: 'articraftPlugin',
      nodeKind: 'articraft:asset',
    },
    {
      id: 'pascal:streetscape',
      pkg: '@pascal-app/plugin-streetscape',
      symbol: 'streetscapePlugin',
      nodeKind: 'streetscape:road-network',
    },
    {
      id: 'mint:assets',
      pkg: '@mint/pascal-plugin',
      symbol: 'mintPlugin',
      nodeKind: 'mint:assets',
    },
  ]

  describe('1. Next.js Build Çıktısı ve Manifest Doğrulaması', () => {
    it('.next dizini ve build-manifest.json eksiksiz mevcut olmalıdır', () => {
      expect(existsSync(nextDir)).toBe(true)
      expect(existsSync(buildManifestPath)).toBe(true)
      expect(existsSync(reactLoadableManifestPath)).toBe(true)
      expect(existsSync(staticChunksDir)).toBe(true)
    })

    it('build-manifest.json geçerli rootMainFiles listesi içermelidir', () => {
      const raw = readFileSync(buildManifestPath, 'utf8')
      const manifest = JSON.parse(raw)

      expect(Array.isArray(manifest.rootMainFiles)).toBe(true)
      expect(manifest.rootMainFiles.length).toBeGreaterThan(0)
    })
  })

  describe('2. İlk Giriş Noktası Paketlerinde (Initial Chunks) İzolasyon Doğrulaması', () => {
    it('rootMainFiles, polyfillFiles ve lowPriorityFiles içinde hiçbir eklenti gövdesi/kodu bulunmamalıdır', () => {
      const manifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'))
      const initialFiles: string[] = [
        ...(manifest.rootMainFiles ?? []),
        ...(manifest.polyfillFiles ?? []),
        ...(manifest.lowPriorityFiles ?? []),
      ]

      expect(initialFiles.length).toBeGreaterThan(0)

      for (const relPath of initialFiles) {
        const fullPath = path.join(nextDir, relPath)
        if (!existsSync(fullPath)) continue

        const chunkContent = readFileSync(fullPath, 'utf8')

        for (const plugin of targetPlugins) {
          // İlk yükleme chunk'larında eklenti paket ismi statik import olarak bulunmamalıdır
          expect(chunkContent.includes(`"${plugin.pkg}"`)).toBe(false)
          expect(chunkContent.includes(`'${plugin.pkg}'`)).toBe(false)

          // Eklenti sembolleri veya özel düğüm tanımları ana giriş paketlerine sızmamış olmalıdır
          expect(chunkContent.includes(plugin.nodeKind)).toBe(false)
        }
      }
    })

    it('App Router layout ve genel sayfa chunk dosyalarında eklenti düğüm gövdeleri bulunmamalıdır', () => {
      const appChunksDir = path.join(staticChunksDir, 'app')
      if (existsSync(appChunksDir)) {
        const getJsFiles = (dir: string): string[] => {
          let files: string[] = []
          for (const item of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, item.name)
            if (item.isDirectory()) {
              files = files.concat(getJsFiles(full))
            } else if (item.name.endsWith('.js')) {
              files.push(full)
            }
          }
          return files
        }

        const appJsFiles = getJsFiles(appChunksDir)
        expect(appJsFiles.length).toBeGreaterThan(0)

        for (const jsFile of appJsFiles) {
          const content = readFileSync(jsFile, 'utf8')
          for (const plugin of targetPlugins) {
            // Layout ve ana sayfalarda eklenti özel düğüm tipleri sızmamalı
            expect(content.includes(`kind:"${plugin.nodeKind}"`)).toBe(false)
            expect(content.includes(`kind:'${plugin.nodeKind}'`)).toBe(false)
          }
        }
      }
    })
  })

  describe('3. Dinamik Chunk Ayrışımı ve React Loadable Eşlemesi (Code Splitting)', () => {
    it('7 eklentinin tümü react-loadable-manifest.json içinde dinamik chunk olarak tanımlı olmalıdır', () => {
      const rawLoadable = readFileSync(reactLoadableManifestPath, 'utf8')
      const loadableManifest = JSON.parse(rawLoadable)

      for (const plugin of targetPlugins) {
        const shortPkg = plugin.pkg.replace('@pascal-app/', '').replace('@ovurrsl/', '').replace('@mint/', '')
        const matchingEntries = Object.entries(loadableManifest).filter(
          ([key]) => key.includes(plugin.pkg) || key.includes(shortPkg),
        )

        expect(matchingEntries.length).toBeGreaterThan(0)

        // İlgili dinamik chunk dosyalarının diskte mevcut olduğunu doğrula
        let chunkFilesFound = 0
        for (const [, entry] of matchingEntries) {
          const files = (entry as { files?: string[] }).files ?? []
          for (const f of files) {
            const full = path.join(nextDir, f)
            if (existsSync(full)) {
              chunkFilesFound++
            }
          }
        }
        expect(chunkFilesFound).toBeGreaterThan(0)
      }
    })

    it('Dinamik chunk dosyaları kendi eklenti mantıklarını bağımsız şekilde barındırmalıdır', () => {
      const allChunks = readdirSync(staticChunksDir).filter((f) => f.endsWith('.js'))

      for (const plugin of targetPlugins) {
        let signatureFoundInSeparateChunk = false

        for (const chunkFile of allChunks) {
          const content = readFileSync(path.join(staticChunksDir, chunkFile), 'utf8')
          if (content.includes(plugin.symbol) || content.includes(plugin.nodeKind)) {
            signatureFoundInSeparateChunk = true
            break
          }
        }

        expect(signatureFoundInSeparateChunk).toBe(true)
      }
    })
  })

  describe('4. Kaynak Kod Statik İzolasyon ve Konfigürasyon Doğrulaması', () => {
    it('bootstrap.ts içinde 7 eklentiden hiçbirinin statik importu bulunmamalıdır', () => {
      const bootstrapPath = path.join(editorDir, 'lib', 'bootstrap.ts')
      const content = readFileSync(bootstrapPath, 'utf8')

      for (const plugin of targetPlugins) {
        const staticImportRegex = new RegExp(
          `import\\s+(?:(?:\\{[^}]*\\}|\\*\\s+as\\s+\\w+|\\w+)\\s+from\\s+)?['"]${plugin.pkg}['"]`,
        )
        expect(staticImportRegex.test(content)).toBe(false)
      }
    })

    it('lib/plugins/catalog.ts tüm eklentileri lazy dynamic import thunk ile tanımlamalıdır', () => {
      const catalogPath = path.join(editorDir, 'lib', 'plugins', 'catalog.ts')
      const content = readFileSync(catalogPath, 'utf8')

      for (const plugin of targetPlugins) {
        expect(content.includes(plugin.id)).toBe(true)
        expect(content.includes(plugin.pkg)).toBe(true)
        // Dinamik import kullanımı (boşluk ve alt satır esnekliği ile)
        const dynamicImportRegex = new RegExp(`import\\s*\\(\\s*['"]${plugin.pkg}['"]\\s*\\)`)
        expect(dynamicImportRegex.test(content)).toBe(true)
      }
    })

    it('next.config.ts transpilePackages içinde 7 eklentinin tümü yer almalıdır', () => {
      const nextConfigPath = path.join(editorDir, 'next.config.ts')
      const content = readFileSync(nextConfigPath, 'utf8')

      for (const plugin of targetPlugins) {
        expect(content.includes(`'${plugin.pkg}'`) || content.includes(`"${plugin.pkg}"`)).toBe(true)
      }
    })
  })
})
