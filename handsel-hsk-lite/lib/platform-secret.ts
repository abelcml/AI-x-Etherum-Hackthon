import { pool } from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto'

/**
 * Tiny encrypted key/value store for platform-wide provider secrets that
 * don't belong to a user account (e.g. a shared Hugging Face token used for
 * server-side image generation). Self-migrating: creates its table on first
 * use so it ships without a separate migration step.
 */
async function ensureTable(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS platform_secrets (
       id text PRIMARY KEY,
       value_enc text NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT now()
     )`,
  )
}

export async function setPlatformSecret(key: string, plaintext: string): Promise<void> {
  await ensureTable()
  const enc = encryptSecret(plaintext.trim())
  await pool.query(
    `INSERT INTO platform_secrets (id, value_enc) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET value_enc = $2, updated_at = now()`,
    [key, enc],
  )
}

export async function getPlatformSecret(key: string): Promise<string | null> {
  try {
    await ensureTable()
    const { rows } = await pool.query<{ value_enc: string }>('SELECT value_enc FROM platform_secrets WHERE id = $1', [key])
    if (!rows[0]) return null
    return decryptSecret(rows[0].value_enc)
  } catch {
    return null
  }
}
