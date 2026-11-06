import * as RT from '@midnight-ntwrk/compact-runtime';
import { provingProvider } from '../node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm.js';
import * as zkirWasm from '../node_modules/@midnight-ntwrk/zkir-v2/midnight_zkir_wasm_bg.wasm';
import { createMarketplace } from '../../lib/native-engine.mjs';

const names = ['enroll', 'createTask', 'submitReview', 'approveReview', 'claimReward', 'closeTask'];
const cache = new Map();
async function asset(path) {
  if (!cache.has(path)) cache.set(path, fetch(new URL(`./assets/${path}`, import.meta.url), { credentials: 'omit', redirect: 'error' }).then(async response => {
    if (!response.ok) throw new Error('Public proving asset unavailable');
    return new Uint8Array(await response.arrayBuffer());
  }));
  return cache.get(path);
}
const keys = {
  async lookupKey(name) {
    if (!names.includes(name)) return undefined;
    const [ir, proverKey, verifierKey] = await Promise.all([
      asset(`contract/zkir/${name}.bzkir`), asset(`contract/keys/${name}.prover`), asset(`contract/keys/${name}.verifier`),
    ]);
    return { ir, proverKey, verifierKey };
  },
  async getParams(k) {
    if (![13, 15].includes(k)) throw new Error('Unexpected parameter size');
    return asset(`params/bls_midnight_2p${k}`);
  },
};
let started = false;
addEventListener('message', async ({ data }) => {
  if (started || data?.op !== 'prove-synthetic') return;
  started = true;
  const calls = [];
  let stage = 'generated-contract-fixture';
  try {
    const market = await createMarketplace({ onCircuit({ name, result }) {
      const { input, output, publicTranscript, privateTranscriptOutputs } = result.proofData;
      calls.push({ name, preimage: RT.proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTranscriptOutputs, name) });
    } });
    const credential = market.enrollExpert({ profession: 'software' });
    const task = await market.createTask({ profession: 'software', deadline: Math.floor(Date.now() / 1000) + 86400, capacity: 2, reward: 100, content: 'Synthetic browser worker evaluation.' });
    const reviewInput = { taskId: task.id, credential, feedback: 'Synthetic feedback created only inside this worker.', scores: [3, 4, 3] };
    const receipt = await market.submitReview(reviewInput);
    let duplicateRejected = false;
    try { await market.submitReview(reviewInput); } catch { duplicateRejected = true; }
    if (!duplicateRejected) throw new Error('Duplicate review was accepted');
    market.approveReview(receipt.receiptId);
    market.claimReward({ receiptId: receipt.receiptId, credential });
    market.closeTask(task.id);
    if (calls.length !== names.length || calls.some((call, index) => call.name !== names[index])) throw new Error('Unexpected generated circuit sequence');

    const provider = provingProvider(keys), proofs = [];
    stage = 'wrong-circuit-key-check';
    let wrongCircuitRejected = false;
    // The wrapper reads the circuit location from the serialized preimage;
    // its second string argument is ignored. Substitute the public material
    // returned for that lookup to exercise a real circuit mismatch instead.
    const wrongKeys = provingProvider({ lookupKey: () => keys.lookupKey('createTask'), getParams: keys.getParams });
    try { await wrongKeys.check(calls[2].preimage, 'submitReview'); } catch { wrongCircuitRejected = true; }
    if (!wrongCircuitRejected) throw new Error('Wrong circuit accepted a review preimage');
    for (const call of calls) {
      stage = call.name;
      postMessage({ type: 'progress', circuit: call.name });
      const startedAt = performance.now();
      await provider.check(call.preimage, call.name);
      const proof = await provider.prove(call.preimage, call.name);
      if (!(proof instanceof Uint8Array) || proof.length === 0 || !proof.some(value => value !== 0)) throw new Error('Empty proof');
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', proof)), byte => byte.toString(16).padStart(2, '0')).join('');
      proofs.push({ circuit: call.name, rawProofBytes: proof.length, sha256, elapsedMs: Math.round(performance.now() - startedAt), zkirMemoryBytes: zkirWasm.memory.buffer.byteLength });
      call.preimage.fill(0); proof.fill(0);
      postMessage({ type: 'proof-completed', circuit: call.name });
    }
    postMessage({ type: 'complete', proofs,
      negativeChecks: { duplicateReviewRejectedBeforeProving: duplicateRejected, wrongCircuitPreimageRejectedByZkirCheck: wrongCircuitRejected },
      sharedWasmMemory: typeof SharedArrayBuffer === 'function' && zkirWasm.memory.buffer instanceof SharedArrayBuffer,
      crossOriginIsolated: self.crossOriginIsolated, privateInputsGeneratedInsideWorker: true,
    });
  } catch { postMessage({ type: 'failed', category: 'worker-proof-check-failed', stage }); }
  finally { for (const call of calls) call.preimage.fill(0); }
});
postMessage({ type: 'ready' });
