import { readFile } from 'node:fs/promises'

const DEFAULT_LAYOUT_PATH = 'C:\\Users\\briss\\Downloads\\layout_2026-04-08.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const layout = await readFile(DEFAULT_LAYOUT_PATH, 'utf8')

    return new Response(layout, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
      status: 200,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown layout read error.'

    return Response.json(
      {
        error: `Failed to read ${DEFAULT_LAYOUT_PATH}: ${message}`,
      },
      {
        status: 500,
      },
    )
  }
}
