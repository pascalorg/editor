'use client'

import { useSyncExternalStore } from 'react'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

const STORAGE_KEY = 'lingo-pm'
const DEFAULT_PM: PackageManager = 'pnpm'
const packageManagers: PackageManager[] = ['pnpm', 'npm', 'yarn', 'bun']
const listeners = new Set<() => void>()
let currentPackageManager: PackageManager = DEFAULT_PM

function isPackageManager(value: string | null): value is PackageManager {
  return packageManagers.includes(value as PackageManager)
}

function readStoredPackageManager(): PackageManager {
  if (typeof window === 'undefined') {
    return DEFAULT_PM
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    currentPackageManager = isPackageManager(stored) ? stored : currentPackageManager
    return currentPackageManager
  } catch {
    return currentPackageManager
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback)

  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) {
      callback()
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage)
  }

  return () => {
    listeners.delete(callback)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage)
    }
  }
}

function emit() {
  listeners.forEach((listener) => {
    listener()
  })
}

export function setPackageManager(pm: PackageManager) {
  currentPackageManager = pm
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, pm)
    } catch {
      // Persistence is progressive; the tab state still updates in memory.
    }
  }
  emit()
}

export function usePackageManager() {
  return useSyncExternalStore(subscribe, readStoredPackageManager, () => DEFAULT_PM)
}

export function allPackageManagers() {
  return packageManagers
}

export function commandVariants(command: string): Record<PackageManager, string> {
  if (command.startsWith('npm install')) {
    return {
      npm: command,
      yarn: command.replace('npm install', 'yarn add'),
      pnpm: command.replace('npm install', 'pnpm add'),
      bun: command.replace('npm install', 'bun add'),
    }
  }

  if (command.startsWith('npx create-')) {
    return {
      npm: command,
      yarn: command.replace('npx create-', 'yarn create '),
      pnpm: command.replace('npx create-', 'pnpm create '),
      bun: command.replace('npx', 'bunx --bun'),
    }
  }

  if (command.startsWith('npm create')) {
    return {
      npm: command,
      yarn: command.replace('npm create', 'yarn create'),
      pnpm: command.replace('npm create', 'pnpm create'),
      bun: command.replace('npm create', 'bun create'),
    }
  }

  if (command.startsWith('npx')) {
    return {
      npm: command,
      yarn: command.replace('npx', 'yarn dlx'),
      pnpm: command.replace('npx', 'pnpm dlx'),
      bun: command.replace('npx', 'bunx --bun'),
    }
  }

  if (command.startsWith('npm run')) {
    return {
      npm: command,
      yarn: command.replace('npm run', 'yarn'),
      pnpm: command.replace('npm run', 'pnpm'),
      bun: command.replace('npm run', 'bun'),
    }
  }

  return {
    npm: command,
    pnpm: command,
    yarn: command,
    bun: command,
  }
}
