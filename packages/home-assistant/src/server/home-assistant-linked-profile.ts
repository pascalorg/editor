import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STORAGE_DIRECTORY_NAME = '.pascal-home-assistant'
const STORAGE_FILE_NAME = 'linked-instance.enc'
const STORAGE_KEY_FILE_NAME = 'storage-key.txt'
const STORAGE_VERSION = 1
const IV_LENGTH = 12

export type HomeAssistantLinkedProfile = {
  accessToken: string
  accessTokenExpiresAt: string
  clientId: string
  externalUrl: string | null
  instanceUrl: string
  linkedAt: string
  refreshToken: string
}

type StoredHomeAssistantLinkedProfile = {
  profile: HomeAssistantLinkedProfile | null
  version: number
}

function getStorageDirectory() {
  return path.join(os.homedir(), STORAGE_DIRECTORY_NAME)
}

function getStorageFilePath() {
  return path.join(getStorageDirectory(), STORAGE_FILE_NAME)
}

function getStorageKeyFilePath() {
  return path.join(getStorageDirectory(), STORAGE_KEY_FILE_NAME)
}

async function ensureStorageDirectory() {
  await fs.mkdir(getStorageDirectory(), { recursive: true })
}

async function readOrCreateStorageKey() {
  await ensureStorageDirectory()

  try {
    const existing = await fs.readFile(getStorageKeyFilePath(), 'utf8')
    const decoded = Buffer.from(existing.trim(), 'base64')
    if (decoded.length === 32) {
      return decoded
    }
  } catch {}

  const nextKey = randomBytes(32)
  await fs.writeFile(getStorageKeyFilePath(), nextKey.toString('base64'), 'utf8')
  return nextKey
}

async function encryptPayload(payload: StoredHomeAssistantLinkedProfile) {
  const key = await readOrCreateStorageKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return JSON.stringify({
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  })
}

async function decryptPayload(encryptedPayload: string): Promise<StoredHomeAssistantLinkedProfile> {
  const key = await readOrCreateStorageKey()
  const parsed = JSON.parse(encryptedPayload) as {
    ciphertext?: string
    iv?: string
    tag?: string
  }

  if (!(parsed.ciphertext && parsed.iv && parsed.tag)) {
    throw new Error('Invalid linked Home Assistant payload.')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8')) as StoredHomeAssistantLinkedProfile
}

export async function readLinkedHomeAssistantProfile() {
  try {
    const encryptedPayload = await fs.readFile(getStorageFilePath(), 'utf8')
    const parsed = await decryptPayload(encryptedPayload)
    if (parsed.version !== STORAGE_VERSION) {
      return null
    }
    return parsed.profile
  } catch {
    return null
  }
}

export async function writeLinkedHomeAssistantProfile(profile: HomeAssistantLinkedProfile) {
  await ensureStorageDirectory()
  const encryptedPayload = await encryptPayload({
    profile,
    version: STORAGE_VERSION,
  })
  await fs.writeFile(getStorageFilePath(), encryptedPayload, 'utf8')
}

export async function clearLinkedHomeAssistantProfile() {
  try {
    await fs.unlink(getStorageFilePath())
  } catch {}
}
