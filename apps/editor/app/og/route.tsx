import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import * as z from 'zod'
import { siteConfig } from '@/app/seo'

const ogImageSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  theme: z.enum(['light', 'dark']).default('dark'),
})

let sansFont: ArrayBuffer | null = null
let jakartaFont: ArrayBuffer | null = null

async function loadFonts() {
  if (!(sansFont && jakartaFont)) {
    const fontDir = join(process.cwd(), 'public', 'fonts')
    const [sans, jakarta] = await Promise.all([
      readFile(join(fontDir, 'geist-regular.ttf')),
      readFile(join(fontDir, 'PlusJakartaSans-SemiBold.ttf')),
    ])
    sansFont = sans.buffer.slice(sans.byteOffset, sans.byteOffset + sans.byteLength)
    jakartaFont = jakarta.buffer.slice(jakarta.byteOffset, jakarta.byteOffset + jakarta.byteLength)
  }
  return { sans: sansFont, jakarta: jakartaFont }
}

function PascalLogo({ color = '#fff', size = 100 }: { color?: string; size?: number }) {
  return (
    <svg fill="none" height={size} style={{ display: 'flex' }} viewBox="0 0 100 100" width={size}>
      <rect fill={color} height="40" width="20" y="60" />
      <rect fill={color} height="40" width="20" x="40" y="30" />
      <rect fill={color} height="40" width="20" x="80" />
    </svg>
  )
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const values = ogImageSchema.parse(Object.fromEntries(url.searchParams))
    const heading =
      values.title.length > 140 ? `${values.title.substring(0, 140)}...` : values.title

    const { theme } = values
    const paint = theme === 'dark' ? '#fff' : '#000'
    const logoColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)'

    const fontSize = heading.length > 100 ? '70px' : '100px'

    const showLargeLogo = !(values.title || values.description)

    return new ImageResponse(
      <div
        style={{
          color: paint,
          background:
            theme === 'dark'
              ? 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)'
              : 'white',
        }}
        tw="flex relative flex-col w-full h-full items-start bg-cover"
      >
        {showLargeLogo ? (
          <div tw="flex flex-col flex-1 py-10 px-12 h-full justify-center">
            <div style={{ display: 'flex', marginBottom: 24 }}>
              <PascalLogo color={logoColor} size={80} />
            </div>
            <div
              style={{
                fontFamily: 'jakarta-semibold',
                fontWeight: 'bolder',
                fontSize: '72px',
                letterSpacing: '-0.02em',
                color: paint,
                display: 'flex',
              }}
            >
              Pascal Editor
            </div>
            <div
              style={{
                fontFamily: 'sans-regular',
                fontWeight: 'normal',
                fontSize: '28px',
                letterSpacing: '0.05em',
                color: 'rgba(255, 255, 255, 0.6)',
                marginTop: 16,
                display: 'flex',
              }}
            >
              {siteConfig.description}
            </div>
          </div>
        ) : (
          <div tw="flex flex-col flex-1 py-10 px-12 h-full">
            <div style={{ display: 'flex', marginBottom: 24 }}>
              <PascalLogo color={logoColor} size={40} />
            </div>
            <div
              style={{
                fontFamily: 'jakarta-semibold',
                fontWeight: 'bolder',
                marginLeft: '-3px',
                fontSize,
                letterSpacing: '.05rem',
              }}
              tw="flex leading-[1.1] text-[80px] tracking-tighter font-sans mb-4"
            >
              {heading}
            </div>
            <div
              style={{
                fontFamily: 'sans-regular',
                fontWeight: 'normal',
                letterSpacing: '.1rem',
              }}
              tw="flex flex-1 text-[50px] tracking-tight font-sans"
            >
              {values.description}
            </div>
          </div>
        )}
        {!showLargeLogo && (
          <div
            style={{
              fontFamily: 'sans-regular',
              fontWeight: 'normal',
              letterSpacing: '.1rem',
            }}
            tw="w-full pt-24 p-10 text-[30px] tracking-tight font-sans text-right w-full"
          >
            editor.pascal.app
          </div>
        )}
      </div>,
      {
        width: 1200,
        height: 630,
        fonts: await loadFonts().then(({ sans, jakarta }) => [
          {
            name: 'sans-regular',
            data: sans,
            style: 'normal' as const,
            weight: 400 as const,
          },
          {
            name: 'jakarta-semibold',
            data: jakarta,
            style: 'normal' as const,
            weight: 600 as const,
          },
        ]),
      },
    )
  } catch (error) {
    console.log('error', error)
    return new Response('Failed to generate image', {
      status: 500,
    })
  }
}
