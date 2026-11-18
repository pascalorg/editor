import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright-core')
const [output, ...images] = process.argv.slice(2)
if (!output || !images.length) throw new Error('Usage: node sheet.mjs output.png input.png ...')
const browser = await chromium.launch({headless:true,channel:'chromium',timeout:10000})
const deadline = setTimeout(() => { browser.close().finally(() => process.exit(1)) },50000)
try {
  const page = await browser.newPage({viewport:{width:2160,height:Math.ceil(images.length/3)*520},deviceScaleFactor:1})
  const cells = images.map(file => `<div><header>${path.basename(file,'.png').replaceAll('-',' ')}</header><img src="data:image/png;base64,${readFileSync(file).toString('base64')}"></div>`)
  await page.setContent(`<style>body{margin:0;display:grid;grid-template-columns:repeat(3,720px);font:500 24px system-ui;background:#eef1ec}header{height:40px;padding-left:20px;line-height:40px}img{width:720px;height:480px;display:block}</style>${cells.join('')}`)
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())))
  await page.screenshot({path:output,fullPage:true,timeout:15000})
  console.log(`Composed ${images.length} standalone captures into ${output}`)
} finally {
  clearTimeout(deadline)
  await browser.close()
}
