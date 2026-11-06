import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// This harness runs only in a disposable GitHub-hosted Linux job. It never
// opens the operator's browser profile or imports an existing wallet.
const repository = 'IBKR-BouncyBot/Midnight-ReviewLab';
const extensionId = 'gafhhkghbfjjkeiendhlofajokpaflmk';
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.GITHUB_REPOSITORY !== repository ||
    !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(runAttempt ?? '') ||
    !path.isAbsolute(process.env.RUNNER_TEMP ?? '')) {
  throw new Error('LACE_CI_REQUIRES_EPHEMERAL_GITHUB_LINUX_RUNNER');
}
process.umask(0o077);
const privateRoot = path.join(process.env.RUNNER_TEMP, `reviewlab-lace-${runId}-${runAttempt}`);
const mode = process.argv[2] ?? 'probe';
if (mode === 'cleanup') {
  // The target is constructed solely from validated numeric workflow IDs and
  // must be an immediate child of the runner temporary directory.
  if (path.dirname(privateRoot) !== path.resolve(process.env.RUNNER_TEMP)) throw new Error('INVALID_CLEANUP_TARGET');
  await rm(privateRoot, { recursive: true, force: true });
  process.exit(0);
}
if (!['probe', 'setup', 'acceptance'].includes(mode)) throw new Error('UNSUPPORTED_LACE_CI_PHASE');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = path.join(root, 'artifacts', 'lace-ci');
await mkdir(evidenceDirectory, { recursive: true });
if (mode !== 'acceptance') await mkdir(privateRoot, { recursive: false, mode: 0o700 });
const evidence = mode === 'acceptance'
  ? JSON.parse(await readFile(path.join(evidenceDirectory, 'setup-evidence.json'), 'utf8')) : {
  schema: 'reviewlab-lace-ci-v1',
  status: 'running',
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceCommit: process.env.GITHUB_SHA,
  startedAt: new Date().toISOString(),
  networkId: 'preview',
  requestedLaceVersion: '2.5.1',
  scope: mode === 'probe' ? 'Unmodified official extension package and initial production UI boot only' : 'Real released Lace, fresh ephemeral wallet, actual Preview network and internal WASM UI setting',
  walletCreated: false,
  fundsRequested: false,
  internalWasmModeSelected: false,
  acceptedTransactions: [],
  limitations: mode === 'probe' ? ['No wallet, proving-mode selection, proof generation or network acceptance is claimed by this probe.'] : [
    'UI settings and connector observations are not cryptographic mode attestation.',
    'Outbound metadata covers requests surfaced by Playwright, including surfaced service-worker requests; it is not an operating-system packet capture.',
    'Public indexer results are not independent chain or cryptographic proof verification.',
  ],
};
evidence.phase = mode;
if (mode === 'acceptance') { evidence.status = 'running'; delete evidence.completedAt; evidence.acceptanceStartedAt = new Date().toISOString(); }
const save = () => writeFile(path.join(evidenceDirectory, `${mode}-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`);
let context;
let timer;
const assetTasks = [];
try {
  evidence.stage = 'verify-official-package';
  await save();
  const extensionDirectory = path.join(privateRoot, 'package');
  if (mode !== 'acceptance') {
    const { acquireOfficialLace } = await import('./lace-ci-package.mjs');
    const result = await acquireOfficialLace({ outputDirectory: extensionDirectory });
    evidence.package = result.evidence;
  } else {
    if (evidence.workflowRunId !== runId || evidence.workflowRunAttempt !== runAttempt || evidence.sourceCommit !== process.env.GITHUB_SHA) throw new Error('PROFILE_PROVENANCE_MISMATCH');
    if (createHash('sha256').update(await readFile(path.join(extensionDirectory, 'manifest.json'))).digest('hex') !== evidence.package.manifestSha256) throw new Error('MANIFEST_CHANGED');
  }
  evidence.harnessSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  if (mode !== 'probe') {
    evidence.sourceHashes = {};
    for (const name of ['lace-ci-preview.mjs', 'lace-ci-wallet.mjs', 'lace-ci-package.mjs', 'lace-ci-approver.mjs', 'lace-ci-marketplace.mjs']) {
      evidence.sourceHashes[`devnet/${name}`] = createHash('sha256').update(await readFile(path.join(root, 'devnet', name))).digest('hex');
    }
  }
  evidence.stage = 'launch-unmodified-extension';
  await save();
  // No proxy, request rewriting, feature-flag overrides, mock API, source
  // mutation, trace, video or screenshot is enabled. Network interception
  // only aborts recognized HTTP proving attempts; it never rewrites traffic.
  context = await chromium.launchPersistentContext(path.join(privateRoot, 'profile'), {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    viewport: { width: 1280, height: 900 },
    timeout: 60_000,
  });
  timer = setTimeout(() => { void context?.close(); }, mode === 'probe' ? 180_000 : mode === 'setup' ? 20 * 60_000 : 75 * 60_000);
  evidence.browserVersion = context.browser()?.version() ?? null;
  evidence.outboundProofRequestObserved ??= false;
  evidence.outboundDestinations ??= [];
  evidence.loadedAppAssets ??= {};
  const proofRequest = request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const knownProver = /(?:^|\.)proofserver(?:\.|$)/.test(url.hostname) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return request.method() === 'POST' && (knownProver || /\/(?:prove|prove-tx|check|check-tx)(?:\/|$)/.test(url.pathname));
  };
  await context.route('**/*', async route => {
    if (proofRequest(route.request())) {
      evidence.outboundProofRequestObserved = true;
      evidence.recognizedProvingRequestAborted = true;
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    const worker = Boolean(request.serviceWorker());
    const prior = evidence.outboundDestinations.find(item => item.hostname === url.hostname && item.method === request.method() && item.serviceWorker === worker);
    if (prior) prior.count++;
    else if (evidence.outboundDestinations.length < 150) evidence.outboundDestinations.push({hostname:url.hostname, method:request.method(), serviceWorker:worker, count:1});
    if (proofRequest(request)) evidence.outboundProofRequestObserved = true;
  });
  context.on('response', response => {
    const url = new URL(response.url());
    const publicAsset = url.origin === 'https://ibkr-bouncybot.github.io' && /^\/Midnight-ReviewLab\/(?:network\.html|network-bundle\.mjs|network\.css|midnight\.css)$/.test(url.pathname);
    if (!publicAsset || !response.ok()) return;
    assetTasks.push(response.body().then(bytes => {
      evidence.loadedAppAssets[path.posix.basename(url.pathname)] = {sha256:createHash('sha256').update(bytes).digest('hex'), bytes:bytes.length};
    }).catch(() => {}));
  });
  let worker = context.serviceWorkers().find(item => item.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!worker) worker = await context.waitForEvent('serviceworker', {
    predicate: item => item.url().startsWith(`chrome-extension://${extensionId}/`), timeout: 45_000,
  });
  evidence.extensionServiceWorkerObserved = Boolean(worker);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/expo/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (mode !== 'acceptance') {
  // These public control identifiers were reviewed in official Lace source.
  // We only observe the initial empty-wallet UI; no recovery UI is opened.
  const knownControls = [
    'onboarding-start-create-wallet-button', 'onboarding-start-restore-wallet-button',
    'onboarding-start-hardware-wallet-button', 'new-password-input',
    'proof-server-in-process-radio', 'save-configuration-button',
  ];
  await page.waitForFunction(() => document.body?.innerText?.trim().length > 0, null, { timeout: 60_000 });
  await page.waitForTimeout(15_000);
  evidence.initialUi = await page.evaluate((known) => ({
    documentReady: document.readyState === 'complete',
    knownVisibleControls: known.filter(id => [...document.querySelectorAll('[data-testid]')]
      .some(el => el.getAttribute('data-testid') === id && el.getClientRects().length > 0)),
    // Attribute identifiers and input types, never entered values or page text.
    visibleControlMetadata: [...document.querySelectorAll('[data-testid],button,input,[role="button"]')]
      .filter(el => el.getClientRects().length > 0)
      .slice(0, 80).map(el => ({
        tag: el.tagName.toLowerCase(),
        testId: (el.getAttribute('data-testid') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100),
        inputType: el.tagName === 'INPUT' ? el.getAttribute('type') : undefined,
      })),
  }), knownControls);
  evidence.stage = 'initial-ui-observed';
  const onboardingVisible = evidence.initialUi.knownVisibleControls.some(id => id.startsWith('onboarding-start-'));
  evidence.status = onboardingVisible ? (mode === 'probe' ? 'passed' : 'running') : 'blocked';
  if (!onboardingVisible) evidence.blocker = 'EXPECTED_ONBOARDING_CONTROL_NOT_OBSERVED';
  if (!onboardingVisible) throw new Error('EXPECTED_ONBOARDING_CONTROL_NOT_OBSERVED');
  }
  if (mode === 'setup') {
    const {setupFreshWallet} = await import('./lace-ci-wallet.mjs');
    const funding = await setupFreshWallet({context, privateRoot, evidence, save});
    const serialized = `${JSON.stringify(funding, null, 2)}\n`;
    await writeFile(path.join(privateRoot, 'funding-request.json'), serialized, {flag:'wx', mode:0o600});
    await writeFile(path.join(evidenceDirectory, 'funding-request.json'), serialized);
  } else if (mode === 'acceptance') {
    const {resumeFundedWallet} = await import('./lace-ci-wallet.mjs');
    const record = await resumeFundedWallet({context, privateRoot, evidence, save});
    if (evidence.outboundProofRequestObserved) throw new Error('REMOTE_PROVING_ATTEMPT_OBSERVED');
    await writeFile(path.join(evidenceDirectory, 'public-record.json'), `${JSON.stringify(record, null, 2)}\n`);
    evidence.status = 'passed'; evidence.stage = 'real-lace-preview-lifecycle-complete';
  }
} catch (error) {
  // Browser/package exceptions may embed paths, URLs or page values. Do not
  // publish their message, cause, stack or console/network payloads.
  evidence.status = 'blocked';
  evidence.blocker = error?.name === 'TimeoutError' ? 'UI_OR_STARTUP_TIMEOUT' : 'PACKAGE_OR_BROWSER_CHECK_FAILED';
  evidence.errorType = ['Error', 'TimeoutError', 'TypeError'].includes(error?.name) ? error.name : 'Error';
  if (error?.name === 'LacePackageError' && /^[a-z-]{1,80}$/.test(error.code ?? '')) evidence.packageCheck = error.code;
  if (context && mode !== 'probe') {
    try {
      const {safeUiIdentifiers, safeRadioStates} = await import('./lace-ci-wallet.mjs');
      evidence.visibleUiIdentifiers = await safeUiIdentifiers(context);
      evidence.publicRadioStates = await safeRadioStates(context);
    } catch { /* no raw diagnostics */ }
  }
} finally {
  clearTimeout(timer);
  await context?.close().catch(() => {});
  await Promise.allSettled(assetTasks);
  evidence.completedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify({ status: evidence.status, stage: evidence.stage, blocker: evidence.blocker, workflowRunId: runId }));
if (!['passed', 'awaiting-funding'].includes(evidence.status)) process.exitCode = 1;
