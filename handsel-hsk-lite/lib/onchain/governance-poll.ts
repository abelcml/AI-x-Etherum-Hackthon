/**
 * On-chain commit-reveal governance — VeilPoll + VeilPollFactory.
 *
 * Gated behind isGovernanceOnchainConfigured(): with VEILPOLL_FACTORY_ADDRESS
 * unset, none of this runs and governance is purely off-chain. When set, a
 * proposal deploys its own VeilPoll via the factory, and confident delegate
 * votes are committed then revealed on-chain via each agent's own smart
 * account (the platform is already the authorized signer behind those
 * accounts, so no session-key handshake is needed — unlike a user-wallet
 * design).
 *
 * Each proposal = one VeilPoll CONTRACT (factory pattern), addressed by its
 * deployed address (not a numeric id). The on-chain record is
 * one-address-one-CHOICE; ve-weight is applied off-chain. Every function
 * here is best-effort and must never break the off-chain path.
 */
import { encodeFunctionData, encodePacked, keccak256, parseEventLogs, toHex, type Address, type Hex } from 'viem'
import { onchainEnv, isGovernanceOnchainConfigured } from './config'
import { publicClient } from './clients'
import { sendAgentCall, getAgentAccountAddress } from './account'

/** for → 0, against → 1, abstain → 2 (indices into the poll's options). */
export const CHOICE_TO_OPTION = { for: 0, against: 1, abstain: 2 } as const
export const POLL_OPTIONS = ['for', 'against', 'abstain'] as const

export const VEILPOLL_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createPoll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'options', type: 'string[]' },
      { name: 'commitDurationSec', type: 'uint256' },
      { name: 'revealDurationSec', type: 'uint256' },
    ],
    outputs: [{ name: 'poll', type: 'address' }],
  },
  { type: 'function', name: 'pollCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'event',
    name: 'PollCreated',
    inputs: [
      { name: 'poll', type: 'address', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'commitDeadline', type: 'uint256', indexed: false },
      { name: 'revealDeadline', type: 'uint256', indexed: false },
    ],
  },
] as const

export const VEILPOLL_ABI = [
  {
    type: 'function',
    name: 'commitVote',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealVote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'optionId', type: 'uint256' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'currentPhase', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'getResults', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256[]' }] },
] as const

/** VeilPoll.Phase enum. */
export const PHASE = { Commit: 0, Reveal: 1, Ended: 2 } as const

function factoryAddress(): Address {
  return onchainEnv.veilpollFactoryAddress as Address
}

/** Fresh 32-byte salt as a hex string (stored encrypted until reveal). */
export function newSalt(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes, { size: 32 })
}

/** commitment = keccak256(abi.encodePacked(uint256(optionId), salt, voter)). */
export function computeCommitment(optionId: number, salt: Hex, voter: Address): Hex {
  return keccak256(encodePacked(['uint256', 'bytes32', 'address'], [BigInt(optionId), salt, voter]))
}

/**
 * Deploy a VeilPoll for a proposal via the factory. Durations are relative
 * (VeilPoll computes deadlines from block.timestamp at deploy). Returns the
 * new poll's ADDRESS (parsed from the PollCreated event), or null if
 * off/failed.
 */
export async function createOnchainPoll(
  creatorAgentId: string,
  commitDurationSec: number,
  revealDurationSec: number,
): Promise<Address | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const data = encodeFunctionData({
      abi: VEILPOLL_FACTORY_ABI,
      functionName: 'createPoll',
      args: [POLL_OPTIONS as unknown as string[], BigInt(commitDurationSec), BigInt(revealDurationSec)],
    })
    const txHash = await sendAgentCall(creatorAgentId, { to: factoryAddress(), data })
    const receipt = await publicClient().getTransactionReceipt({ hash: txHash })
    const events = parseEventLogs({ abi: VEILPOLL_FACTORY_ABI, eventName: 'PollCreated', logs: receipt.logs })
    const poll = events[0]?.args?.poll as Address | undefined
    return poll ?? null
  } catch (error) {
    console.error('[veilpoll] createOnchainPoll failed (non-fatal):', error)
    return null
  }
}

/** Commit a hidden vote from an agent's smart account to a specific VeilPoll.
 *  Returns {salt, txHash} on success (caller stores the salt, encrypted). */
export async function commitOnchainVote(
  agentId: string,
  pollAddress: Address,
  optionId: number,
): Promise<{ salt: Hex; txHash: Hex } | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const voter = await getAgentAccountAddress(agentId)
    const salt = newSalt()
    const commitment = computeCommitment(optionId, salt, voter)
    const data = encodeFunctionData({ abi: VEILPOLL_ABI, functionName: 'commitVote', args: [commitment] })
    const txHash = await sendAgentCall(agentId, { to: pollAddress, data })
    return { salt, txHash }
  } catch (error) {
    console.error('[veilpoll] commitOnchainVote failed (non-fatal):', error)
    return null
  }
}

/** Reveal a previously committed vote during the reveal window. */
export async function revealOnchainVote(
  agentId: string,
  pollAddress: Address,
  optionId: number,
  salt: Hex,
): Promise<Hex | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const data = encodeFunctionData({ abi: VEILPOLL_ABI, functionName: 'revealVote', args: [BigInt(optionId), salt] })
    return await sendAgentCall(agentId, { to: pollAddress, data })
  } catch (error) {
    console.error('[veilpoll] revealOnchainVote failed (non-fatal):', error)
    return null
  }
}

/** VeilPoll phase: 0 Commit, 1 Reveal, 2 Ended, null if off/unreadable. */
export async function pollPhase(pollAddress: Address): Promise<number | null> {
  if (!isGovernanceOnchainConfigured()) return null
  try {
    const phase = await publicClient().readContract({
      address: pollAddress,
      abi: VEILPOLL_ABI,
      functionName: 'currentPhase',
    })
    return Number(phase)
  } catch {
    return null
  }
}
