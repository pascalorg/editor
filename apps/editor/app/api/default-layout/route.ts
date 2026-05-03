import { readFile } from 'node:fs/promises'

const DEFAULT_LAYOUT_PATH = process.env.PASCAL_DEFAULT_LAYOUT_PATH?.trim()

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!DEFAULT_LAYOUT_PATH) {
    return Response.json(
      {
        error: 'No default layout file is configured.',
      },
      {
        status: 404,
      },
    )
  }

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
