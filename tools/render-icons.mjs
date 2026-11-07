// Renders docs/icon.svg to the PNG sizes Android needs for "Add to Home screen".
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFile } from 'node:fs/promises'

const svg = await readFile(new URL('../docs/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`)
  await page.screenshot({ path: new URL(`../docs/icon-${size}.png`, import.meta.url).pathname, omitBackground: true })
  await page.close()
}
await browser.close()
console.log('Rendered icon-192.png and icon-512.png')
