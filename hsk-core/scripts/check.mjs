import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { networkConfig, context } from '../src/runtime.mjs'

const requiredFields = [
  'USDC_ADDRESS',
  'CREDIT_REGISTRY_ADDRESS',
  'LABOR_MARKET_ADDRESS',
  'GITHUB_REPOSITORY',
  'GITHUB_TOKEN',
  'GITHUB_CHECK_APP_ID',
  'GITHUB_REQUIRED_CHECKS',
]

export function missingConfiguration(env = process.env) {
  return requiredFields.filter(key => !env[key]?.trim())
}

export async function runCheck({ env = process.env, args = process.argv.slice(2) } = {}) {
  try {
    networkConfig(env)
    const missing = missingConfiguration(env)
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
