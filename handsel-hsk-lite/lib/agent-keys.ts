/**
 * Per-agent keys, universally — every worker gets its own identity.
 *
 * Before this file, only BYO runtimes (webhook/local/cloud/mcp) had a
 * per-agent secret. 'platform' agents authenticated their callbacks with the
 * single RUNTIME_SHARED_SECRET — one env var whose leak would let anyone
 * forge task results, gradings and settlements for EVERY platform-runtime
 * agent at once. In pod terms: the whole fleet shared one service account.
 *
 * Now every agent is issued a unique key (32 random bytes, AES-256-GCM at
 * rest, echoed once at issuance like every other secret here). The callback
 * gate accepts the per-agent key for every runtime type. The shared secret
 * remains accepted FOR 'platform' AGENTS ONLY, because the external Python
 * runtime presents the secret it was configured with and cannot present a
 * per-agent key until it learns to echo one — dual acceptance is the honest
 * transition state, and STRICT_AGENT_KEYS=true ends it when the runtime is
 * ready.
 */
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { encryptSecret } from '@/lib/crypto'
import { generateWebhookSecret } from '@/lib/webhook'

/** Issue a key for one agent if it has none. Returns true when a key was
 *  minted. Never overwrites — rotation is an explicit owner action, not a
 *  side effect. */
export async function ensureAgentKey(agentId: string): Promise<boolean> {
  const [row] = await db.select({ id: agent.id, enc: agent.webhookSecretEnc }).from(agent).where(eq(agent.id, agentId))
  if (!row || row.enc) return false
  await db
    .update(agent)
    .set({ webhookSecretEnc: encryptSecret(generateWebhookSecret()), updatedAt: new Date() })
    .where(eq(agent.id, agentId))
  return true
}

/**
 * Fleet-wide backfill, run from the ops heartbeat: any agent still without a
 * key gets one. Bounded per pass so a huge backlog cannot stall the cron.
 * This is the controller ensuring every pod has its identity.
 */
export async function ensureFleetKeys(maxPerPass = 25): Promise<number> {
  const missing = await db
    .select({ id: agent.id })
    .from(agent)
    .where(isNull(agent.webhookSecretEnc))
    .limit(maxPerPass)
  let issued = 0
  for (const row of missing) {
    try {
      if (await ensureAgentKey(row.id)) issued++
    } catch (error) {
      console.error(`[agent-keys] issuing key for ${row.id} failed:`, error)
    }
  }
  return issued
}
