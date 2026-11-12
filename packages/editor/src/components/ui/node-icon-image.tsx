'use client'

import { ARTIFACT_URL_PREFIX, resolveArtifactUrl } from '@pascal-app/core'
import { type ImageConfigComplete, imageConfigDefault } from 'next/dist/shared/lib/image-config'
import { ImageConfigContext } from 'next/dist/shared/lib/image-config-context.shared-runtime'
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern'
import Image, { type ImageProps } from 'next/image'
import { useContext } from 'react'

type ImageHostConfig = Partial<Pick<ImageConfigComplete, 'domains' | 'remotePatterns'>>

// Inlined by Next's bundler define, as next/image itself reads it.
const configEnv = process.env.__NEXT_IMAGE_OPTS as unknown as ImageHostConfig | undefined

/**
 * Whether next/image can optimize `src`. An absolute URL on a host missing
 * from `images.remotePatterns` makes next/image throw during render (e.g. a
 * catalog thumbnail on production storage while running against local
 * Supabase), so those render unoptimized, straight from their host.
 */
export function canOptimizeImageSrc(src: string, config: ImageHostConfig): boolean {
  if (src.startsWith('/') && !src.startsWith('//')) return true
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  return hasRemoteMatch(config.domains ?? [], config.remotePatterns ?? [], url)
}

/**
 * A node's icon or thumbnail. A scripted object's thumbnail is an
 * `artifact://` image: it resolves through the project's artifact store and
 * skips image optimization, whose server-side fetch has no session to read a
 * private project's artifact with.
 */
export function NodeIconImage({ src, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  const configContext = useContext(ImageConfigContext)
  const config = configEnv || configContext || imageConfigDefault
  if (!src.startsWith(ARTIFACT_URL_PREFIX)) {
    return <Image src={src} unoptimized={!canOptimizeImageSrc(src, config)} {...props} />
  }
  const url = resolveArtifactUrl(src)
  return url ? <Image src={url} unoptimized {...props} /> : null
}
