import { PostHog } from 'posthog-node'

export function PostHogServer() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    console.warn("PostHog key is missing. Analytics are disabled.");
    return {
      capture: () => {},
      shutdown: async () => {},
    } as any;
  }

  const posthogClient = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
  })
  return posthogClient
}
