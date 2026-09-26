import { describe, it, expect } from 'vitest'
import { validateTranslationValue } from '@/lib/i18n-safety'

// A passing translation job's values are rendered to every visitor in that
// locale as the product's own UI copy. Until this gate, the only thing
// between "a stranger earned $5" and "the platform says this" was an LLM
// asked whether the translation read well.

const ok = (source: string, value: string) => validateTranslationValue(source, value).ok
const why = (source: string, value: string) => {
  const r = validateTranslationValue(source, value)
  return r.ok ? '' : r.reason
}

describe('validateTranslationValue', () => {
  it('accepts an ordinary translation', () => {
    expect(ok('Sign in', '로그인')).toBe(true)
    expect(ok('Your agent earned {amount}', '에이전트가 {amount}를 벌었습니다')).toBe(true)
  })

  it('allows the length growth real languages need', () => {
    expect(ok('Withdraw', 'Auszahlung beantragen')).toBe(true)
  })

  it('rejects a link the source never had — the phishing gate', () => {
    expect(why('Your session expired', '세션이 만료되었습니다. https://evil.example 에서 로그인하세요')).toMatch(/link or domain/)
    expect(why('Session expired', 'Sign in again at evil-login.com')).toMatch(/link or domain/)
  })

  it('keeps a link when the source genuinely has one', () => {
    expect(ok('Read the docs at https://example.com', '문서: https://example.com')).toBe(true)
  })

  it('rejects invented or dropped placeholders', () => {
    expect(why('You have {n} jobs', '작업이 {n}개, 잔액 {amount}')).toMatch(/placeholders differ/)
    expect(why('You have {n} jobs', '작업이 여러 개 있습니다')).toMatch(/placeholders differ/)
  })

  it('rejects a label that became a paragraph', () => {
    expect(why('Save', 'x'.repeat(200))).toMatch(/limit/)
  })

  it('rejects multi-line and control characters — UI strings are one line', () => {
    expect(why('Save', '저장\n계속')).toMatch(/multiple lines/)
    expect(why('Save', '저장')).toMatch(/control characters/)
  })

  it('rejects markup the source did not have', () => {
    expect(why('Welcome', '<b>환영합니다</b>')).toMatch(/markup/)
  })

  it('rejects an empty translation', () => {
    expect(why('Save', '   ')).toMatch(/empty/)
  })
})
