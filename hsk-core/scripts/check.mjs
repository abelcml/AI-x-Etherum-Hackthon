import { networkConfig, context } from '../src/runtime.mjs'

try {
  networkConfig()
  const missing = ['USDC_ADDRESS', 'CREDIT_REGISTRY_ADDRESS', 'LABOR_MARKET_ADDRESS', 'GITHUB_REPOSITORY', 'GITHUB_CHECK_APP_ID', 'GITHUB_REQUIRED_CHECKS']
    .filter(key => !process.env[key]?.trim())
  console.log(missing.length ? `Missing configuration: ${missing.join(', ')}` : 'Configuration fields present')
  console.log('Signing keys are needed only for each role; never print or commit them.')
  if (process.argv.includes('--rpc')) {
    await context(undefined, { contracts: !missing.some(key => key.endsWith('_ADDRESS')) })
    console.log('HSK testnet RPC check passed (read-only)')
  }
  if (missing.length) process.exitCode = 1
} catch (error) {
  console.error(error.shortMessage || error.message)
  process.exitCode = 1
}
