'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { userApiKey } from '@/lib/db/schema'
import { encryptSecret } from '@/lib/crypto'
import { eq } from 'drizzle-orm'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Key presence + display hints only — keys themselves never leave the server. */
export async function getApiKeyStatus() {
  const userId = await requireUser()
  const [row] = await db.select().from(userApiKey).where(eq(userApiKey.userId, userId))
  return {
    hasKey: Boolean(row?.anthropicKeyEnc),
    hint: row?.keyHint ?? null,
    hasOpenAiKey: Boolean(row?.openaiKeyEnc),
    openaiHint: row?.openaiHint ?? null,
    openaiBaseUrl: row?.openaiBaseUrl ?? null,
    openaiModel: row?.openaiModel ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function saveAnthropicKey(key: string) {
  const userId = await requireUser()
  const trimmed = key.trim()
  if (!trimmed.startsWith('sk-ant-') || trimmed.length < 20) {
    throw new Error('That does not look like an Anthropic API key (sk-ant-…)')
  }

  const values = {
    anthropicKeyEnc: encryptSecret(trimmed),
    keyHint: trimmed.slice(-4),
    updatedAt: new Date(),
  }
  await db
    .insert(userApiKey)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userApiKey.userId, set: values })

  return { hint: values.keyHint }
}

export async function removeAnthropicKey() {
  const userId = await requireUser()
  // Only clear the Anthropic columns — the same row may hold an
  // OpenAI-compatible key the user wants to keep.
  await db
    .update(userApiKey)
    .set({ anthropicKeyEnc: null, keyHint: null, updatedAt: new Date() })
    .where(eq(userApiKey.userId, userId))
}

/** OpenAI-compatible BYOK (Groq, Together, OpenRouter, LM Studio…) —
 *  used by the delegation planner/verifier when no Anthropic key is set,
 *  so a free Groq key is enough to try delegation end to end. */
export async function saveOpenAiKey(input: { baseUrl: string; apiKey: string; model: string }) {
  const userId = await requireUser()
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = input.apiKey.trim()
  const model = input.model.trim()
  if (!/^https:\/\/.+/.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
    throw new Error('Base URL must be https:// (or http://localhost for a local server)')
  }
  if (apiKey.length < 8) throw new Error('That does not look like an API key')
  if (!model) throw new Error('Model is required (e.g. llama-3.3-70b-versatile)')

  const values = {
    openaiBaseUrl: baseUrl,
    openaiKeyEnc: encryptSecret(apiKey),
    openaiModel: model,
    openaiHint: apiKey.slice(-4),
    updatedAt: new Date(),
  }
  await db
    .insert(userApiKey)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userApiKey.userId, set: values })
  return { hint: values.openaiHint }
}

export async function removeOpenAiKey() {
  const userId = await requireUser()
  await db
    .update(userApiKey)
    .set({ openaiBaseUrl: null, openaiKeyEnc: null, openaiModel: null, openaiHint: null, updatedAt: new Date() })
    .where(eq(userApiKey.userId, userId))
}
