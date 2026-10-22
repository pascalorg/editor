// Dictate in the bubble (the owner said yes to voice, 8 October): the browser's own speech
// recognition where it exists, hidden where it does not. The words fill the field and never send:
// the person reads them and presses Enter.

type RecognitionResult = { 0: { transcript: string }; isFinal: boolean; length: number }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionConstructor = new () => Recognition

function constructorOf(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isDictationSupported(): boolean {
  return constructorOf() !== null
}

export type Dictation = { stop: () => void }

/**
 * Starts listening. `onText` gets the whole transcript so far (interim words included) each time
 * it changes; `onEnd` fires once when listening stops, by `stop`, by silence or by an error.
 */
export function startDictation(options: {
  lang?: string
  onText: (text: string) => void
  onEnd: (reason: 'stopped' | 'error', error?: string) => void
}): Dictation | null {
  const Ctor = constructorOf()
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.lang =
    options.lang ?? (typeof navigator === 'undefined' ? 'en-US' : navigator.language)
  recognition.interimResults = true
  recognition.continuous = true
  let finished = false
  const finish = (reason: 'stopped' | 'error', error?: string) => {
    if (finished) return
    finished = true
    options.onEnd(reason, error)
  }
  recognition.onresult = (event) => {
    let text = ''
    for (let i = 0; i < event.results.length; i++) text += event.results[i]?.[0]?.transcript ?? ''
    options.onText(text.trim())
  }
  recognition.onerror = (event) => finish('error', event.error)
  recognition.onend = () => finish('stopped')
  try {
    recognition.start()
  } catch (error) {
    finish('error', error instanceof Error ? error.message : String(error))
    return null
  }
  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        finish('stopped')
      }
    },
  }
}
