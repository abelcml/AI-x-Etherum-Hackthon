import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { missingConfiguration } from '../scripts/check.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkScript = resolve(projectRoot, 'scripts/check.mjs')
const configuredWithoutToken = {
  USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
  CREDIT_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000002',
  LABOR_MARKET_ADDRESS: '0x0000000000000000000000000000000000000003',
  GITHUB_REPOSITORY: 'abelcml/AI-x-Etherum-Hackthon',
  GITHUB_CHECK_APP_ID: '12345',
  GITHUB_REQUIRED_CHECKS: 'CI',
}

test('private-repository token is required', () => {
  assert.deepEqual(missingConfiguration(configuredWithoutToken), ['GITHUB_TOKEN'])
})

test('CLI reports missing token without printing secret values', () => {
  const result = spawnSync(process.execPath, [checkScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...configuredWithoutToken,
      GITHUB_TOKEN: '',
      REQUESTER_PRIVATE_KEY: 'test-secret-must-not-be-printed',
    },
  })

  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /Missing configuration: GITHUB_TOKEN/)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /test-secret-must-not-be-printed/)
})

test('importing the CLI module does not run it', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    `await import(${JSON.stringify(pathToFileURL(checkScript).href)})`,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_TOKEN: '' },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})
