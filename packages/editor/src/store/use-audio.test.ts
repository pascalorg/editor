import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import useAudio, { AUDIO_MUTED_STORAGE_KEY, AUDIO_SETTINGS_STORAGE_KEY } from './use-audio'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

const originals = {
  localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  sessionStorage: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'),
}

function use(name: 'localStorage' | 'sessionStorage', storage: ReturnType<typeof memoryStorage>) {
  Object.defineProperty(globalThis, name, { configurable: true, value: storage })
}

/** One browser profile: its tabs share `localStorage`, each has its own `sessionStorage`. */
let browser = memoryStorage()

/** Another tab of the profile saves the settings: the browser stores them and tells this tab. */
function savedInAnotherTab(state: Record<string, unknown>) {
  const value = JSON.stringify({ state, version: 0 })
  browser.setItem(AUDIO_SETTINGS_STORAGE_KEY, value)
  globalThis.dispatchEvent(
    Object.assign(new Event('storage'), { key: AUDIO_SETTINGS_STORAGE_KEY, newValue: value }),
  )
}

/** The editor loading in a tab: a new one, or the same one reloaded (its session kept). */
async function loadIn(tab: ReturnType<typeof memoryStorage>) {
  use('sessionStorage', tab)
  await useAudio.persist.rehydrate()
  return useAudio.getState()
}

beforeEach(() => {
  browser = memoryStorage()
  use('localStorage', browser)
})

afterAll(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

describe('muting a tab', () => {
  test('a tab keeps its own mute across reloads, and a new tab starts from the last choice', async () => {
    const first = memoryStorage()
    const second = memoryStorage()

    expect((await loadIn(first)).muted).toBe(false)
    useAudio.getState().toggleMute()

    expect((await loadIn(second)).muted).toBe(true)
    useAudio.getState().setMuted(false)

    expect((await loadIn(first)).muted).toBe(true)
    expect((await loadIn(memoryStorage())).muted).toBe(false)
  })

  test("another tab's choice does not change a tab that never chose", async () => {
    const quiet = memoryStorage()
    expect((await loadIn(quiet)).muted).toBe(false)

    await loadIn(memoryStorage())
    useAudio.getState().setMuted(true)

    expect((await loadIn(quiet)).muted).toBe(false)
  })

  test("volumes are every tab's and never carry a mute", async () => {
    const muting = memoryStorage()
    await loadIn(muting)
    useAudio.getState().setMuted(true)

    await loadIn(memoryStorage())
    useAudio.getState().setMuted(false)
    await loadIn(muting)
    useAudio.getState().setSfxVolume(20)

    expect(JSON.parse(browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)!).state).not.toHaveProperty(
      'muted',
    )
    expect(browser.getItem(AUDIO_MUTED_STORAGE_KEY)).toBe('false')
    const next = await loadIn(memoryStorage())
    expect(next.sfxVolume).toBe(20)
    expect(next.muted).toBe(false)
  })

  test("a volume another tab sets reaches this one at once, and this tab's saves carry it", async () => {
    await loadIn(memoryStorage())
    useAudio.getState().setSfxVolume(30)
    useAudio.getState().setRadioPlaying(true)
    const stored = JSON.parse(browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)!)

    savedInAnotherTab({ ...stored.state, isRadioPlaying: false, muted: true, sfxVolume: 80 })

    expect(useAudio.getState()).toMatchObject({ isRadioPlaying: true, muted: false, sfxVolume: 80 })
    const setElsewhere = browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)
    useAudio.getState().setMuted(true)
    expect(browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)).toBe(setElsewhere)
    // The radio pausing as the tab is hidden saves every setting: the other tab's volume stays.
    useAudio.getState().setRadioPlaying(false)
    useAudio.getState().setMasterVolume(60)
    expect(JSON.parse(browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)!).state).toMatchObject({
      masterVolume: 60,
      sfxVolume: 80,
    })
  })

  test("a mute saved when it was every tab's still holds, in settings the old build still reads", async () => {
    browser.setItem(
      AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { masterVolume: 40, muted: true, sfxVolume: 50 }, version: 0 }),
    )

    const state = await loadIn(memoryStorage())

    expect(state.muted).toBe(true)
    expect(state.masterVolume).toBe(40)
    expect((await loadIn(memoryStorage())).muted).toBe(true)
    useAudio.getState().setSfxVolume(45)
    const saved = JSON.parse(browser.getItem(AUDIO_SETTINGS_STORAGE_KEY)!)
    expect(saved).toMatchObject({ state: { masterVolume: 40, sfxVolume: 45 }, version: 0 })
    expect(saved.state).not.toHaveProperty('muted')
  })

  test('a tab still on the old settings does not undo a choice made since', async () => {
    await loadIn(memoryStorage())
    useAudio.getState().setMuted(false)
    browser.setItem(
      AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { muted: true, sfxVolume: 50 }, version: 0 }),
    )

    expect((await loadIn(memoryStorage())).muted).toBe(false)
  })
})
