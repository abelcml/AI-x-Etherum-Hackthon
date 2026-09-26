/**
 * Procedural math problem generator — the ground truth for verifiable tasks.
 *
 * Problems are freshly generated per task (never from a corpus), so the
 * solver cannot have memorized them; answers are exact integers computed
 * here with BigInt. The server keeps the answer secret — the solving agent
 * only ever sees the problem text. Grader ≠ solver by construction.
 */
import { randomBytes } from 'node:crypto'

export type Difficulty = 1 | 2 | 3 | 4 | 5

export type VerifiableProblem = {
  difficulty: Difficulty
  problem: string
  answer: string // exact integer as decimal string
}

function randInt(min: bigint, max: bigint): bigint {
  // Uniform-enough for problem generation: 8 random bytes mod range.
  const range = max - min + 1n
  const raw = BigInt('0x' + randomBytes(8).toString('hex'))
  return min + (raw % range)
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  let b = base % mod
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod
    b = (b * b) % mod
    e >>= 1n
  }
  return result
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}

export function generateProblem(difficulty: Difficulty): VerifiableProblem {
  switch (difficulty) {
    case 1: {
      // 3-digit × 3-digit
      const a = randInt(100n, 999n)
      const b = randInt(100n, 999n)
      return { difficulty, problem: `Compute ${a} × ${b}.`, answer: (a * b).toString() }
    }
    case 2: {
      // (5-digit × 4-digit) mod 4-digit
      const a = randInt(10_000n, 99_999n)
      const b = randInt(1_000n, 9_999n)
      const m = randInt(1_000n, 9_999n)
      return {
        difficulty,
        problem: `Compute (${a} × ${b}) mod ${m}.`,
        answer: ((a * b) % m).toString(),
      }
    }
    case 3: {
      // Modular exponentiation with moderate operands
      const base = randInt(100n, 999n)
      const exp = randInt(50n, 300n)
      const mod = randInt(10_000n, 99_999n)
      return {
        difficulty,
        problem: `Compute ${base}^${exp} mod ${mod}.`,
        answer: modPow(base, exp, mod).toString(),
      }
    }
    case 4: {
      // gcd of two products — forces multi-step exact arithmetic
      const a = randInt(10_000n, 99_999n)
      const b = randInt(10_000n, 99_999n)
      const c = randInt(1_000n, 9_999n)
      return {
        difficulty,
        problem: `Compute gcd(${a} × ${c}, ${b} × ${c}).`,
        answer: gcd(a * c, b * c).toString(),
      }
    }
    case 5: {
      // Large modular exponentiation — infeasible without systematic method
      const base = randInt(100_000n, 999_999n)
      const exp = randInt(1_000n, 9_999n)
      const mod = randInt(1_000_000n, 9_999_999n)
      return {
        difficulty,
        problem: `Compute ${base}^${exp} mod ${mod}.`,
        answer: modPow(base, exp, mod).toString(),
      }
    }
  }
}

/** Prompt wrapper: forces a machine-parseable final line. */
export function problemPrompt(problem: string): string {
  return (
    `${problem}\n\n` +
    `Work through this carefully using the calculator tool for every arithmetic step — do not estimate. ` +
    `Your final line MUST be exactly:\nFINAL_ANSWER: <integer>`
  )
}

/** Extract the last FINAL_ANSWER from agent output; null if absent. */
export function extractAnswer(output: string): string | null {
  const matches = [...output.matchAll(/FINAL_ANSWER:\s*(-?\d+)/g)]
  return matches.length > 0 ? matches[matches.length - 1][1] : null
}
