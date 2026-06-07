/**
 * Encryption layer using Web Crypto API.
 * - AES-GCM 256-bit for symmetric encryption
 * - PBKDF2 (SHA-256, 600k iterations) to derive keys from passphrases
 * - Per-message random 96-bit IV
 * - Encrypted envelope format: { v: 1, iv, salt?, ciphertext }
 */

import type { EncryptedEnvelope } from './db'

export type { EncryptedEnvelope }

const VERSION = 1
const PBKDF2_ITERATIONS = 600_000
const KEY_USAGE_ENCRYPT_DECRYPT: KeyUsage[] = ['encrypt', 'decrypt']

export interface PassphraseWrap {
  v: number
  salt: string
  iv: string
  wrappedKey: string // base64 AES-KW wrapped DEK
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

function toBufferSource(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}

async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(enc.encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toBufferSource(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    KEY_USAGE_ENCRYPT_DECRYPT
  )
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    KEY_USAGE_ENCRYPT_DECRYPT
  )
}

export async function encrypt(
  key: CryptoKey,
  plaintext: string
): Promise<EncryptedEnvelope> {
  const iv = randomBytes(12)
  const enc = new TextEncoder()
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    toBufferSource(enc.encode(plaintext))
  )
  return {
    v: VERSION,
    iv: bufToB64(iv),
    ct: bufToB64(ct),
  }
}

export async function decrypt(
  key: CryptoKey,
  envelope: EncryptedEnvelope
): Promise<string> {
  const iv = new Uint8Array(b64ToBuf(envelope.iv))
  const ct = b64ToBuf(envelope.ct)
  const dec = new TextDecoder()
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    key,
    ct
  )
  return dec.decode(pt)
}

export async function wrapKeyWithPassphrase(
  dataKey: CryptoKey,
  passphrase: string
): Promise<PassphraseWrap> {
  const salt = randomBytes(16)
  const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt)
  const rawKey = await crypto.subtle.exportKey('raw', dataKey)
  const iv = randomBytes(12)
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    wrappingKey,
    rawKey
  )
  return {
    v: VERSION,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    wrappedKey: bufToB64(wrapped),
  }
}

export async function unwrapKeyWithPassphrase(
  envelope: PassphraseWrap,
  passphrase: string
): Promise<CryptoKey> {
  const salt = new Uint8Array(b64ToBuf(envelope.salt))
  const iv = new Uint8Array(b64ToBuf(envelope.iv))
  const wrapped = b64ToBuf(envelope.wrappedKey)
  const wrappingKey = await deriveKeyFromPassphrase(passphrase, salt)
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBufferSource(iv) },
    wrappingKey,
    wrapped
  )
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    KEY_USAGE_ENCRYPT_DECRYPT
  )
}

/** In-memory cache of the unlocked DEK for the current session. */
let _unlockedKey: CryptoKey | null = null

export function setUnlockedKey(key: CryptoKey | null) {
  _unlockedKey = key
}

export function getUnlockedKey(): CryptoKey | null {
  return _unlockedKey
}

export function isUnlocked(): boolean {
  return _unlockedKey !== null
}

export function lock(): void {
  _unlockedKey = null
}

/** Hash a passphrase for verification (deterministic) without storing the passphrase. */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = new TextEncoder().encode('hatch-v1-passphrase-verify')
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(enc.encode(passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: toBufferSource(salt), iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    256
  )
  return bufToB64(bits)
}
