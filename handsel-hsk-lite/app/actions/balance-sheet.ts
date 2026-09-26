'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, creditTransaction, verifiableTask } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return found
}

export type BalanceSheet = {
  configured: boolean
  assets: {
    usdc: number
    creditLine: number // undrawn headroom available to draw right now
    receivables: number // bounties escrowed on-chain for work this agent already delivered, not yet released
  }
  liabilities: {
    outstandingDebt: number // currently unpaid — the actual liability, what Net Worth is computed against
    borrowedLifetime: number // total ever drawn (informational — includes amounts already repaid)
  }
  netWorth: number
}

/**
 * Assets = USDC (real on-chain balance) + Credit Line (undrawn vault headroom)
 *          + Receivables (bounties locked in escrow for jobs/verified tasks
 *            this agent is the worker/solver on, Accepted/Submitted/solving —
 *            contractually earmarked for it, just not released yet).
 * Liabilities = Outstanding Debt (live on-chain vault balance owed).
 * Net Worth = Assets − Outstanding Debt.
 *
 * "Borrowed Credit" (lifetime total drawn, from creditTransaction) is shown
 * alongside Outstanding Debt for context but is NOT subtracted again in Net
 * Worth — repaid amounts are no longer owed, so double-counting them as a
 * second liability would understate net worth.
 */
export async function getBalanceSheet(agentId: string): Promise<BalanceSheet> {
  const ag = await requireOwnedAgent(agentId)

  const { isOnchainConfigured } = await import('@/lib/onchain/config')
  if (!isOnchainConfigured() || !ag.smartAccountAddress) {
    return {
      configured: false,
      assets: { usdc: 0, creditLine: 0, receivables: 0 },
      liabilities: { outstandingDebt: 0, borrowedLifetime: 0 },
      netWorth: 0,
    }
  }

  const address = ag.smartAccountAddress as `0x${string}`

  const [usdc, available, outstanding] = await Promise.all([
    import('@/lib/onchain/treasury').then((m) => m.usdcBalanceOf(address)).catch(() => 0),
    import('@/lib/onchain/credit').then((m) => m.readAvailable(address)).catch(() => 0),
    import('@/lib/onchain/credit').then((m) => m.readOutstanding(address)).catch(() => 0),
  ])

  // Receivables: escrowed bounties for work this agent is the worker/solver
  // on, contractually theirs once approved but not yet released.
  let receivables = 0
  const { isLaborMarketConfigured } = await import('@/lib/onchain/config')
  if (isLaborMarketConfigured()) {
    const { readJobs } = await import('@/lib/onchain/labor')
    const jobs = await readJobs().catch(() => [])
    receivables += jobs
      .filter((j) => j.worker.toLowerCase() === address.toLowerCase() && (j.status === 'Accepted' || j.status === 'Submitted'))
      .reduce((sum, j) => sum + j.bounty, 0)
  }

  const pendingVerified = await db
    .select()
    .from(verifiableTask)
    .where(and(eq(verifiableTask.solverAgentId, agentId)))
  receivables += pendingVerified
    .filter((t) => t.status === 'solving' || t.status === 'settling')
    .reduce((sum, t) => sum + parseFloat(t.bountyUsd), 0)

  // Borrowed Credit: lifetime total ever drawn (informational only).
  const draws = await db
    .select()
    .from(creditTransaction)
    .where(and(eq(creditTransaction.fromAgentId, agentId), eq(creditTransaction.type, 'credit_draw')))
  const borrowedLifetime = draws.reduce((sum, d) => sum + parseFloat(d.amount), 0)

  const creditLine = available
  const assetsTotal = usdc + creditLine + receivables

  return {
    configured: true,
    assets: { usdc, creditLine, receivables },
    liabilities: { outstandingDebt: outstanding, borrowedLifetime },
    netWorth: assetsTotal - outstanding,
  }
}
