/** Public-indexer evidence only. This never opens a wallet, loads private keys,
 * proves, balances, signs or submits a transaction. An indexer cannot identify
 * which wallet or proving machine produced an accepted proof.
 *
 * Usage: node devnet/verify-preview-lace.mjs --transaction <66-hex identifier>
 * Add --historical-self-check ONLY for a separately labeled historical check.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
// Ledger-v8 identifiers include a one-byte tag plus a 32-byte hash. The
// installed Transaction.fromParts(...).identifiers() produces 66 hex chars;
// transactionHash() is a different, 64-hex value and is not accepted here.
const IDENTIFIER = /^[0-9a-f]{66}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const WAIT_MS = 30_000;
const root = resolve(import.meta.dirname, '..');
const query = `query ReviewLabPublicTransaction($offset: TransactionOffset!) {
  transactions(offset: $offset) {
    raw hash block { height hash }
    ... on RegularTransaction {
      identifiers
      transactionResult { status }
      fees { paidFees estimatedFees }
    }
  }
}`;

class VerificationFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireValue(condition, code) { if (!condition) throw new VerificationFailure(code); }
function decimal(value) {
  const text = typeof value === 'string' ? value
    : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : '';
  requireValue(/^(0|[1-9][0-9]{0,79})$/.test(text), 'invalid-indexer-response');
  return text;
}
async function boundedJson(response) {
  requireValue(response.ok && !response.redirected && response.url === INDEXER && response.body, 'public-indexer-unavailable');
  const length = Number(response.headers.get('content-length'));
  requireValue(!Number.isFinite(length) || length <= MAX_RESPONSE_BYTES, 'invalid-indexer-response');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new VerificationFailure('invalid-indexer-response'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
  catch { throw new VerificationFailure('invalid-indexer-response'); }
}

async function findTransaction(identifier) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WAIT_MS);
  try {
    for (;;) {
      const response = await fetch(INDEXER, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables: { offset: { identifier } } }),
        credentials: 'omit', redirect: 'error', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      const value = await boundedJson(response);
      requireValue(!value.errors?.length && Array.isArray(value.data?.transactions)
        && value.data.transactions.length <= 10, 'invalid-indexer-response');
      const matches = value.data.transactions.filter(tx => Array.isArray(tx.identifiers) && tx.identifiers.includes(identifier));
      requireValue(matches.length <= 1, 'transaction-identity-mismatch');
      if (matches.length === 1) return matches[0];
      requireValue(value.data.transactions.length === 0, 'transaction-identity-mismatch');
      await pause(1500, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (controller.signal.aborted) throw new VerificationFailure('not-found-within-30-seconds');
    if (error instanceof VerificationFailure) throw error;
    throw new VerificationFailure('public-indexer-unavailable');
  } finally { clearTimeout(timer); controller.abort(); }
}

export function inspectPublicTransaction(indexed, identifier, expectedAddress, ledger, toTxStatus) {
  requireValue(Array.isArray(indexed.identifiers) && indexed.identifiers.length > 0
    && indexed.identifiers.length <= 128 && indexed.identifiers.every(id => typeof id === 'string' && IDENTIFIER.test(id))
    && indexed.identifiers.includes(identifier), 'transaction-identity-mismatch');
  requireValue(indexed.transactionResult?.status === 'SUCCESS'
    && toTxStatus(indexed.transactionResult) === 'SucceedEntirely', 'transaction-not-fully-successful');
  requireValue(HASH.test(indexed.hash) && HASH.test(indexed.block?.hash), 'invalid-indexer-response');
  const blockHeight = Number(decimal(indexed.block?.height));
  requireValue(Number.isSafeInteger(blockHeight) && blockHeight > 0, 'invalid-indexer-response');
  requireValue(typeof indexed.raw === 'string' && indexed.raw.length > 0
    && indexed.raw.length <= MAX_RESPONSE_BYTES && /^(?:[0-9a-f]{2})+$/.test(indexed.raw), 'invalid-indexer-response');
  const transaction = ledger.Transaction.deserialize('signature', 'proof', 'binding', Buffer.from(indexed.raw, 'hex'));
  requireValue(transaction.transactionHash() === indexed.hash
    && transaction.identifiers().includes(identifier), 'transaction-identity-mismatch');

  const contractProofBytes = [], dustProofBytes = [];
  let contractCallCount = 0;
  for (const intent of transaction.intents.values()) {
    for (const action of intent.actions) {
      if (!(action instanceof ledger.ContractCall) || action.address !== expectedAddress) continue;
      const entryPoint = typeof action.entryPoint === 'string' ? action.entryPoint
        : Buffer.from(action.entryPoint).toString('utf8');
      if (entryPoint !== 'createTask') continue;
      contractCallCount++;
      requireValue(action.proof?.instance === 'proof', 'missing-contract-proof');
      const bytes = action.proof.serialize().byteLength;
      requireValue(bytes > 0, 'missing-contract-proof'); contractProofBytes.push(bytes);
    }
    for (const spend of intent.dustActions?.spends ?? []) {
      requireValue(spend.proof?.instance === 'proof', 'missing-dust-proof');
      const bytes = spend.proof.serialize().byteLength;
      requireValue(bytes > 0, 'missing-dust-proof'); dustProofBytes.push(bytes);
    }
  }
  requireValue(contractCallCount >= 1, 'wrong-contract-call');
  requireValue(contractProofBytes.length >= 1, 'missing-contract-proof');
  requireValue(dustProofBytes.length >= 1, 'missing-dust-proof');
  return {
    txId: identifier, transactionHash: indexed.hash, blockHeight, blockHash: indexed.block.hash,
    indexerStatus: 'SucceedEntirely', contractAddress: expectedAddress, operation: 'createTask',
    contractCallCount, contractProofCount: contractProofBytes.length, contractProofBytes,
    dustSpendCount: dustProofBytes.length, dustProofCount: dustProofBytes.length, dustProofBytes,
    fees: { paidFees: decimal(indexed.fees?.paidFees), estimatedFees: decimal(indexed.fees?.estimatedFees) },
    cryptographicProofsIndependentlyVerified: false,
  };
}

async function main(args) {
  // SDK initialization/errors must not write raw transaction bodies or paths.
  const originalConsole = new Map();
  for (const method of ['log', 'info', 'warn', 'debug', 'error', 'trace', 'dir', 'table']) {
    originalConsole.set(method, console[method]); console[method] = () => {};
  }
  const historical = args.length === 3 && args[2] === '--historical-self-check';
  const report = {
    checkedAt: new Date().toISOString(), networkId: 'preview', source: INDEXER,
    context: historical ? 'historical-verifier-self-check' : 'public-transaction-proof-presence',
    status: 'failed', walletAndModeObservedByVerifier: false, provingModeAttestedByIndexer: false,
    independentChainVerification: false, networkSubmission: false, privateWalletAccess: false,
  };
  let exitCode = 1;
  try {
    requireValue((args.length === 2 || historical) && args[0] === '--transaction'
      && typeof args[1] === 'string' && IDENTIFIER.test(args[1]), 'invalid-cli-use-66-hex-transaction-identifier');
    report.txId = args[1];
    const marketplaceBytes = await readFile(resolve(root, 'docs/public-preview-marketplace.json'));
    const marketplace = JSON.parse(marketplaceBytes);
    requireValue(marketplace.version === 1 && marketplace.kind === 'reviewlab-network-marketplace'
      && marketplace.networkId === 'preview' && HASH.test(marketplace.contractAddress), 'invalid-published-marketplace');
    report.marketplaceFileSha256 = createHash('sha256').update(marketplaceBytes).digest('hex');
    report.verifierSourceSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
    const [ledger, { toTxStatus }] = await Promise.all([
      import('@midnight-ntwrk/midnight-js-protocol/ledger'),
      import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    ]);
    const indexed = await findTransaction(args[1]);
    Object.assign(report, inspectPublicTransaction(indexed, args[1], marketplace.contractAddress, ledger, toTxStatus));
    report.status = 'passed-indexer-proof-presence'; exitCode = 0;
  } catch (error) {
    report.errorCode = error instanceof VerificationFailure ? error.code : 'verification-failed';
  }
  try {
    const directory = resolve(root, 'artifacts/lace-preview'); await mkdir(directory, { recursive: true });
    const target = resolve(directory, historical ? 'historical-self-check.json' : 'transaction-verification.json');
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, target);
  } catch { report.status = 'failed'; report.errorCode = 'report-write-failed'; exitCode = 1; }
  finally { for (const [method, implementation] of originalConsole) console[method] = implementation; }
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = exitCode;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
