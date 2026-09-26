import { describe, expect, it } from 'vitest'
import { parseGraderVerdict } from '@/lib/text-grading'
import { assertNotSelfClaim } from '@/lib/labor-dispatch'

describe('parseGraderVerdict', () => {
  it('parses a clean verdict', () => {
    expect(parseGraderVerdict('{"pass": true, "reason": "meets all criteria"}')).toEqual({
      pass: true,
      reason: 'meets all criteria',
    })
  })

  it('strips code fences', () => {
    expect(parseGraderVerdict('```json\n{"pass": false, "reason": "missing docstring"}\n```')?.pass).toBe(false)
  })

  it('returns null (no verdict) on garbage or non-boolean pass — never guesses with escrowed money', () => {
    expect(parseGraderVerdict('I think it looks fine')).toBeNull()
    expect(parseGraderVerdict('{"pass": "yes"}')).toBeNull()
    expect(parseGraderVerdict('{}')).toBeNull()
  })
})

describe('assertNotSelfClaim', () => {
  const worker = { name: 'Prime', smartAccountAddress: '0xAbCd00000000000000000000000000000000EF12' } as never

  it('throws with an actionable message when the worker posted the job (case-insensitive)', () => {
    expect(() => assertNotSelfClaim(worker, '0xabcd00000000000000000000000000000000ef12')).toThrow(/own job/)
  })

  it('passes for a different requester or unknown requester', () => {
    expect(() => assertNotSelfClaim(worker, '0x1111111111111111111111111111111111111111')).not.toThrow()
    expect(() => assertNotSelfClaim(worker, undefined)).not.toThrow()
  })
})
