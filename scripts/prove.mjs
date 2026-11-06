/** Real standalone circuit proofs using synthetic data and a loopback prover.
 * Private witnesses, contexts and preimages are never logged or written to disk.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { createMarketplace } from '../lib/native-engine.mjs';

const root = resolve(import.meta.dirname, '..');
const report = { schema: 'reviewlab-circuit-proofs/v1', startedAt: new Date().toISOString(), status: 'running',
  compiler: '0.31.1', runtime: '0.16.0', proofServer: '8.1.3', proofs: [], negativeChecks: [],
  networkSubmission: false, networkAcceptance: false, independentProofVerification: false };
const digest = value => createHash('sha256').update(value).digest('hex');
let stage = 'prerequisites';
async function save() {
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/proof-evidence.json'), JSON.stringify(report, null, 2) + '\n');
}
async function main() {
  const url = new URL(process.env.MIDNIGHT_LOCAL_PROOF_SERVER ?? 'http://127.0.0.1:6301');
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Loopback prover required');
  const version = await fetch(new URL('/version', url), { signal: AbortSignal.timeout(10000) });
  if (!version.ok || (await version.text()).trim() !== '8.1.3') throw new Error('Unexpected prover');
  const ready = await fetch(new URL('/ready', url), { signal: AbortSignal.timeout(10000) });
  if (!ready.ok || (await ready.json()).status !== 'ok') throw new Error('Prover unavailable');
  report.contractSha256 = digest(await readFile(resolve(root, 'contracts/reviewlab.compact')));
  report.bindingsSha256 = digest(await readFile(resolve(root, 'contracts/managed/reviewlab/contract/index.js')));
  const material = new NodeZkConfigProvider(resolve(root, 'contracts/managed/reviewlab'));
  const provider = httpClientProvingProvider(url.href, material, { timeout: 600000 });
  const calls = [];
  const market = await createMarketplace({ onCircuit({ name, result }) {
    const { input, output, publicTranscript, privateTranscriptOutputs } = result.proofData;
    calls.push({ name, preimage: RT.proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTranscriptOutputs, name) });
  } });
  const credential = market.enrollExpert({ profession: 'software' });
  const task = await market.createTask({ profession: 'software', deadline: Math.floor(Date.now() / 1000) + 86400,
    capacity: 2, reward: 2500, content: 'Synthetic evaluation: assess a simple bounds-checking answer.' });
  const receipt = await market.submitReview({ taskId: task.id, credential, feedback: 'The answer misses a boundary check; add a failing-input example.', scores: [3, 4, 3] });
  let duplicateRejected = false;
  try { await market.submitReview({ taskId: task.id, credential, feedback: 'Duplicate test submission.', scores: [4, 4, 4] }); } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error('Duplicate accepted');
  report.negativeChecks.push({ case: 'duplicate credential on same task', result: 'rejected before proving' });
  market.approveReview(receipt.receiptId);
  market.claimReward({ receiptId: receipt.receiptId, credential });
  market.closeTask(task.id);
  try {
    for (const { name, preimage } of calls) {
      stage = name;
      console.log(JSON.stringify({ stage, status: 'proving' }));
      const start = performance.now();
      for (const key of [await material.getProverKey(name), await material.getVerifierKey(name), await material.getZKIR(name)]) {
        if (!(key instanceof Uint8Array) || key.length === 0) throw new Error('Missing proof material');
      }
      if (name === 'submitReview') {
        let rejected = false;
        try { await provider.check(preimage, 'enroll'); } catch { rejected = true; }
        if (!rejected) throw new Error('Mismatched circuit accepted');
        report.negativeChecks.push({ case: 'review preimage with enrollment circuit', result: 'rejected by proof server' });
      }
      await provider.check(preimage, name);
      const proof = await provider.prove(preimage, name);
      if (!(proof instanceof Uint8Array) || !proof.length) throw new Error('Empty proof');
      report.proofs.push({ circuit: name, proofBytes: proof.length, sha256: digest(proof), elapsedMs: Math.round(performance.now() - start) });
      preimage.fill(0);
      await save();
      console.log(JSON.stringify({ stage, status: 'proved', proofBytes: proof.length }));
    }
  } finally { for (const { preimage } of calls) preimage.fill(0); }
  report.status = 'passed'; report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: 'passed', proofs: report.proofs.length, networkSubmission: false }));
}
try { await main(); } catch {
  report.status = 'failed'; report.failedStage = stage; report.finishedAt = new Date().toISOString();
  await save().catch(() => {});
  console.error(JSON.stringify({ status: 'failed', stage, message: 'Proof stage did not complete. Private diagnostics are intentionally omitted.' }));
  process.exitCode = 1;
}
