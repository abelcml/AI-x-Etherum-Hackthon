import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeployPlan, parseDeployArgs } from '../scripts/deploy.mjs';
import { createMintPlan, parseMintArgs, parseTokenAmount } from '../scripts/mint.mjs';

const ORACLE = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const REGISTRY = '0x3333333333333333333333333333333333333333';
const ARBITER = '0x4444444444444444444444444444444444444444';
const RECIPIENT = '0x5555555555555555555555555555555555555555';

test('token deployment plan is pinned to HSK testnet and needs no deployment secrets', () => {
  assert.deepEqual(createDeployPlan('token', {}), {
    target: 'token', chainId: 133, artifact: 'MockUSDC', args: [],
  });
});

test('registry deployment requires an explicit oracle address', () => {
  const plan = createDeployPlan('registry', { ORACLE_ADDRESS: ORACLE });
  assert.equal(plan.chainId, 133);
  assert.deepEqual(plan.args, [ORACLE]);
  assert.throws(() => createDeployPlan('registry', {}), /ORACLE_ADDRESS/);
});

test('market plan includes explicit dependencies and the short testnet defaults', () => {
  const plan = createDeployPlan('market', {
    USDC_ADDRESS: TOKEN,
    CREDIT_REGISTRY_ADDRESS: REGISTRY,
    ARBITER_ADDRESS: ARBITER,
  });
  assert.equal(plan.chainId, 133);
  assert.deepEqual(plan.args.slice(0, 3), [TOKEN, REGISTRY, ARBITER]);
  assert.deepEqual(plan.args[3], {
    feeBps: 0,
    feeRecipient: '0x0000000000000000000000000000000000000000',
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
});

test('deploy plans reject other chains, unknown targets, and invalid addresses', () => {
  assert.throws(() => createDeployPlan('token', { ONCHAIN_CHAIN: 'hsk-mainnet' }), /only supports HSK testnet/);
  assert.throws(() => createDeployPlan('vault', {}), /token, registry, or market/);
  assert.throws(() => createDeployPlan('registry', { ORACLE_ADDRESS: 'not-an-address' }), /20-byte/);
});

test('deploy CLI requires one target and accepts only explicit send flag', () => {
  assert.deepEqual(parseDeployArgs(['market']), { target: 'market', send: false });
  assert.deepEqual(parseDeployArgs(['token', '--send']), { target: 'token', send: true });
  assert.throws(() => parseDeployArgs(['token', '--mainnet']), /Usage:/);
  assert.throws(() => parseDeployArgs([]), /Usage:/);
});

test('mint amount parser converts six decimal token units exactly', () => {
  assert.equal(parseTokenAmount('10'), 10_000_000n);
  assert.equal(parseTokenAmount('0.000001'), 1n);
  assert.equal(parseTokenAmount('1.20'), 1_200_000n);
  assert.throws(() => parseTokenAmount('0'), /greater than zero/);
  assert.throws(() => parseTokenAmount('1.0000001'), /at most 6 places/);
  assert.throws(() => parseTokenAmount('1e3'), /at most 6 places/);
});

test('mint plan is testnet only and requires token and recipient addresses', () => {
  assert.deepEqual(createMintPlan({ to: RECIPIENT, amount: '3.25' }, { USDC_ADDRESS: TOKEN }), {
    chainId: 133, token: TOKEN, to: RECIPIENT, amount: 3_250_000n,
  });
  assert.throws(() => createMintPlan({ to: RECIPIENT, amount: '1' }, {
    USDC_ADDRESS: TOKEN, ONCHAIN_CHAIN: 'hsk-mainnet',
  }), /restricted to HSK testnet/);
  assert.throws(() => createMintPlan({ to: RECIPIENT, amount: '1' }, {}), /USDC_ADDRESS/);
});

test('mint CLI requires explicit recipient and amount and defaults to preview', () => {
  assert.deepEqual(parseMintArgs(['--to', RECIPIENT, '--amount', '5']), {
    to: RECIPIENT, amount: '5', send: false,
  });
  assert.deepEqual(parseMintArgs(['--amount', '5', '--to', RECIPIENT, '--send']), {
    amount: '5', to: RECIPIENT, send: true,
  });
  assert.throws(() => parseMintArgs(['--to', RECIPIENT]), /Usage:/);
  assert.throws(() => parseMintArgs(['--to', RECIPIENT, '--amount', '1', '--chain', '177']), /Usage:/);
});
