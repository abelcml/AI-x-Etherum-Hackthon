/**
 * AES-256-GCM encryption for user-supplied API keys at rest.
 * The data key is derived from API_KEY_ENCRYPTION_SECRET (a long random
 * string set once in the server env). Ciphertext format: iv.tag.data (b64).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function dataKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('API_KEY_ENCRYPTION_SECRET is not set (need a long random string)')
  }
  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.')
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
