'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentEvent, creditTransaction } from '@/lib/db/schema'
import { recalculateCredit, ownerOutstandingBalance } from '@/lib/credit-engine'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'

async function requireOwnedAgent(agentId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== session.user.id) throw new Error('Agent not found')
  return { agent: found, userId: session.user.id }
}

/** Active (drawn, not-yet-repaid) credit for an agent. */
export async function getCreditDraws(agentId: string) {
  await requireOwnedAgent(agentId)
  return db
    .select()
    .from(creditTransaction)
    .where(
      and(
        eq(creditTransaction.fromAgentId, agentId),
        eq(creditTransaction.type, 'credit_draw'),
        eq(creditTransaction.status, 'active'),
      ),
    )
    .orderBy(desc(creditTransaction.createdAt))
}

/**
 * Draw against the agent's available credit line. Bounded by availableCredit,
 * which the scoring engine derives from the credit limit minus outstanding draws.
 *
 * Also bounded by the owner's total exposure across every agent they own —
 * without this, leaving one agent's draw unpaid and creating a fresh agent
 * would net a second, independent credit line with zero regard for the
 * first agent's unpaid balance (agent.availableCredit is per-agent by
 * design, see lib/credit-engine's comment, so it alone can't catch this).
 */
export async function drawCredit(agentId: string, amount: number, description?: string) {
  const { agent: ag, userId } = await requireOwnedAgent(agentId)

  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be positive')
  const available = parseFloat(ag.availableCredit ?? '0')
  if (amount > available) {
    throw new Error(`Amount exceeds available credit ($${Math.round(available).toLocaleString()})`)
  }

  // Delinquency gate: an owner with any past-due or defaulted loan cannot
  // draw more, on any agent. The due date has to bite before the sweep runs.
  await (await import('@/lib/db/ensure-columns')).ensureCreditTransactionColumns()
  const { canDrawMore, dueAtFor, DEFAULT_TERM_DAYS } = await import('@/lib/loan-terms')
  const openLoans = (
    await db.select().from(creditTransaction).where(eq(creditTransaction.userId, userId))
  ).filter((t) => t.type === 'credit_draw' && (t.status === 'active' || t.status === 'defaulted'))
  const gate = canDrawMore(new Date(), openLoans)
  if (!gate.ok) throw new Error(gate.reason)

  const ownerOutstanding = await ownerOutstandingBalance(userId)
  const ownerNettedAvailable = Math.max(0, parseFloat(ag.totalCreditLine ?? '0') - ownerOutstanding)
  if (amount > ownerNettedAvailable) {
    throw new Error(
      `Amount exceeds available credit ($${Math.round(ownerNettedAvailable).toLocaleString()}) — you have unpaid balances on other agents`,
    )
  }

  await db.insert(creditTransaction).values({
    id: nanoid(),
    userId,
    fromAgentId: agentId,
    status: 'active',
    amount: amount.toString(),
    type: 'credit_draw',
    description: description || 'Credit draw',
    dueAt: dueAtFor(new Date(), DEFAULT_TERM_DAYS),
    termDays: DEFAULT_TERM_DAYS,
  })

  // Recalculation folds the new outstanding balance into available credit.
  const credit = await recalculateCredit(agentId)
  revalidatePath('/profile')
  return credit
}

/**
 * Repay an active draw. This is a positive credit signal: it emits a
 * REPAYMENT_COMPLETED behavioral event, so the recalculated score reflects a
 * proven repayment — closing the borrow → repay → higher-limit loop.
 */
export async function repayCredit(txId: string) {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')

  const [tx] = await db.select().from(creditTransaction).where(eq(creditTransaction.id, txId))
  if (!tx || tx.userId !== session.user.id) throw new Error('Transaction not found')
  if ((tx.status !== 'active' && tx.status !== 'defaulted') || tx.type !== 'credit_draw') {
    throw new Error('Transaction is not an open credit draw')
  }
  const wasDefaulted = tx.status === 'defaulted'

  await db
    .update(creditTransaction)
    .set({ status: 'settled', settledAt: new Date(), updatedAt: new Date() })
    .where(eq(creditTransaction.id, txId))

  await db.insert(agentEvent).values({
    id: nanoid(),
    agentId: tx.fromAgentId,
    taskId: `repay-${txId}`,
    eventType: 'REPAYMENT_COMPLETED',
    success: true,
    executionTime: 0,
    tokenCost: 0,
    qualityScore: '1.000',
    // A late repayment settles the debt but does not erase the default —
    // the REPAYMENT_DEFAULTED event stays in history, exactly like a real
    // credit record. paymentHistory in scoring nets the two.
    detail: { amount: tx.amount, transactionId: txId, late: wasDefaulted },
  })

  const credit = await recalculateCredit(tx.fromAgentId)
  revalidatePath('/profile')
  return credit
}
