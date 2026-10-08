'use client'

import { ARTIFACT_URL_PREFIX, resolveArtifactUrl } from '@pascal-app/core'
import Image, { type ImageProps } from 'next/image'

/**
 * A node's icon or thumbnail. A scripted object's thumbnail is an
 * `artifact://` image: it resolves through the project's artifact store and
 * skips image optimization, whose server-side fetch has no session to read a
 * private project's artifact with.
 */
export function NodeIconImage({ src, ...props }: Omit<ImageProps, 'src'> & { src: string }) {
  if (!src.startsWith(ARTIFACT_URL_PREFIX)) return <Image src={src} {...props} />
  const url = resolveArtifactUrl(src)
  return url ? <Image src={url} unoptimized {...props} /> : null
}
