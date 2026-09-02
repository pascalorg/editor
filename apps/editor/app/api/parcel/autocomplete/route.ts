import { parcelService } from '@/lib/parcel/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/parcel/autocomplete?q=1200+W+Cass+St — keyless address type-ahead. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 3) return Response.json({ ok: true, suggestions: [] })
  try {
    const suggestions = await parcelService.autocomplete(q, { limit: 6 })
    return Response.json({ ok: true, suggestions: Array.isArray(suggestions) ? suggestions : [] })
  } catch (error) {
    return Response.json(
      { ok: false, suggestions: [], error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    )
  }
}
