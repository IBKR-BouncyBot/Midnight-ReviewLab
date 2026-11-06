// Adapted from Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial).
/** Public loopback readiness only. No wallet, witness, proof or transaction call. */
import { mkdir, writeFile } from 'node:fs/promises';
const reportUrl = new URL('../artifacts/local-devnet-readiness.json', import.meta.url);
const timeoutMs = 180_000;
const deadline = Date.now() + timeoutMs;
const output = {
  schema: 'midnight-reviewlab/local-devnet-readiness/v1',
  startedAt: new Date().toISOString(), networkId: 'undeployed',
  status: 'running', protocolCompatibility: 'not-established-by-readiness-probe',
  walletConnected: false, proofGenerated: false, transactionSubmitted: false,
};
async function json(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('unavailable');
  const value = await response.json();
  if (value.error || value.errors) throw new Error('rpc-rejected');
  return value;
}
async function probe() {
  const rpc = async method => (await json('http://127.0.0.1:29944',
    { id: 1, jsonrpc: '2.0', method, params: [] })).result;
  const [header, version, runtime, indexed, prover] = await Promise.all([
    rpc('chain_getHeader'), rpc('system_version'), rpc('state_getRuntimeVersion'),
    json('http://127.0.0.1:28088/api/v4/graphql', { query: '{ block { height timestamp } }' }),
    fetch('http://127.0.0.1:26300/version', { signal: AbortSignal.timeout(5_000) }),
  ]);
  if (!/^0x[0-9a-f]+$/i.test(header?.number ?? '') || BigInt(header.number) < 1n) throw new Error('node-at-genesis');
  if (typeof version !== 'string' || !/^[A-Za-z0-9._+() /-]{1,120}$/.test(version)) throw new Error('invalid-version');
  if (!Number.isSafeInteger(runtime?.specVersion) || !Number.isSafeInteger(runtime?.transactionVersion)) throw new Error('invalid-runtime');
  const height = indexed?.data?.block?.height, timestamp = indexed?.data?.block?.timestamp;
  if (!Number.isSafeInteger(height) || height < 1 || !Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('indexer-not-ready');
  if (!prover.ok || (await prover.text()).trim() !== '8.1.3') throw new Error('wrong-prover');
  return { node: { version, blockHeight: BigInt(header.number).toString(), specVersion: runtime.specVersion,
    transactionVersion: runtime.transactionVersion }, indexer: { blockHeight: height, timestamp },
  proofServer: { version: '8.1.3' } };
}
try {
  if (process.argv.length !== 2) throw new Error('No arguments accepted');
  for (;;) {
    try { Object.assign(output, await probe(), { status: 'passed' }); break; }
    catch {
      if (Date.now() >= deadline) throw new Error('Readiness timeout');
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
} catch {
  output.status = 'failed';
  output.reason = 'public-loopback-readiness-not-established';
  process.exitCode = 1;
}
output.completedAt = new Date().toISOString();
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(reportUrl, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output));
