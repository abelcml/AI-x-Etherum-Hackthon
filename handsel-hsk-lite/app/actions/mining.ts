'use server'

/**
 * One-click mining setup: everything between "I have a GPU" and "it's
 * earning" collapsed into a single action — create a worker agent,
 * provision its on-chain account, turn auto-mine on, mint the local
 * worker connect command. The only step left for the human is pasting
 * one command into their terminal, which is irreducible: the worker has
 * to run on THEIR machine, that's the whole point.
 */
import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { asActionError } from '@/lib/action-error'
import { createAgent } from '@/app/actions/agents'
import { provisionSmartAccount } from '@/app/actions/onchain'
import { connectLocalWorker, setCloudApiWorker } from '@/app/actions/webhook'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

/** Shared first half of both onboarding paths: create the worker agent,
 *  provision its on-chain account, flip auto-mine on. Only the last step
 *  (how the agent actually runs) differs between the two. */
async function createAutoMineAgent(description: string) {
  const { id } = await createAgent({ name: `Worker-${nanoid(4)}`, description })

  // Provision the on-chain account (needed to accept paid jobs). If the
  // deployment runs off-chain, mining setup still completes — jobs just
  // require provisioning later.
  let provisioned = true
  try {
    await provisionSmartAccount(id)
  } catch (error) {
    provisioned = false
    console.error('[mining] provisioning skipped/failed (off-chain deployment?):', error)
  }

  await db.update(agent).set({ autoMine: true, updatedAt: new Date() }).where(eq(agent.id, id))
  return { id, provisioned }
}

export async function startMining() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  try {
    const { id, provisioned } = await createAutoMineAgent('Local GPU worker (auto-mine)')
    const { command } = await connectLocalWorker(id)

    revalidatePath('/mine')
    return { agentId: id, command, provisioned }
  } catch (error) {
    throw asActionError(error, 'startMining')
  }
}

/**
 * The "paste an API key, no terminal" onboarding path for mining — same
 * pipeline as startMining() (agent + wallet + auto-mine), but the last step
 * connects a cloud API key (runtimeType: 'cloud') instead of minting a
 * local-worker connect command. Auto-mine still works for a cloud agent:
 * since it never polls on its own, tickCloudAutoMineAgents() (wired into
 * getJobs()/getWorkerConsole()) sweeps it opportunistically instead of the
 * agent's own heartbeat driving it — see lib/auto-mine.ts.
 */
export async function startMiningCloud(input: { baseUrl: string; apiKey: string; model: string }) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  try {
    const { id, provisioned } = await createAutoMineAgent('Cloud API worker (auto-mine)')
    await setCloudApiWorker(id, input)

    revalidatePath('/mine')
    return { agentId: id, provisioned }
  } catch (error) {
    throw asActionError(error, 'startMiningCloud')
  }
}

export async function setAutoMine(agentId: string, enabled: boolean) {
  await requireOwnedAgent(agentId)
  await db.update(agent).set({ autoMine: enabled, updatedAt: new Date() }).where(eq(agent.id, agentId))
  revalidatePath('/mine')
  return { autoMine: enabled }
}
