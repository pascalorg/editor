import { describe, expect, test } from 'bun:test'
import {
  bestEffort,
  createResendSender,
  createUnconfiguredSender,
  type EmailMessage,
} from '../src/email'

const MESSAGE: EmailMessage = {
  to: 'ali@example.com',
  subject: 'Giriş bağlantınız',
  html: '<p>link</p>',
  text: 'link',
}

describe('createResendSender', () => {
  test('posts the message to Resend with the configured sender', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const send = createResendSender({
      apiKey: 'key_test',
      from: 'Menart 3D <hesap@menart3d.com>',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await send(MESSAGE)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe('https://api.resend.com/emails')
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer key_test')
    expect(JSON.parse(call.init.body as string)).toEqual({
      from: 'Menart 3D <hesap@menart3d.com>',
      to: ['ali@example.com'],
      subject: 'Giriş bağlantınız',
      html: '<p>link</p>',
      text: 'link',
    })
  })

  test('throws with the provider detail when Resend rejects the message', async () => {
    const send = createResendSender({
      apiKey: 'key_test',
      from: 'Menart 3D <hesap@menart3d.com>',
      fetchImpl: (async () =>
        new Response('{"message":"domain not verified"}', {
          status: 403,
        })) as unknown as typeof fetch,
    })

    await expect(send(MESSAGE)).rejects.toThrow(/403.*domain not verified/)
  })
})

describe('failure handling', () => {
  test('an unconfigured sender throws rather than resolving', async () => {
    await expect(createUnconfiguredSender('no key')(MESSAGE)).rejects.toThrow('no key')
  })

  test('bestEffort swallows a failure so the caller keeps going', async () => {
    const failing = async () => {
      throw new Error('smtp down')
    }
    await expect(bestEffort(failing, 'welcome')(MESSAGE)).resolves.toBeUndefined()
  })
})
