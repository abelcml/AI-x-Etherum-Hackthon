'use server'

import { getSession } from '@/lib/get-session'
import { db } from '@/lib/db'
import { agent, agentTemplate, agentTemplatePurchase, agentEvent, verifiableTask } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { nanoid } from 'nanoid'
import { randomBytes } from 'node:crypto'
import { enforceSpendingPolicy } from '@/lib/treasury-policy'
import { asActionError } from '@/lib/action-error'
import { logPlatformEvent } from '@/lib/platform-feed'

async function requireUser() {
  const session = await getSession()
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function requireOwnedAgent(agentId: string, userId: string) {
  const [found] = await db.select().from(agent).where(eq(agent.id, agentId))
  if (!found || found.userId !== userId) throw new Error('Agent not found')
  return found
}

/**
 * Publish one of your agents' "recipe" (custom instructions) as a template
 * other users can buy. Credit history is never part of what's sold — buyers
 * get the recipe, not your reputation.
 */
export async function publishTemplate(input: {
  exemplarAgentId: string
  name: string
  description: string
  customInstructions: string
  priceUsd: number
}) {
  const userId = await requireUser()
  await requireOwnedAgent(input.exemplarAgentId, userId)
  if (!input.name.trim()) throw new Error('Name required')
  if (!input.customInstructions.trim()) throw new Error('Instructions required')
  if (!Number.isFinite(input.priceUsd) || input.priceUsd < 0) throw new Error('Invalid price')

  const id = nanoid()
  await db.insert(agentTemplate).values({
    id,
    creatorUserId: userId,
    exemplarAgentId: input.exemplarAgentId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    customInstructions: input.customInstructions.trim(),
    priceUsd: input.priceUsd.toString(),
  })
  await logPlatformEvent('TEMPLATE_PUBLISHED', `New template "${input.name.trim()}" listed for $${input.priceUsd.toLocaleString()}`)
  revalidatePath('/jobs')
  return { id }
}

export async function unpublishTemplate(templateId: string) {
  const userId = await requireUser()
  const [tpl] = await db.select().from(agentTemplate).where(eq(agentTemplate.id, templateId))
  if (!tpl || tpl.creatorUserId !== userId) throw new Error('Template not found')
  await db.update(agentTemplate).set({ active: false }).where(eq(agentTemplate.id, templateId))
  revalidatePath('/jobs')
}

/**
 * Published templates, each with a real portfolio snippet pulled from the
 * creator's exemplar agent's actual behavioral history — genuine completed
 * task outputs and verified-task pass count, not marketing claims.
 */
export async function getTemplates() {
  const userId = await requireUser()
  const templates = await db
    .select()
    .from(agentTemplate)
    .where(eq(agentTemplate.active, true))
    .orderBy(desc(agentTemplate.createdAt))

  const myAgents = await db.select().from(agent).where(eq(agent.userId, userId))

  const enriched = await Promise.all(
    templates.map(async (t) => {
      const [exemplar] = await db.select().from(agent).where(eq(agent.id, t.exemplarAgentId))
      const recentEvents = await db
        .select()
        .from(agentEvent)
        .where(and(eq(agentEvent.agentId, t.exemplarAgentId), eq(agentEvent.eventType, 'TASK_COMPLETED')))
        .orderBy(desc(agentEvent.createdAt))
        .limit(3)
      const verifiedPassed = await db
        .select()
        .from(verifiableTask)
        .where(and(eq(verifiableTask.solverAgentId, t.exemplarAgentId), eq(verifiableTask.status, 'completed')))

      return {
        id: t.id,
        name: t.name,
        description: t.description,
        priceUsd: parseFloat(t.priceUsd),
        mine: t.creatorUserId === userId,
        creatorUserId: t.creatorUserId,
        creator: {
          agentName: exemplar?.name ?? 'Unknown',
          score: exemplar ? Math.round(parseFloat(exemplar.creditScore)) : null,
          rating: exemplar?.creditRating ?? 'unrated',
        },
        portfolio: {
          sampleOutputs: recentEvents.map((e) => ({
            taskId: e.taskId,
            preview: String((e.detail as any)?.output_preview ?? '').slice(0, 220),
            quality: e.qualityScore ? parseFloat(e.qualityScore) : null,
          })),
          verifiedTasksPassed: verifiedPassed.length,
        },
      }
    }),
  )

  return {
    templates: enriched,
    myAgents: myAgents.map((a) => ({ id: a.id, name: a.name, provisioned: Boolean(a.smartAccountAddress) })),
  }
}

/**
 * Buy (or free-clone) a template: pay the creator on-chain if priced, then
 * spawn a brand-new, genuinely cold-start agent for the buyer seeded with
 * the recipe. Nothing about the seller's credit history transfers.
 */
export async function purchaseTemplate(templateId: string, payingAgentId: string | null, newAgentName: string) {
  const userId = await requireUser()
  const [tpl] = await db.select().from(agentTemplate).where(eq(agentTemplate.id, templateId))
  if (!tpl || !tpl.active) throw new Error('Template not found')
  if (!newAgentName.trim()) throw new Error('Name your new agent')

  const price = parseFloat(tpl.priceUsd)
  let txHash: string | null = null

  if (price > 0) {
    if (!payingAgentId) throw new Error('Select an agent to pay from')
    const payer = await requireOwnedAgent(payingAgentId, userId)
    if (!payer.smartAccountAddress) throw new Error('The paying agent needs a provisioned smart account')

    const [creatorExemplar] = await db.select().from(agent).where(eq(agent.id, tpl.exemplarAgentId))
    if (!creatorExemplar?.smartAccountAddress) {
      throw new Error("This template's creator has not provisioned a receiving account yet")
    }

    await enforceSpendingPolicy(payingAgentId, price)
    try {
      const { usdcBalanceOf, transferUsdc } = await import('@/lib/onchain/treasury')
      const balance = await usdcBalanceOf(payer.smartAccountAddress as `0x${string}`)
      if (price > balance) throw new Error(`Insufficient balance ($${balance.toFixed(2)})`)

      // A purchase that reports failure while the payment landed invites the
      // buyer to pay twice for one template. Record and continue on pending:
      // the money has probably moved, and charging twice is the worse error.
      try {
        txHash = await transferUsdc(payingAgentId, creatorExemplar.smartAccountAddress as `0x${string}`, price)
      } catch (error) {
        const { isUserOpPending } = await import('@/lib/onchain/account')
        if (!isUserOpPending(error)) throw error
        txHash = error.userOpHash
        console.warn(`[marketplace] payment for template ${templateId} is pending confirmation — granting and recording`)
      }

      await db.insert(agentEvent).values({
        id: nanoid(),
        agentId: payingAgentId,
        taskId: `template-${templateId}`,
        eventType: 'WALLET_TRANSFER',
        success: true,
        executionTime: 0,
        tokenCost: 0,
        qualityScore: null,
        detail: {
          amountUsd: price,
          to: creatorExemplar.smartAccountAddress,
          memo: `Bought template: ${tpl.name}`,
          txHash,
          initiator: 'owner',
        },
      })
    } catch (error) {
      throw asActionError(error, 'purchaseTemplate')
    }
  }

  const newAgentId = nanoid()
  await db.insert(agent).values({
    id: newAgentId,
    userId,
    name: newAgentName.trim(),
    walletAddress: `0x${randomBytes(20).toString('hex')}`,
    description: tpl.description ?? `Cloned from template "${tpl.name}"`,
    customInstructions: tpl.customInstructions,
    modelVersion: 'claude-sonnet-5',
    creditScore: '0',
    creditRating: 'unrated',
    riskLevel: 'UNKNOWN',
    riskRating: 'unrated',
    totalCreditLine: '0',
    availableCredit: '0',
  })

  await db.insert(agentTemplatePurchase).values({
    id: nanoid(),
    templateId,
    buyerUserId: userId,
    buyerAgentId: newAgentId,
    priceUsd: price.toString(),
    txHash,
  })

  await logPlatformEvent(
    'TEMPLATE_PURCHASED',
    price > 0
      ? `"${tpl.name}" was purchased for $${price.toLocaleString()}`
      : `"${tpl.name}" was cloned`,
  )

  revalidatePath('/jobs')
  revalidatePath('/')
  revalidatePath('/agents')
  return { agentId: newAgentId, txHash }
}
