import { describe, expect, it } from 'vitest'
import { assembleFinalOutput, type DelegationSubtask } from '@/lib/delegation'

const st = (title: string, output: string | null, failed = false): DelegationSubtask => ({
  title,
  description: 'd',
  acceptanceCriteria: 'c',
  bountyUsd: 2,
  output,
  failed,
  failReason: failed ? 'graded fail' : undefined,
})

describe('assembleFinalOutput placeholder substitution', () => {
  it('splices an explicit {{PART: title}} token and folds the consumed part in (single-doc mode)', () => {
    const guide = 'Intro text.\n\n{{PART: Write the code example}}\n\nOutro.'
    const code = '```python\nprint(1)\n```'
    const out = assembleFinalOutput('task', [st('Write the guide', guide), st('Write the code example', code)])
    expect(out).toContain('print(1)')
    expect(out).not.toContain('{{PART:')
    // everything merged into the guide → pure document, no Part headers
    expect(out).not.toContain('## ')
    expect(out.startsWith('Intro text.')).toBe(true)
  })

  it('resolves ALL-CAPS bracket placeholders with slot keywords by title overlap', () => {
    const doc = 'How to pay fees.\n\n[CODE EXAMPLE GOES HERE]\n\nDone.'
    const code = 'const fee = 1'
    const out = assembleFinalOutput('task', [st('Fee guide', doc), st('Code example for fees', code)])
    expect(out).toContain('const fee = 1')
    expect(out).not.toContain('[CODE EXAMPLE GOES HERE]')
  })

  it('never touches code-looking brackets or unresolvable placeholders', () => {
    const a = 'Use arr[0] and see [TODO] plus [SOMETHING UNRELATED HERE].'
    const b = 'Independent part.'
    const out = assembleFinalOutput('task', [st('Alpha', a), st('Beta', b)])
    expect(out).toContain('arr[0]')
    expect(out).toContain('[TODO]')
    expect(out).toContain('[SOMETHING UNRELATED HERE]') // slot keyword but no title overlap
    expect(out).toContain('## Alpha')
    expect(out).toContain('## Beta') // nothing consumed — both sections present
  })

  it('leaves the marker visible when the target part failed, and lists the failure', () => {
    const doc = 'Guide.\n\n{{PART: Broken code part}}'
    const out = assembleFinalOutput('task', [st('Guide part', doc), st('Broken code part', null, true)])
    expect(out).toContain('{{PART: Broken code part}}')
    expect(out).toContain('did not complete')
  })
})
