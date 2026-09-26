import { pathToFileURL } from 'node:url';
import { HSK_TESTNET_CHAIN_ID, requireAddress } from './deploy.mjs';

export function parseTokenAmount(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Amount must be a positive decimal with at most 6 places');
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (amount <= 0n) throw new Error('Amount must be greater than zero');
  return amount;
}

export function createMintPlan(options, env = process.env) {
  if (env.ONCHAIN_CHAIN !== undefined && env.ONCHAIN_CHAIN !== 'hsk-testnet') {
    throw new Error(`Minting is restricted to HSK testnet (chain ID ${HSK_TESTNET_CHAIN_ID})`);
  }
  return {
    chainId: HSK_TESTNET_CHAIN_ID,
    token: requireAddress(env.USDC_ADDRESS, 'USDC_ADDRESS'),
    to: requireAddress(options.to, '--to'),
    amount: parseTokenAmount(options.amount),
  };
}

export function parseMintArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--send') {
      if (options.send) throw new Error('Use --send only once');
      options.send = true;
      continue;
    }
    if (arg !== '--to' && arg !== '--amount') {
      throw new Error('Usage: node scripts/mint.mjs --to ADDRESS --amount 10 [--send]');
    }
    const key = arg.slice(2);
    if (options[key] !== undefined || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
      throw new Error(`Expected one value after ${arg}`);
    }
    options[key] = argv[i + 1];
    i += 1;
  }
  if (!options.to || !options.amount) {
    throw new Error('Usage: node scripts/mint.mjs --to ADDRESS --amount 10 [--send]');
  }
  return { ...options, send: Boolean(options.send) };
}

async function assertTestnet(ctx) {
  if (ctx.chain.id !== HSK_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing mint: configured chain is ${ctx.chain.id}, expected ${HSK_TESTNET_CHAIN_ID}`);
  }
  const actualChainId = await ctx.publicClient.getChainId();
  if (actualChainId !== HSK_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing mint: RPC reports chain ID ${actualChainId}, expected ${HSK_TESTNET_CHAIN_ID}`);
  }
}

async function runMint(plan) {
  const { context, sendContract } = await import('../src/runtime.mjs');
  const ctx = await context('deployer', { contracts: false });
  await assertTestnet(ctx);

  const code = await ctx.publicClient.getCode({ address: plan.token });
  if (!code || code === '0x') throw new Error(`No contract code at USDC_ADDRESS ${plan.token}`);
  const decimals = await ctx.publicClient.readContract({
    address: plan.token,
    abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
    functionName: 'decimals',
  });
  if (Number(decimals) !== 6) throw new Error(`Expected a 6-decimal test token at ${plan.token}; found ${decimals}`);

  await sendContract(ctx, {
    address: plan.token,
    abi: [{
      type: 'function',
      name: 'mint',
      stateMutability: 'nonpayable',
      inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
      outputs: [],
    }],
    functionName: 'mint',
    args: [plan.to, plan.amount],
  });
  console.log(`Minted ${plan.amount.toString()} token base units to ${plan.to}.`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseMintArgs(argv);
  const plan = createMintPlan(options, env);
  if (!options.send) {
    const { networkConfig } = await import('../src/runtime.mjs');
    networkConfig(env);
  }
  console.log(`Network: HSK testnet, chain ID ${plan.chainId}`);
  console.log(`Token: ${plan.token}`);
  console.log(`Recipient: ${plan.to}`);
  console.log(`Amount: ${options.amount} mUSDC`);
  if (!options.send) {
    console.log('Preview only. Add --send to submit this mint.');
    return plan;
  }
  await runMint(plan);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.shortMessage ?? error.message ?? 'Mint failed');
    process.exitCode = 1;
  });
}
