import { describe, expect, test } from 'bun:test'
import { imageConfigDefault } from 'next/dist/shared/lib/image-config'
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { canOptimizeImageSrc, NodeIconImage } from './node-icon-image'

const config = {
  ...imageConfigDefault,
  remotePatterns: [{ protocol: 'https' as const, hostname: 'assets.example.com' }],
}

const render = (src: string) =>
  renderToStaticMarkup(
    <ImageConfigContext.Provider value={config}>
      <NodeIconImage alt="" height={16} src={src} width={16} />
    </ImageConfigContext.Provider>,
  )

describe('canOptimizeImageSrc', () => {
  test('optimizes site-relative paths and configured hosts', () => {
    expect(canOptimizeImageSrc('/icons/item.png', config)).toBe(true)
    expect(canOptimizeImageSrc('https://assets.example.com/thumb.webp', config)).toBe(true)
  })

  test('does not optimize hosts missing from remotePatterns', () => {
    expect(canOptimizeImageSrc('https://prod.supabase.co/storage/thumb.webp', config)).toBe(false)
    expect(canOptimizeImageSrc('//prod.supabase.co/thumb.webp', config)).toBe(false)
  })
})

describe('NodeIconImage', () => {
  test('renders an unconfigured host straight from its URL', () => {
    const src = 'https://prod.supabase.co/storage/v1/object/public/items/thumb.webp'
    const html = render(src)
    expect(html).toContain(`src="${src}"`)
    expect(html).not.toContain('/_next/image')
  })

  test('still optimizes a configured host', () => {
    expect(render('https://assets.example.com/thumb.webp')).toContain('/_next/image?url=')
  })
})
