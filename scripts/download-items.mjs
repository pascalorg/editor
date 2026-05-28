/**
 * Download 3D item models from Supabase Storage to local public/items/.
 *
 * Usage: node scripts/download-items.mjs
 *
 * Reads the original catalog-items.tsx from git, filters to industrial +
 * nature items, downloads model.glb / thumbnail / floorPlanUrl for each,
 * and saves them under apps/editor/public/items/<id>/.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const PUBLIC_ITEMS = path.join(REPO_ROOT, 'apps', 'editor', 'public', 'items')

// ── Items to KEEP (industrial + nature) ─────────────────────────────
const KEEP_IDS = new Set([
  // Safety / Fire
  'sprinkler', 'smoke-detector', 'fire-detector', 'fire-alarm', 'fire-extinguisher',
  'hydrant', 'exit-sign',
  // Electrical
  'electric-panel', 'ev-wall-charger', 'thermostat', 'alarm-keypad',
  // HVAC
  'ac-block', 'air-conditioning', 'air-conditioner', 'air-conditioner-block',
  'ceiling-fan', 'freezer',
  // Lighting
  'recessed-light', 'ceiling-lamp', 'ceiling-light', 'circular-ceiling-light',
  'rectangular-ceiling-light', 'floor-lamp',
  // Electronics
  'computer', 'television', 'flat-screen-tv', 'stereo-speaker',
  // Equipment
  'sewing-machine', 'shelf', 'trash-bin', 'coat-rack',
  // Structural
  'column', 'pillar', 'stairs',
  // Infrastructure
  'parking-spot', 'fence', 'low-fence', 'medium-fence', 'high-fence',
  // Openings
  'door', 'door-bar', 'door-with-bar', 'doorway-front', 'glass-door',
  'window-double', 'window-large', 'window-rectangle', 'window-round',
  'window-simple', 'window-small', 'window-small-2', 'window-square',
  'window1-black-open-1731',
  // Nature
  'cactus', 'small-indoor-plant', 'indoor-plant', 'bush', 'hedge',
  'palm', 'fir-tree', 'tree', 'ball',
  // Vehicles
  'tesla', 'scooter',
])

// ── Helpers ─────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https
      .get(url, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close()
          fs.unlinkSync(destPath)
          download(res.headers.location, destPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlinkSync(destPath)
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      })
      .on('error', (err) => {
        file.close()
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
        reject(err)
      })
  })
}

function parseCatalog(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')

  // Match each object block between { … } in the CATALOG_ITEMS array.
  // We extract id, src, thumbnail, floorPlanUrl using regex.
  const items = []
  const itemRegex = /\{\s*id:\s*'([^']+)'[\s\S]*?src:\s*'([^']+)'[\s\S]*?thumbnail:\s*'([^']+)'/g
  let match
  while ((match = itemRegex.exec(content)) !== null) {
    const id = match[1]
    const src = match[2]
    const thumbnail = match[3]
    // Try to extract floorPlanUrl
    const fpMatch = content.slice(match.index).match(/floorPlanUrl:\s*'([^']+)'/)
    const floorPlanUrl = fpMatch ? fpMatch[1] : null
    items.push({ id, src, thumbnail, floorPlanUrl })
  }
  return items
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  // Get original catalog from HEAD
  console.log('Extracting original catalog from git HEAD...')
  const catalogSrc = execSync(
    'git show HEAD:packages/editor/src/components/ui/item-catalog/catalog-items.tsx',
    { encoding: 'utf-8', cwd: REPO_ROOT },
  )
  const catalogPath = path.join(__dirname, '_original-catalog.ts')
  fs.writeFileSync(catalogPath, catalogSrc, 'utf-8')

  const allItems = parseCatalog(catalogPath)
  console.log(`Found ${allItems.length} items in original catalog`)

  const toDownload = allItems.filter((item) => KEEP_IDS.has(item.id))
  console.log(`Filtered to ${toDownload.length} items (industrial + nature)\n`)

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const item of toDownload) {
    const dir = path.join(PUBLIC_ITEMS, item.id)
    fs.mkdirSync(dir, { recursive: true })

    const files = [
      { url: item.src, name: 'model.glb' },
      { url: item.thumbnail, name: /\.webp$/i.test(item.thumbnail) ? 'thumbnail.webp' : 'thumbnail.png' },
    ]
    if (item.floorPlanUrl) {
      const ext = item.floorPlanUrl.endsWith('.svg') ? 'svg' : 'png'
      files.push({ url: item.floorPlanUrl, name: `floor-plan.${ext}` })
    }

    for (const { url, name } of files) {
      const dest = path.join(dir, name)
      // Force re-download GLB from Supabase; skip cached thumbnails/floorplans
      const isGlb = name === 'model.glb'
      if (!isGlb && fs.existsSync(dest)) {
        const stat = fs.statSync(dest)
        if (stat.size > 100) {
          skipped++
          continue
        }
      }
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      try {
        process.stdout.write(`  ${item.id}/${name} ... `)
        await download(url, dest)
        const sizeKB = (fs.statSync(dest).size / 1024).toFixed(1)
        console.log(`${sizeKB} KB`)
        downloaded++
      } catch (err) {
        console.log(`FAILED: ${err.message}`)
        failed++
      }
    }
  }

  // Cleanup temp file
  fs.unlinkSync(catalogPath)

  console.log(`\nDone. Downloaded: ${downloaded}, Skipped (cached): ${skipped}, Failed: ${failed}`)
  console.log(`Files saved to: ${PUBLIC_ITEMS}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
