const GITHUB_REPOSITORY_API_URL = 'https://api.github.com/repos/pascalorg/lingo'
const RESPONSE_HEADERS = {
  'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
}

function readStargazerCount(value: unknown) {
  if (!value || typeof value !== 'object' || !('stargazers_count' in value)) {
    return 0
  }

  const count = value.stargazers_count

  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function starsResponse(stars = 0) {
  return Response.json({ stars }, { headers: RESPONSE_HEADERS })
}

export async function GET() {
  try {
    const response = await fetch(GITHUB_REPOSITORY_API_URL, {
      headers: {
        accept: 'application/vnd.github+json',
      },
      next: {
        revalidate: 3600,
      },
    })

    if (!response.ok) {
      return starsResponse()
    }

    const data: unknown = await response.json()

    return starsResponse(readStargazerCount(data))
  } catch {
    return starsResponse()
  }
}
