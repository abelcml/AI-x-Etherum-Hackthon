import { describe, expect, it } from 'vitest'
import {
  DiffRejectedError,
  applyFilePatch,
  applyUnifiedDiff,
  extractUnifiedDiff,
  parseUnifiedDiff,
  repoJobAcceptanceCriteria,
  repoJobDescription,
  repoJobTitle,
  validateRepoFullName,
} from '@/lib/repo-jobs'
import { appJwt, verifyGithubSignature } from '@/lib/github-app'
import { createHmac, generateKeyPairSync } from 'node:crypto'

describe('repo job identity', () => {
  it('accepts owner/name and rejects everything else', () => {
    expect(validateRepoFullName('acme/widgets')).toBe(true)
    expect(validateRepoFullName('Kairose-master/ai-agent-credit-dashboard')).toBe(true)
    expect(validateRepoFullName('acme')).toBe(false)
    expect(validateRepoFullName('acme/widgets/extra')).toBe(false)
    expect(validateRepoFullName('acme/wid gets')).toBe(false)
    expect(validateRepoFullName('../etc/passwd')).toBe(false)
  })

  it('builds a title/description/criteria that name the real grader', () => {
    const title = repoJobTitle('acme/widgets', 'Fix pagination')
    expect(title.startsWith('repo → acme/widgets: ')).toBe(true)
    const desc = repoJobDescription({ repoFullName: 'acme/widgets', baseBranch: 'main', brief: 'off-by-one in page 2' })
    expect(desc).toContain('git clone https://github.com/acme/widgets.git')
    expect(desc).toContain('unified diff')
    expect(desc).not.toContain('token') // workers are never told about credentials
    const criteria = repoJobAcceptanceCriteria({ repoFullName: 'acme/widgets', baseBranch: 'main', criteria: 'add a test' })
    expect(criteria).toContain("repository's own CI")
    expect(criteria).toContain('add a test')
  })
})

describe('extractUnifiedDiff', () => {
  const diff = `--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n`

  it('prefers a fenced diff block', () => {
    expect(extractUnifiedDiff('here you go\n\n```diff\n' + diff + '```\n')).toBe(diff)
    expect(extractUnifiedDiff('```patch\n' + diff + '```')).toBe(diff)
  })

  it('falls back to a bare diff in prose', () => {
    expect(extractUnifiedDiff('I changed it:\n' + diff)).toBe(diff)
  })

  it('returns null when there is no diff at all', () => {
    expect(extractUnifiedDiff('I could not do it, sorry.')).toBeNull()
    expect(extractUnifiedDiff('```\nnot a diff\n```')).toBeNull()
  })
})

describe('parseUnifiedDiff', () => {
  it('parses a multi-file diff with git headers', () => {
    const patches = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        'index 111..222 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,2 +1,2 @@',
        ' keep',
        '-old',
        '+new',
        'diff --git a/b.txt b/b.txt',
        'new file mode 100755',
        '--- /dev/null',
        '+++ b/b.txt',
        '@@ -0,0 +1 @@',
        '+hello',
        '',
      ].join('\n'),
    )
    expect(patches).toHaveLength(2)
    expect(patches[0].oldPath).toBe('a.txt')
    expect(patches[0].hunks[0].lines.map((l) => l.tag).join('')).toBe(' -+')
    expect(patches[1].oldPath).toBeNull()
    expect(patches[1].mode).toBe('100755')
  })

  it("keeps git's content-free rename form (no hunks) instead of dropping it", () => {
    const patches = parseUnifiedDiff(
      [
        'diff --git a/lib/new.ts b/lib/renamed.ts',
        'similarity index 100%',
        'rename from lib/new.ts',
        'rename to lib/renamed.ts',
        '',
      ].join('\n'),
    )
    expect(patches).toEqual([
      { oldPath: 'lib/new.ts', newPath: 'lib/renamed.ts', mode: null, pureRename: true, hunks: [] },
    ])
  })

  it('treats a rename WITH hunks as one patch, not a rename plus an edit', () => {
    const patches = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/b.txt',
        'similarity index 80%',
        'rename from a.txt',
        'rename to b.txt',
        '--- a/a.txt',
        '+++ b/b.txt',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '',
      ].join('\n'),
    )
    expect(patches).toHaveLength(1)
    expect(patches[0].pureRename).toBeUndefined()
    expect(patches[0].oldPath).toBe('a.txt')
    expect(patches[0].newPath).toBe('b.txt')
  })

  it('rejects binary patches, unsafe paths, truncated hunks and duplicates', () => {
    expect(() => parseUnifiedDiff('GIT binary patch\nliteral 4\n')).toThrow(DiffRejectedError)
    expect(() => parseUnifiedDiff('--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n')).toThrow(
      /Unsafe/,
    )
    expect(() => parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n')).toThrow(/truncated/)
    expect(() =>
      parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-b\n+c\n'),
    ).toThrow(/Duplicate/)
    expect(() => parseUnifiedDiff('just some prose')).toThrow(/No file patches/)
  })
})

describe('applyFilePatch', () => {
  const patchOf = (diff: string) => parseUnifiedDiff(diff)[0]

  it('applies a single-line replacement', () => {
    const p = patchOf('--- a/x.txt\n+++ b/x.txt\n@@ -2 +2 @@\n-two\n+TWO\n')
    expect(applyFilePatch('one\ntwo\nthree\n', p)).toBe('one\nTWO\nthree\n')
  })

  it('applies multiple hunks in one file', () => {
    const p = patchOf(
      ['--- a/x', '+++ b/x', '@@ -1,2 +1,2 @@', '-a', '+A', ' b', '@@ -4,2 +4,2 @@', ' d', '-e', '+E', ''].join('\n'),
    )
    expect(applyFilePatch('a\nb\nc\nd\ne\n', p)).toBe('A\nb\nc\nd\nE\n')
  })

  it('creates a new file and deletes a file', () => {
    const create = patchOf('--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n')
    expect(applyFilePatch(null, create)).toBe('hello\nworld\n')
    const del = patchOf('--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-hello\n-world\n')
    expect(applyFilePatch('hello\nworld\n', del)).toBeNull()
  })

  it('inserts at the top of a file (oldLines 0 means "after line N")', () => {
    const p = patchOf('--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+first\n')
    expect(applyFilePatch('a\nb\n', p)).toBe('first\na\nb\n')
  })

  it('honours "\\ No newline at end of file"', () => {
    const p = patchOf('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n')
    expect(applyFilePatch('a\n', p)).toBe('b')
  })

  it('refuses a diff whose context does not match the base', () => {
    const p = patchOf('--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n')
    expect(() => applyFilePatch('DIFFERENT\nold\n', p)).toThrow(/does not apply at line 1/)
  })

  it('refuses a new-file patch when the file already exists, and vice versa', () => {
    const create = patchOf('--- /dev/null\n+++ b/x\n@@ -0,0 +1 @@\n+hi\n')
    expect(() => applyFilePatch('already here\n', create)).toThrow(/already exists/)
    const edit = patchOf('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
    expect(() => applyFilePatch(null, edit)).toThrow(/does not exist/)
  })

  it('refuses out-of-order or past-the-end hunks', () => {
    const p = patchOf('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+A\n@@ -1 +1 @@\n-a\n+B\n')
    expect(() => applyFilePatch('a\n', p)).toThrow(/overlap|out of order/)
    const far = patchOf('--- a/x\n+++ b/x\n@@ -50 +50 @@\n-a\n+A\n')
    expect(() => applyFilePatch('a\n', far)).toThrow(/past the end/)
  })
})

describe('applyUnifiedDiff', () => {
  const base: Record<string, string> = { 'lib/a.ts': 'const a = 1\n' }
  const load = async (p: string) => base[p] ?? null

  it('returns one entry per touched file with resulting content', async () => {
    const out = await applyUnifiedDiff(
      ['--- a/lib/a.ts', '+++ b/lib/a.ts', '@@ -1 +1 @@', '-const a = 1', '+const a = 2', ''].join('\n'),
      load,
    )
    expect(out).toEqual([{ path: 'lib/a.ts', content: 'const a = 2\n', mode: null }])
  })

  it('carries content across a pure rename', async () => {
    const out = await applyUnifiedDiff('rename from lib/a.ts\nrename to lib/moved.ts\n', load)
    expect(out).toEqual([
      { path: 'lib/a.ts', content: null, mode: null },
      { path: 'lib/moved.ts', content: 'const a = 1\n', mode: null },
    ])
  })

  it('models a rename as delete-old + create-new', async () => {
    const out = await applyUnifiedDiff('--- a/lib/a.ts\n+++ b/lib/b.ts\n@@ -1 +1 @@\n-const a = 1\n+const b = 1\n', load)
    expect(out).toEqual([
      { path: 'lib/a.ts', content: null, mode: null },
      { path: 'lib/b.ts', content: 'const b = 1\n', mode: null },
    ])
  })

  it('enforces the file-count limit', async () => {
    const many = Array.from({ length: 3 }, (_, i) => `--- /dev/null\n+++ b/f${i}.txt\n@@ -0,0 +1 @@\n+x\n`).join('')
    await expect(applyUnifiedDiff(many, load, { maxFiles: 2 })).rejects.toThrow(/limit is 2/)
  })
})

describe('github app crypto', () => {
  it('signs an RS256 JWT with the app id as issuer', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const jwt = appJwt('12345', pem, 1_700_000_000)
    const [header, claims, signature] = jwt.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const parsed = JSON.parse(Buffer.from(claims, 'base64url').toString())
    expect(parsed).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: '12345' })
    expect(signature.length).toBeGreaterThan(300)
  })

  it('verifies a real webhook signature and rejects tampering', () => {
    const secret = 'shh'
    const body = JSON.stringify({ action: 'closed', pull_request: { merged: true } })
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyGithubSignature(body, sig, secret)).toBe(true)
    expect(verifyGithubSignature(body + ' ', sig, secret)).toBe(false)
    expect(verifyGithubSignature(body, sig, 'wrong')).toBe(false)
    expect(verifyGithubSignature(body, null, secret)).toBe(false)
    expect(verifyGithubSignature(body, 'sha1=abc', secret)).toBe(false)
    expect(verifyGithubSignature(body, 'sha256=zz', secret)).toBe(false)
  })
})
