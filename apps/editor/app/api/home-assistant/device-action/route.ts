import type {
  CollectionHomeAssistantActionRequest,
  CollectionHomeAssistantBinding,
} from '@pascal-app/core/schema'
import { getHomeAssistantLink } from '../../../../../../packages/editor/src/lib/home-assistant'
import {
  resolveHomeAssistantServerConfig,
  runHomeAssistantCollectionAction,
  runHomeAssistantDeviceAction,
} from '../../../_lib/home-assistant-server'

export const runtime = 'nodejs'

type DeviceActionRequestBody = {
  binding?: CollectionHomeAssistantBinding
  collectionName?: string
  itemName?: string
  link?: unknown
  request?: CollectionHomeAssistantActionRequest
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DeviceActionRequestBody
    if (
      body.binding &&
      typeof body.binding === 'object' &&
      body.request &&
      typeof body.request === 'object'
    ) {
      const collectionName =
        typeof body.collectionName === 'string' && body.collectionName.trim().length > 0
          ? body.collectionName.trim()
          : 'Linked collection'

      const result = await runHomeAssistantCollectionAction(
        await resolveHomeAssistantServerConfig(),
        collectionName,
        body.binding,
        body.request,
      )
      return Response.json(result)
    }

    const itemName =
      typeof body.itemName === 'string' && body.itemName.trim().length > 0
        ? body.itemName.trim()
        : 'Linked item'
    const link = getHomeAssistantLink({
      homeAssistantLink: body.link,
    })

    if (!link) {
      return Response.json(
        { error: 'Missing or invalid Home Assistant link payload.' },
        { status: 400 },
      )
    }

    const result = await runHomeAssistantDeviceAction(
      await resolveHomeAssistantServerConfig(),
      itemName,
      link,
    )
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Home Assistant action error.'
    return Response.json({ error: message }, { status: 500 })
  }
}
