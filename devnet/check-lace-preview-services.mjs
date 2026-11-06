/** Read-only availability comparison for fixed public Midnight Preview services.
 * No wallet, credentials, transaction, prover, headers or response bodies are
 * exported. This does not inspect or attest any wallet's active configuration.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

if (process.argv.length !== 2) throw new Error('This public service probe accepts no arguments');
const TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 65_536;
const targets = Object.freeze([
  {service:'released-lace-preview-indexer', protocol:'graphql', endpoint:'https://blockfrost.lw.iog.io/midnight-preview/'},
  {service:'released-lace-preview-node', protocol:'json-rpc', endpoint:'https://blockfrost.lw.iog.io/midnight-preview-rpc/'},
  {service:'canonical-preview-indexer', protocol:'graphql', endpoint:'https://indexer.preview.midnight.network/api/v4/graphql'},
  {service:'canonical-preview-node', protocol:'json-rpc', endpoint:'https://rpc.preview.midnight.network/'},
].map(target => Object.freeze(target)));
const allowed = new Set(targets.map(target => target.endpoint));

async function probe(target) {
  if (!allowed.has(target.endpoint)) throw new Error('Endpoint outside fixed public allowlist');
  const start = Date.now();
  const result = {service:target.service, endpoint:target.endpoint, method:'POST',
    operation:target.protocol === 'graphql' ? '__typename' : 'system_health',
    checkedAt:new Date(start).toISOString(), httpStatus:null, httpSuccess:false,
    redirectRefused:false, bodyWithinLimit:false, validJson:false, validPublicResponse:false};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = target.protocol === 'graphql'
      ? {query:'query PublicServiceAvailability { __typename }'}
      : {jsonrpc:'2.0', id:1, method:'system_health', params:[]};
    const response = await fetch(target.endpoint, {
      method:'POST', headers:{'content-type':'application/json', accept:'application/json'},
      body:JSON.stringify(body), credentials:'omit', referrerPolicy:'no-referrer',
      redirect:'manual', signal:controller.signal,
    });
    result.httpStatus = response.status;
    result.httpSuccess = response.ok;
    if (response.status >= 300 && response.status < 400) {
      result.redirectRefused = true;
      await response.body?.cancel();
      return result;
    }
    const chunks = []; let bytes = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
          result.failure = 'response-body-limit'; controller.abort(); return result;
        }
        chunks.push(chunk);
      }
    }
    result.bodyWithinLimit = true;
    let value;
    try { value = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); result.validJson = true; }
    catch { result.failure = 'non-json-public-response'; return result; }
    if (target.protocol === 'graphql') {
      result.validPublicResponse = response.ok && !value.errors &&
        typeof value.data?.__typename === 'string' && /^[_A-Za-z][_0-9A-Za-z]{0,63}$/.test(value.data.__typename);
    } else {
      result.validPublicResponse = response.ok && value.jsonrpc === '2.0' && value.id === 1 &&
        !value.error && typeof value.result?.isSyncing === 'boolean' &&
        Number.isSafeInteger(value.result?.peers) && value.result.peers >= 0 &&
        typeof value.result?.shouldHavePeers === 'boolean';
    }
    if (!result.validPublicResponse) result.failure = 'expected-public-response-not-observed';
    return result;
  } catch {
    result.failure = controller.signal.aborted ? 'request-timeout' : 'transport-error';
    return result;
  } finally {
    clearTimeout(timer);
    result.completedAt = new Date().toISOString();
    result.elapsedMs = Date.now() - start;
  }
}

const report = {
  schema:'reviewlab-lace-preview-services-v1', startedAt:new Date().toISOString(), networkId:'preview',
  scope:'Availability of four fixed public endpoints using only GraphQL __typename and JSON-RPC system_health',
  releasedEndpointSource:{laceVersion:'2.5.1', crxSha256:'bff973f7c741ccdbf91c4a1125d4d6da8e9a0b2384b6b1f51c6898b24c87e055'},
  sourceSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  timeoutMs:TIMEOUT_MS, maximumResponseBytes:MAX_BODY_BYTES,
  walletConfigurationInspected:false, walletConnected:false, proofRequested:false, transactionSubmitted:false,
};
const settled = await Promise.allSettled(targets.map(probe));
report.results = settled.map((result, index) => result.status === 'fulfilled' ? result.value : {
  service:targets[index].service, endpoint:targets[index].endpoint, method:'POST',
  validPublicResponse:false, failure:'probe-failed-without-exporting-error',
});
report.status = 'completed';
report.allEndpointsAvailable = report.results.every(result => result.validPublicResponse);
report.completedAt = new Date().toISOString();
await mkdir(new URL('../artifacts/', import.meta.url), {recursive:true});
await writeFile(new URL('../artifacts/lace-preview-services.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({status:report.status, allEndpointsAvailable:report.allEndpointsAvailable,
  results:report.results.map(({service,httpStatus,validPublicResponse,failure}) => ({service,httpStatus,validPublicResponse,failure}))}));
