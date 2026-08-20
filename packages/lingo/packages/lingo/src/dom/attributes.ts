export function addToken(value: string | null, token: string): string {
  const tokens = (value ?? '').split(/\s+/).filter(Boolean)
  return tokens.includes(token) ? tokens.join(' ') : [...tokens, token].join(' ')
}

export function removeToken(value: string | null, token: string): string | null {
  const tokens = (value ?? '').split(/\s+/).filter((item) => item && item !== token)
  return tokens.length === 0 ? null : tokens.join(' ')
}

export class AttributeStore {
  private readonly originals = new Map<string, string | null>()

  constructor(private readonly el: Element) {}

  remember(name: string): void {
    if (!this.originals.has(name)) {
      this.originals.set(name, this.el.getAttribute(name))
    }
  }

  set(name: string, value: string): void {
    this.remember(name)
    this.el.setAttribute(name, value)
  }

  setDefault(name: string, value: string): void {
    if (!this.el.hasAttribute(name)) {
      this.set(name, value)
    }
  }

  sync(name: string, value: string | null | false): void {
    if (value === null || value === false) {
      this.remove(name)
    } else {
      this.set(name, value)
    }
  }

  remove(name: string): void {
    this.remember(name)
    this.el.removeAttribute(name)
  }

  restore(): void {
    for (const [name, value] of this.originals) {
      if (value === null) {
        this.el.removeAttribute(name)
      } else {
        this.el.setAttribute(name, value)
      }
    }
    this.originals.clear()
  }
}
