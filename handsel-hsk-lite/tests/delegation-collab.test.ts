/**
 * ③ synthesis + ④ recursive subcontract — the pure logic.
 */
import { describe, it, expect } from 'vitest'
import {
  parsePlannerOutput,
  expandSubcontracts,
  assembleFinalOutput,
  type DelegationSubtask,
} from '@/lib/delegation'

const sub = (over: Partial<DelegationSubtask> & { title: string }): DelegationSubtask => ({
  description: 'do the thing, self-contained',
  acceptanceCriteria: 'the thing is done to spec',
  bountyUsd: 5,
  deliverableKind: 'text',
  testCode: null,
  ...over,
})

describe('③ synthesis', () => {
  it('parses synthesizes and auto-depends on every piece', () => {
    const out = parsePlannerOutput(
      JSON.stringify([
        sub({ title: 'A' }),
        sub({ title: 'B' }),
        sub({ title: 'Final', synthesizes: ['A', 'B'] }),
      ]),
      20,
    )
    const f = out.find((s) => s.synthesizes)!
    expect(f.synthesizes).toEqual(['A', 'B'])
    expect(f.dependsOn).toEqual(['A', 'B'])
  })

  it("uses the single top-level synthesis's output as the final deliverable", () => {
    const plan: DelegationSubtask[] = [
      sub({ title: 'A', output: 'piece A' }),
      sub({ title: 'B', output: 'piece B' }),
      sub({ title: 'Final', synthesizes: ['A', 'B'], dependsOn: ['A', 'B'], output: 'A + B, woven together' }),
    ]
    expect(assembleFinalOutput('report', plan)).toBe('A + B, woven together')
  })

  it('rejects a synthesis of an unknown piece', () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify([sub({ title: 'A' }), sub({ title: 'F', synthesizes: ['Nope'] })]), 20),
    ).toThrow(/integrates unknown/)
  })

  it('picks the FINAL synthesis, not a subcontract-parent one, when ③ and ④ coexist', () => {
    // A ④ subcontract parent (synthesizes only its own children) must not be
    // mistaken for the delegation's final deliverable.
    const plan: DelegationSubtask[] = [
      sub({ title: 'M · child one', parentTitle: 'M', output: 'c1' }),
      sub({ title: 'M · child two', parentTitle: 'M', output: 'c2' }),
      sub({ title: 'M', synthesizes: ['M · child one', 'M · child two'], output: 'assembled M' }),
      sub({ title: 'Other', output: 'other' }),
      sub({ title: 'Final', synthesizes: ['M', 'Other'], output: 'THE FINAL BRIEF' }),
    ]
    expect(assembleFinalOutput('brief', plan)).toBe('THE FINAL BRIEF')
  })
})

describe('④ recursive subcontract', () => {
  const stubPlan = async (_task: string, budget: number): Promise<DelegationSubtask[]> => [
    sub({ title: 'part one', bountyUsd: Math.round(budget * 0.5 * 100) / 100 }),
    sub({ title: 'part two', bountyUsd: Math.round(budget * 0.5 * 100) / 100 }),
  ]

  it('expands a subcontract into namespaced children + a synthesis, within budget', async () => {
    const top = [sub({ title: 'Big piece', bountyUsd: 10, subcontract: true })]
    const expanded = await expandSubcontracts(top, stubPlan)

    const children = expanded.filter((s) => s.parentTitle === 'Big piece')
    const synth = expanded.find((s) => s.title === 'Big piece')!
    expect(children.map((c) => c.title)).toEqual(['Big piece · part one', 'Big piece · part two'])
    expect(synth.synthesizes).toEqual(['Big piece · part one', 'Big piece · part two'])

    const total = expanded.reduce((s, x) => s + x.bountyUsd, 0)
    expect(total).toBeLessThanOrEqual(10 + 1e-9) // never exceeds the original bounty
  })

  it('leaves non-subcontract subtasks untouched and strips the flag', async () => {
    const top = [sub({ title: 'Plain', subcontract: false }), sub({ title: 'Marked', bountyUsd: 8, subcontract: true })]
    const expanded = await expandSubcontracts(top, stubPlan)
    expect(expanded.find((s) => s.title === 'Plain')?.subcontract).toBeUndefined()
    expect(expanded.some((s) => s.parentTitle === 'Marked')).toBe(true)
  })

  it('falls back to a single job when sub-planning yields nothing', async () => {
    const top = [sub({ title: 'Big', bountyUsd: 6, subcontract: true })]
    const expanded = await expandSubcontracts(top, async () => [])
    expect(expanded).toHaveLength(1)
    expect(expanded[0].subcontract).toBeUndefined()
    expect(expanded[0].synthesizes).toBeUndefined()
  })
})
