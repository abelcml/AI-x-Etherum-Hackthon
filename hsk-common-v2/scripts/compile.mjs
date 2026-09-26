import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import solc from 'solc'

const root = new URL('../', import.meta.url)
const names = ['MockUSDC', 'AgentCreditRegistry', 'LaborMarketV2']
const sources = Object.fromEntries(names.map(name => [
  `contracts/${name}.sol`, { content: readFileSync(new URL(`contracts/${name}.sol`, root), 'utf8') },
]))
const result = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity', sources,
  settings: {
    optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
})))
const errors = (result.errors ?? []).filter(item => item.severity === 'error')
if (errors.length) throw new Error(errors.map(item => item.formattedMessage).join('\n'))
const artifacts = Object.fromEntries(names.map(name => {
  const compiled = result.contracts[`contracts/${name}.sol`][name]
  return [name, { abi: compiled.abi, bytecode: `0x${compiled.evm.bytecode.object}` }]
}))
mkdirSync(new URL('artifacts/', root), { recursive: true })
writeFileSync(new URL('artifacts/contracts.json', root), JSON.stringify(artifacts, null, 2))
console.log(`Compiled ${names.join(', ')} with solc ${solc.version()}`)
console.log(fileURLToPath(new URL('artifacts/contracts.json', root)))
