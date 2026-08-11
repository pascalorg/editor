export interface ProgressStream {
  isTTY?: boolean
  write(chunk: string): unknown
}

const FRAMES = [
  '[=    ]',
  '[==   ]',
  '[ === ]',
  '[  ===]',
  '[   ==]',
  '[    =]',
  '[   ==]',
  '[  ===]',
]

export class TerminalProgress {
  private frame = 0
  private message = ''
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly stream: ProgressStream = process.stderr) {}

  start(message: string): void {
    this.stopActive(false)
    this.message = message
    if (!this.stream.isTTY) {
      this.stream.write(`• ${message}\n`)
      return
    }
    this.render()
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length
      this.render()
    }, 90)
    this.timer.unref()
  }

  update(message: string): void {
    if (!this.timer && !this.stream.isTTY) {
      this.start(message)
      return
    }
    this.message = message
    if (this.stream.isTTY) this.render()
  }

  succeed(message: string): void {
    this.stopActive(true)
    this.stream.write(`✓ ${message}\n`)
  }

  stop(): void {
    this.stopActive(true)
  }

  private render(): void {
    this.stream.write(`\r\u001b[2K${FRAMES[this.frame]} ${this.message}`)
  }

  private stopActive(clearLine: boolean): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (clearLine && this.stream.isTTY && this.message) this.stream.write('\r\u001b[2K')
    this.message = ''
  }
}
