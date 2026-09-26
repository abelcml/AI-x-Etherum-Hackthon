import { pathToFileURL } from 'node:url';

export const HSK_TESTNET_CHAIN_ID = 133;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const MARKET_CONFIG = Object.freeze({
  feeBps: 0,
  feeRecipient: ZERO_ADDRESS,
  flatFee: 0n,
  bondBps: 0,
  flatBond: 0n,
  minDeliveryWindow: 600,
  maxDeliveryWindow: 86_400,
  reviewWindow: 600,
  maxOpenWindow: 3_600,
  disputeWindow: 600,
  silenceForfeitBps: 0,
  minBounty: 1n,
});

export function requireAddress(value, name) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} must be a 20-byte 0x address`);
  }
  if (/^0x0{40}$/i.test(value)) throw new Error(`${name} cannot be the zero address`);
  return value;
}

export function createDeployPlan(target, env = process.env) {
  if (!['token', 'registry', 'market'].includes(target)) {
    throw new Error('Choose one deployment target: token, registry, or market');
  }

  if (env.ONCHAIN_CHAIN !== undefined && env.ONCHAIN_CHAIN !== 'hsk-testnet') {
    throw new Error(`This deploy script only supports HSK testnet (chain ID ${HSK_TESTNET_CHAIN_ID})`);
  }

  if (target === 'token') {
    return { target, chainId: HSK_TESTNET_CHAIN_ID, artifact: 'MockUSDC', args: [] };
  }

  if (target === 'registry') {
    return {
      target,
      chainId: HSK_TESTNET_CHAIN_ID,
      artifact: 'AgentCreditRegistry',
      args: [requireAddress(env.ORACLE_ADDRESS, 'ORACLE_ADDRESS')],
    };
  }

  return {
    target,
    chainId: HSK_TESTNET_CHAIN_ID,
    artifact: 'LaborMarketV2',
    args: [
      requireAddress(env.USDC_ADDRESS, 'USDC_ADDRESS'),
      requireAddress(env.CREDIT_REGISTRY_ADDRESS, 'CREDIT_REGISTRY_ADDRESS'),
      requireAddress(env.ARBITER_ADDRESS, 'ARBITER_ADDRESS'),
      MARKET_CONFIG,
    ],
  };
}

export function parseDeployArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = argv.filter((arg) => arg.startsWith('--'));
  if (positional.length !== 1 || flags.some((flag) => flag !== '--send')) {
    throw new Error('Usage: node scripts/deploy.mjs token|registry|market [--send]');
  }
  return { target: positional[0], send: flags.includes('--send') };
}

function artifactBytecode(artifact) {
  const bytecode = artifact?.bytecode;
  if (typeof bytecode !== 'string' || bytecode.length === 0) {
    throw new Error('Compiled artifact has no bytecode; compile contracts first');
  }
  return bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`;
}

async function assertTestnet(ctx) {
  if (ctx.chain.id !== HSK_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing deployment: configured chain is ${ctx.chain.id}, expected ${HSK_TESTNET_CHAIN_ID}`);
  }
  const actualChainId = await ctx.publicClient.getChainId();
  if (actualChainId !== HSK_TESTNET_CHAIN_ID) {
    throw new Error(`Refusing deployment: RPC reports chain ID ${actualChainId}, expected ${HSK_TESTNET_CHAIN_ID}`);
  }
}

async function assertToken(ctx, tokenAddress) {
  const code = await ctx.publicClient.getCode({ address: tokenAddress });
  if (!code || code === '0x') throw new Error(`No contract code at USDC_ADDRESS ${tokenAddress}`);
  const decimals = await ctx.publicClient.readContract({
    address: tokenAddress,
    abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
    functionName: 'decimals',
  });
  if (decimals !== 6) throw new Error(`Expected a 6-decimal token at ${tokenAddress}; found ${decimals}`);
}

async function runDeployment(plan) {
  const { context, loadArtifacts } = await import('../src/runtime.mjs');
  const ctx = await context('deployer', { contracts: false });
  await assertTestnet(ctx);

  if (plan.target === 'market') {
    const [tokenAddress, registryAddress] = plan.args;
    await assertToken(ctx, tokenAddress);
    const registryCode = await ctx.publicClient.getCode({ address: registryAddress });
    if (!registryCode || registryCode === '0x') {
      throw new Error(`No contract code at CREDIT_REGISTRY_ADDRESS ${registryAddress}`);
    }
  }

  const artifacts = await loadArtifacts();
  const artifact = artifacts[plan.artifact];
  if (!artifact?.abi) throw new Error(`Compiled artifact ${plan.artifact} is missing its ABI`);

  const hash = await ctx.walletClient.deployContract({
    account: ctx.account,
    chain: ctx.chain,
    abi: artifact.abi,
    bytecode: artifactBytecode(artifact),
    args: plan.args,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment failed; transaction ${hash}`);
  }

  const envName = {
    token: 'USDC_ADDRESS',
    registry: 'CREDIT_REGISTRY_ADDRESS',
    market: 'LABOR_MARKET_ADDRESS',
  }[plan.target];
  console.log(`${envName}=${receipt.contractAddress}`);
  console.log(`Deployment transaction: ${hash}`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { target, send } = parseDeployArgs(argv);
  const plan = createDeployPlan(target, env);
  if (!send) {
    const { networkConfig } = await import('../src/runtime.mjs');
    networkConfig(env);
  }
  console.log(`Target: ${plan.target} (${plan.artifact})`);
  console.log(`Network: HSK testnet, chain ID ${plan.chainId}`);
  console.log(`Constructor arguments: ${JSON.stringify(plan.args, (_, value) => typeof value === 'bigint' ? value.toString() : value)}`);
  if (!send) {
    console.log('Preview only. Add --send to submit this deployment.');
    return plan;
  }
  await runDeployment(plan);
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.shortMessage ?? error.message ?? 'Deployment failed');
    process.exitCode = 1;
  });
}
