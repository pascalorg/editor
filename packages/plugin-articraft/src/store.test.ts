import { beforeEach, describe, expect, test } from 'bun:test'
import { useArticraftStore } from './store'

const draft = {
  model: 'gpt-5.6',
  prompt: 'A folding task lamp',
  provider: 'openai' as const,
}

describe('Articraft generation queue', () => {
  beforeEach(() => useArticraftStore.setState({ generationQueue: [], selectedItem: null }))

  test('keeps multiple jobs and updates them independently', () => {
    const store = useArticraftStore.getState()
    store.addGeneration({ id: 'first', status: 'queued' }, draft)
    store.addGeneration({ id: 'second', status: 'running' }, { ...draft, prompt: 'A hinged box' })
    useArticraftStore.getState().updateGeneration({ id: 'first', status: 'canceled' })

    expect(useArticraftStore.getState().generationQueue).toMatchObject([
      {
        generation: { id: 'second', status: 'running' },
        draft: { prompt: 'A hinged box' },
      },
      {
        generation: { id: 'first', status: 'canceled' },
        draft: { prompt: draft.prompt },
      },
    ])
  })

  test('removes only the requested queue card', () => {
    const store = useArticraftStore.getState()
    store.addGeneration({ id: 'first', status: 'failed' }, draft)
    store.addGeneration({ id: 'second', status: 'succeeded' }, draft)

    useArticraftStore.getState().removeGeneration('first')

    expect(
      useArticraftStore.getState().generationQueue.map((entry) => entry.generation.id),
    ).toEqual(['second'])
  })
})
