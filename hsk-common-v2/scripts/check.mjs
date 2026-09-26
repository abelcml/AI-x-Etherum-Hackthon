import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { networkConfig, context } from '../src/runtime.mjs'

const sharedFields = [
  'USDC_ADDRESS',
  'CREDIT_REGISTRY_ADDRESS',
  'LABOR_MARKET_ADDRESS',
]
const githubFields = [
  'GITHUB_REPOSITORY',
  'GITHUB_TOKEN',
  'GITHUB_CHECK_APP_ID',
  'GITHUB_REQUIRED_CHECKS',
]

export function missingConfiguration(env = process.env, type = 'github-pr') {
  if (!['github-pr', 'csv-dedupe'].includes(type)) throw new Error(`Unknown task type: ${type}`)
  return [...sharedFields, ...(type === 'github-pr' ? githubFields : [])].filter(key => !env[key]?.trim())
}

export async function runCheck({ env = process.env, args = process.argv.slice(2) } = {}) {
  try {
    networkConfig(env)
    const typeIndex = args.indexOf('--type')
    const type = typeIndex === -1 ? 'github-pr' : args[typeIndex + 1]
    const missing = missingConfiguration(env, type)
    console.log(missing.length ? `Missing configuration: ${missing.join(', ')}` : 'Configuration fields present')
    console.log('Signing keys are needed only for each role; never print or commit them.')
    if (args.includes('--rpc')) {
      await context(undefined, { contracts: !missing.some(key => key.endsWith('_ADDRESS')) })
      console.log(missing.some(key => key.endsWith('_ADDRESS')) ? 'HSK testnet RPC passed; contract checks skipped (missing addresses)' : 'HSK testnet RPC and contract checks passed (read-only)')
    }
    return missing.length ? 1 : 0
  } catch (error) {
    console.error(error.shortMessage || error.message)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCheck()
}
