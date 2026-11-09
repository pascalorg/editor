import { afterAll, beforeEach, expect, test } from 'bun:test'
import {
  configuredProvider,
  hashSource,
  refreshTranslations,
  type SourceMessage,
  type TranslationRequest,
  type TranslationResponse,
} from './i18n'

/**
 * Drives the real AI SDK providers against a local HTTP fixture so a provider
 * upgrade that changes the structured-output wire format, auth headers or
 * error handling fails here instead of during a paid translation run.
 */

type RecordedRequest = { path: string; headers: Headers; body: Record<string, unknown> }
type FixtureReply = (request: RecordedRequest) => Response

const recorded: RecordedRequest[] = []
let reply: FixtureReply = () => Response.json({ error: 'no reply configured' }, { status: 500 })

const fixture = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    const entry = {
      path: new URL(request.url).pathname,
      headers: request.headers,
      body: (await request.json()) as Record<string, unknown>,
    }
    recorded.push(entry)
    return reply(entry)
  },
})
const baseURL = `http://127.0.0.1:${fixture.port}/v1`

afterAll(() => fixture.stop(true))
beforeEach(() => {
  recorded.length = 0
})

const sources: SourceMessage[] = [
  { id: 'viewer.greeting', message: 'Hello {name}', context: ['greeting.tsx:1'] },
  { id: 'viewer.walls', message: '{count, plural, one {# wall} other {# walls}}', context: [] },
]
const request: TranslationRequest = { locale: 'fr', items: sources, glossary: {} }
const translated: TranslationResponse = {
  locale: 'fr',
  entries: [
    { id: 'viewer.greeting', translation: 'Bonjour {name}', reviewNotes: '' },
    {
      id: 'viewer.walls',
      translation: '{count, plural, one {# mur} many {# murs} other {# murs}}',
      reviewNotes: 'Check plural spacing.',
    },
  ],
}

function openAiEnv(): NodeJS.ProcessEnv {
  return {
    I18N_PROVIDER: 'openai',
    I18N_MODEL: 'gpt-5.5',
    OPENAI_API_KEY: 'fixture-openai-key',
    OPENAI_BASE_URL: baseURL,
  }
}

function anthropicEnv(model: string): NodeJS.ProcessEnv {
  return {
    I18N_PROVIDER: 'anthropic',
    I18N_MODEL: model,
    ANTHROPIC_API_KEY: 'fixture-anthropic-key',
    ANTHROPIC_BASE_URL: baseURL,
  }
}

function openAiResponse(text: string): Response {
  return Response.json({
    id: 'resp_fixture',
    object: 'response',
    created_at: 1_700_000_000,
    model: 'gpt-5.5',
    status: 'completed',
    incomplete_details: null,
    output: [
      {
        type: 'message',
        id: 'msg_fixture',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 34 },
  })
}

/** Answers in whichever structured-output mode the provider asked for. */
function anthropicResponse(output: unknown): FixtureReply {
  return ({ body }) => {
    const tools = (body.tools as Array<{ name: string }> | undefined) ?? []
    const usesJsonTool = tools.some((tool) => tool.name === 'json')
    return Response.json({
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: usesJsonTool
        ? [{ type: 'tool_use', id: 'toolu_fixture', name: 'json', input: output }]
        : [{ type: 'text', text: JSON.stringify(output) }],
      stop_reason: usesJsonTool ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 34 },
    })
  }
}

function expectStrictTranslationSchema(schema: unknown): void {
  expect(schema).toMatchObject({
    type: 'object',
    required: ['locale', 'entries'],
    additionalProperties: false,
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'translation', 'reviewNotes'],
          additionalProperties: false,
        },
      },
    },
  })
}

test('OpenAI translation sends a strict JSON schema to the Responses API and parses the reply', async () => {
  reply = () => openAiResponse(JSON.stringify(translated))
  const provider = await configuredProvider(openAiEnv())

  expect(provider).toMatchObject({ name: 'openai', model: 'gpt-5.5' })
  expect(await provider.translate(request)).toEqual(translated)

  expect(recorded).toHaveLength(1)
  const sent = recorded[0]!
  expect(sent.path).toBe('/v1/responses')
  expect(sent.headers.get('authorization')).toBe('Bearer fixture-openai-key')
  expect(sent.body.model).toBe('gpt-5.5')
  const format = (sent.body.text as { format: Record<string, unknown> }).format
  expect(format).toMatchObject({ type: 'json_schema', strict: true })
  expectStrictTranslationSchema(format.schema)
  const prompt = JSON.stringify(sent.body.input)
  for (const source of sources) expect(prompt).toContain(source.id)
  expect(prompt).toContain('one, many, other')
})

test('Anthropic translation uses native structured output on models that support it', async () => {
  reply = anthropicResponse(translated)
  const provider = await configuredProvider(anthropicEnv('claude-sonnet-5-5'))

  expect(await provider.translate(request)).toEqual(translated)

  expect(recorded).toHaveLength(1)
  const sent = recorded[0]!
  expect(sent.path).toBe('/v1/messages')
  expect(sent.headers.get('x-api-key')).toBe('fixture-anthropic-key')
  expect(sent.body.tools).toBeUndefined()
  const format = (sent.body.output_config as { format: Record<string, unknown> }).format
  expect(format.type).toBe('json_schema')
  expectStrictTranslationSchema(format.schema)
})

test('Anthropic translation falls back to a forced JSON tool on models without native structured output', async () => {
  reply = anthropicResponse(translated)
  const provider = await configuredProvider(anthropicEnv('claude-3-haiku-20240307'))

  expect(await provider.translate(request)).toEqual(translated)

  const sent = recorded[0]!
  expect(sent.body.output_config).toBeUndefined()
  const tools = sent.body.tools as Array<{ name: string; input_schema: unknown }>
  expect(tools.map((tool) => tool.name)).toEqual(['json'])
  expectStrictTranslationSchema(tools[0]?.input_schema)
  expect(sent.body.tool_choice).toMatchObject({ type: 'any' })
})

test('a provider reply that violates the schema is rejected rather than returned', async () => {
  reply = () =>
    openAiResponse(JSON.stringify({ locale: 'fr', entries: [{ id: 'viewer.greeting' }] }))
  const provider = await configuredProvider(openAiEnv())

  await expect(provider.translate(request)).rejects.toMatchObject({
    name: 'AI_NoObjectGeneratedError',
  })
})

test('a non-JSON provider reply is rejected', async () => {
  reply = () => openAiResponse('Sure! Here are the translations.')
  const provider = await configuredProvider(openAiEnv())

  await expect(provider.translate(request)).rejects.toMatchObject({
    name: 'AI_NoObjectGeneratedError',
  })
})

test('an authentication failure surfaces as an API error without retrying', async () => {
  reply = () =>
    Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      { status: 401 },
    )
  const provider = await configuredProvider(anthropicEnv('claude-sonnet-5-5'))

  await expect(provider.translate(request)).rejects.toMatchObject({
    name: 'AI_APICallError',
    statusCode: 401,
    isRetryable: false,
  })
  expect(recorded).toHaveLength(1)
})

test('translations from the real provider path still pass ICU validation', async () => {
  reply = () => openAiResponse(JSON.stringify(translated))
  const refreshed = await refreshTranslations(
    'fr',
    sources,
    {},
    await configuredProvider(openAiEnv()),
  )

  expect(refreshed['viewer.greeting']).toEqual({
    translation: 'Bonjour {name}',
    sourceHash: hashSource('Hello {name}'),
    review: 'required',
    fuzzy: true,
    reviewNotes: '',
  })

  reply = () =>
    openAiResponse(
      JSON.stringify({
        locale: 'fr',
        entries: [
          { id: 'viewer.greeting', translation: 'Bonjour', reviewNotes: '' },
          translated.entries[1],
        ],
      }),
    )
  await expect(
    refreshTranslations('fr', sources, {}, await configuredProvider(openAiEnv())),
  ).rejects.toThrow('placeholder names differ from English')
})

test('provider configuration errors name the missing setting', async () => {
  await expect(configuredProvider({ I18N_PROVIDER: 'openai' })).rejects.toThrow('I18N_MODEL')
  await expect(configuredProvider({ I18N_PROVIDER: 'openai', I18N_MODEL: 'm' })).rejects.toThrow(
    'OPENAI_API_KEY',
  )
  await expect(configuredProvider({ I18N_PROVIDER: 'anthropic', I18N_MODEL: 'm' })).rejects.toThrow(
    'ANTHROPIC_API_KEY',
  )
  await expect(configuredProvider({ I18N_MODEL: 'm' })).rejects.toThrow('I18N_PROVIDER')
  expect(recorded).toHaveLength(0)
})
