import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Proxy endpoint to fetch scene JSON files from external URLs.
 * This bypasses CORS restrictions by making the request server-side.
 *
 * Usage: GET /api/proxy-scene?url=<encoded-url>
 *
 * The `url` parameter should be a fully URL-encoded scene URL.
 * For signed Supabase URLs, ensure the entire URL including the
 * `?token=...` query parameter is properly encoded.
 *
 * Example (from another app):
 *   const sceneUrl = 'http://127.0.0.1:54321/storage/v1/object/sign/bucket/file.json?token=xxx'
 *   const embedUrl = `http://localhost:3002/embed?sceneUrl=${encodeURIComponent(sceneUrl)}`
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  try {
    // Validate it's a reasonable URL
    new URL(url)

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return NextResponse.json(
        { error: `Upstream error: ${response.status} ${response.statusText}`, details: errorText },
        { status: response.status },
      )
    }

    const data = await response.json()

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      },
    })
  } catch (error) {
    console.error('[proxy-scene] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch scene' },
      { status: 500 },
    )
  }
}
