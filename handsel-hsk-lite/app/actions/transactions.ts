'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { creditTransaction, creditLine } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'

async function getUserId() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function getTransactions() {
  const userId = await getUserId()
  return db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.userId, userId))
    .orderBy(desc(creditTransaction.createdAt))
}

export async function createTransaction(data: {
  fromAgentId: string
  toAgentId?: string
  amount: string
  type: string
  description?: string
}) {
  const userId = await getUserId()
  const txId = nanoid()

  await db.insert(creditTransaction).values({
    id: txId,
    userId,
    fromAgentId: data.fromAgentId,
    toAgentId: data.toAgentId,
    status: 'pending',
    amount: data.amount,
    type: data.type,
    description: data.description,
  })

  revalidatePath('/transactions')
  return { id: txId }
}

export async function approveTransaction(txId: string) {
  const userId = await getUserId()

  // Verify ownership
  const tx = await db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.id, txId))
  if (tx.length === 0 || tx[0].userId !== userId) {
    throw new Error('Transaction not found or unauthorized')
  }

  // Update transaction
  await db
    .update(creditTransaction)
    .set({ status: 'approved', approvedAt: new Date() })
    .where(eq(creditTransaction.id, txId))

  // Update credit line
  const creditLines = await db
    .select()
    .from(creditLine)
    .where(eq(creditLine.agentId, tx[0].fromAgentId))
  if (creditLines.length > 0) {
    const line = creditLines[0]
    const newUsed = parseFloat(line.used) + parseFloat(tx[0].amount)
    const newAvailable = parseFloat(line.available) - parseFloat(tx[0].amount)
    await db
      .update(creditLine)
      .set({ used: newUsed.toString(), available: newAvailable.toString() })
      .where(eq(creditLine.id, line.id))
  }

  revalidatePath('/transactions')
}

export async function rejectTransaction(txId: string) {
  const userId = await getUserId()

  const tx = await db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.id, txId))
  if (tx.length === 0 || tx[0].userId !== userId) {
    throw new Error('Transaction not found or unauthorized')
  }

  await db
    .update(creditTransaction)
    .set({ status: 'rejected', rejectedAt: new Date() })
    .where(eq(creditTransaction.id, txId))

  revalidatePath('/transactions')
}

export async function settleTransaction(txId: string) {
  const userId = await getUserId()

  const tx = await db
    .select()
    .from(creditTransaction)
    .where(eq(creditTransaction.id, txId))
  if (tx.length === 0 || tx[0].userId !== userId) {
    throw new Error('Transaction not found or unauthorized')
  }

  await db
    .update(creditTransaction)
    .set({ status: 'settled', settledAt: new Date() })
    .where(eq(creditTransaction.id, txId))

  revalidatePath('/transactions')
}
