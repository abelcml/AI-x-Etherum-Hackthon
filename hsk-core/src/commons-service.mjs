import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPrIdentity, verifyMergedPr } from './github.mjs';
import { hashPrResult } from './proof.mjs';
import { parseCsv, dedupeKeepFirst, serializeCsv, expectedSha256, verifyCsvDedupe } from '../../acceptance/csv-dedupe/csv-dedupe.mjs';

const exec = promisify(execFile);
const required = ['USDC_ADDRESS', 'CREDIT_REGISTRY_ADDRESS', 'LABOR_MARKET_ADDRESS', 'GITHUB_REPOSITORY', 'GITHUB_CHECK_APP_ID', 'GITHUB_REQUIRED_CHECKS'];
export function config(env = process.env) {
  return {
    mode: 'live-adapter', chainId: 133, repository: env.GITHUB_REPOSITORY || '',
    missing: required.filter(key => !env[key]?.trim()),
    githubReady: ['GITHUB_REPOSITORY','GITHUB_CHECK_APP_ID','GITHUB_REQUIRED_CHECKS'].every(key => env[key]?.trim()),
    tokenConfigured: Boolean(env.GITHUB_TOKEN),
    signingEnabled: env.COMMONS_ENABLE_SIGNING === 'true' && Boolean(env.COMMONS_USERNAME && env.COMMONS_PASSWORD),
    requesterConfigured: Boolean(env.REQUESTER_PRIVATE_KEY), workerConfigured: Boolean(env.WORKER_PRIVATE_KEY),
    signingMode: 'server-test-wallets',
  };
}
function integer(value, name) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} must be a positive safe integer`);
  return String(value);
}
export function actionArgs(input, env = process.env) {
  const { action } = input;
  if (action === 'post') {
    const link = new URL(input.issueUrl);
    const match = /^\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)\/?$/.exec(link.pathname);
    if (link.protocol !== 'https:' || link.hostname !== 'github.com' || link.username || link.password || !match || match[1].toLowerCase() !== env.GITHUB_REPOSITORY?.toLowerCase()) throw new Error('Issue must belong to configured GITHUB_REPOSITORY');
    const title = String(input.title || '').trim();
    if (!title || title.length > 150 || title.startsWith('--')) throw new Error('A task title of 1–150 characters is required');
    if (!/^\d+(\.\d{1,6})?$/.test(String(input.bounty)) || Number(input.bounty) <= 0) throw new Error('Bounty must be positive with at most six decimals');
    const window = integer(input.window, 'window');
    if (Number(window) < 600 || Number(window) > 86400) throw new Error('Delivery window must be 600–86400 seconds');
    return ['post','--issue',integer(match[2], 'issue'),'--title',title,'--bounty',String(input.bounty),'--window',window];
  }
  if (action === 'withdraw') {
    if (!['worker','requester'].includes(input.role)) throw new Error('Choose worker or requester');
    return ['withdraw','--role',input.role];
  }
  if (!['accept','submit','settle','cancel','reclaim','expire-open','expire-review','status'].includes(action)) throw new Error('Unsupported action');
  const args = [action,'--job',integer(input.jobId, 'jobId')];
  if (action === 'submit') args.push('--pr',integer(input.pr, 'pr'));
  return args;
}
export function lastJson(output) {
  let depth=0, start=-1, quoted=false, escaped=false, result;
  for(let i=0;i<output.length;i++) {
    const ch=output[i];
    if(quoted) { if(escaped) escaped=false; else if(ch==='\\') escaped=true; else if(ch==='"') quoted=false; continue; }
    if(ch==='"' && depth) quoted=true;
    if(ch==='{') { if(!depth) start=i; depth++; }
    if(ch==='}' && depth && --depth===0) { try { result=JSON.parse(output.slice(start,i+1)); } catch {} }
  }
  if(!result) throw new Error('CLI returned no structured result');
  return result;
}
export function redact(text, env) {
  let value=String(text);
  for(const [key,secret] of Object.entries(env)) if(/KEY|TOKEN|PASSWORD|SECRET/.test(key) && secret?.length>=4) value=value.split(secret).join('[redacted]');
  return value;
}
export function createService({root,env=process.env,fetchImpl=fetch,executor=exec}={}) {
  async function run(args) {
    try {
      const {stdout}=await executor(process.execPath,['scripts/job.mjs',...args],{cwd:root,env,timeout:300000,maxBuffer:1024*1024,windowsHide:true,shell:false});
      return { result:lastJson(stdout), log:redact(stdout,env) };
    } catch(error) {
      const err=new Error(redact(error.stderr || error.message,env));
      err.transactions=String(error.stdout||'').match(/0x[a-fA-F0-9]{64}/g)||[];
      err.uncertain=err.transactions.length>0 || Boolean(error.killed);
      throw err;
    }
  }
  return {
    config:()=>config(env), run,
    async jobs() {
      let names;
      try { names=await readdir(resolve(root,'.data/jobs')); } catch(error) { if(error.code==='ENOENT') return []; throw error; }
      const result=[];
      for(const name of names.filter(name=>/^[1-9]\d*\.json$/.test(name)).sort().slice(0,100)) {
        const record=JSON.parse(await readFile(resolve(root,'.data/jobs',name),'utf8'));
        if(Number(record.spec?.chainId)!==133 || record.spec?.market?.toLowerCase()!==env.LABOR_MARKET_ADDRESS?.toLowerCase()) continue;
        result.push({jobId:record.jobId,title:record.spec.title,repo:record.spec.repo,issue:record.spec.issue,pr:record.prNumber,sha:record.headSha,postedTx:record.postedTx,submittedTx:record.submittedTx});
      }
      return result;
    },
    async verify(input) {
      const repo=env.GITHUB_REPOSITORY;
      const prNumber=Number(integer(input.pr,'pr'));
      const expectedHeadSha=String(input.sha||'');
      if(!/^[a-fA-F0-9]{40}$/.test(expectedHeadSha)) throw new Error('Enter the full 40-character submitted SHA');
      const requiredChecks=(env.GITHUB_REQUIRED_CHECKS||'').split(',').map(name=>name.trim());
      const appId=Number(env.GITHUB_CHECK_APP_ID);
      const verified=await verifyMergedPr({repo,prNumber,expectedHeadSha,requiredChecks,appId,token:env.GITHUB_TOKEN,fetchImpl});
      return {repo,pr:prNumber,merged:verified.merged,submitted_sha:expectedHeadSha.toLowerCase(),pr_head_sha:verified.headSha,ci_sha:verified.headSha,all_checks_passed:true,verified:true,result_hash:hashPrResult(repo,prNumber,verified.headSha),checks:verified.checks,policy:{appId,requiredChecks},checked_at:new Date().toISOString(),chain_verified:false};
    },
    async prIdentity(pr) { return getPrIdentity({repo:env.GITHUB_REPOSITORY,prNumber:Number(integer(pr,'pr')),token:env.GITHUB_TOKEN,fetchImpl}); },
    csv(input) {
      if(typeof input.inputText!=='string' || input.inputText.length>200000 || typeof input.key!=='string') throw new Error('CSV input must be text under 200 KB with a key column');
      function checked(text) {
        if(typeof text!=='string'||text.includes('"')) throw new Error('This adapter supports unquoted CSV only');
        const parsed=parseCsv(text);
        if(parsed.header.some(name=>!name.trim())||new Set(parsed.header).size!==parsed.header.length||parsed.rows.some(row=>row.length!==parsed.header.length)) throw new Error('CSV headers and row widths must be valid');
        const col=parsed.header.indexOf(input.key);
        if(col<0||parsed.rows.some(row=>!row[col]?.trim())) throw new Error('CSV key column is missing or contains empty values');
        return parsed;
      }
      const parsed=checked(input.inputText);
      const expected=expectedSha256(input.inputText,input.key);
      if(input.action==='run') return {outputText:serializeCsv(dedupeKeepFirst(parsed,input.key)),expectedSha256:expected,executor:'deterministic-csv-reference',inputRows:parsed.rows.length};
      if(input.action!=='verify'||typeof input.expectedSha!=='string'||!/^[a-fA-F0-9]{64}$/.test(input.expectedSha)) throw new Error('Verification requires a previously recorded expected SHA256');
      checked(input.outputText);
      // The task owner must fix this expected result before reviewing output.
      if(input.expectedSha.toLowerCase()!==expected) throw new Error('Input or expected hash changed since the task was prepared');
      return {...verifyCsvDedupe(input),expectedSha256:expected,chain_verified:false};
    },
  };
}
