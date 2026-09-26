import { db } from '@/lib/db'
import { userApiKey } from '@/lib/db/schema'
import { decryptSecret } from '@/lib/crypto'
import { eq } from 'drizzle-orm'

/**
 * Resolve the Anthropic key an agent run should bill.
 * BYOK: the owner's stored key wins; otherwise fall back to the platform key
 * configured on the runtime — unless REQUIRE_USER_API_KEY=true, in which case
 * users must bring their own.
 */
export async function resolveUserAnthropicKey(userId: string): Promise<string | null> {
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  if (row?.anthropicKeyEnc) {
    try {
      return decryptSecret(row.anthropicKeyEnc)
    } catch (error) {
      console.error('[user-keys] decrypt failed (was API_KEY_ENCRYPTION_SECRET rotated?):', error)
      throw new Error('Stored API key could not be read — please re-enter it in Settings')
    }
  }
  if (process.env.REQUIRE_USER_API_KEY === 'true') {
    throw new Error('Add your Anthropic API key in Settings to run agent tasks')
  }
  return null // runtime falls back to its own ANTHROPIC_API_KEY
}

export interface OpenAiCompatKey {
  baseUrl: string
  apiKey: string
  model: string
}

/** Both BYOK entries at once, no platform-policy side effects — for
 *  surfaces (delegation planner/verifier) that can use EITHER provider
 *  and apply the REQUIRE_USER_API_KEY policy themselves after checking
 *  both. */
export async function getUserByok(
  userId: string,
): Promise<{ anthropicKey: string | null; openai: OpenAiCompatKey | null }> {
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  let anthropicKey: string | null = null
  let openai: OpenAiCompatKey | null = null
  try {
    if (row?.anthropicKeyEnc) anthropicKey = decryptSecret(row.anthropicKeyEnc)
    if (row?.openaiKeyEnc && row.openaiBaseUrl && row.openaiModel) {
      openai = { baseUrl: row.openaiBaseUrl, apiKey: decryptSecret(row.openaiKeyEnc), model: row.openaiModel }
    }
  } catch (error) {
    console.error('[user-keys] decrypt failed (was API_KEY_ENCRYPTION_SECRET rotated?):', error)
    throw new Error('Stored API key could not be read — please re-enter it in Settings')
  }
  return { anthropicKey, openai }
}

/** The user's OpenAI-compatible BYOK (Groq/Together/OpenRouter/local), if
 *  configured — used by surfaces that can speak either provider (the
 *  delegation planner/verifier). Returns null when not set; never falls
 *  back to a platform key (there is no platform OpenAI key). */
export async function resolveUserOpenAiKey(userId: string): Promise<OpenAiCompatKey | null> {
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  if (!row?.openaiKeyEnc || !row.openaiBaseUrl || !row.openaiModel) return null
  try {
    return { baseUrl: row.openaiBaseUrl, apiKey: decryptSecret(row.openaiKeyEnc), model: row.openaiModel }
  } catch (error) {
    console.error('[user-keys] openai key decrypt failed:', error)
    throw new Error('Stored API key could not be read — please re-enter it in Settings')
  }
}
