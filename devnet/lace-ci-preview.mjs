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
if (mode !== 'probe') throw new Error('UNSUPPORTED_LACE_CI_PHASE');

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const evidenceDirectory = path.join(root, 'artifacts', 'lace-ci');
await mkdir(evidenceDirectory, { recursive: true });
await mkdir(privateRoot, { recursive: false, mode: 0o700 });
const evidence = {
  schema: 'reviewlab-lace-ci-probe-v1',
  status: 'running',
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceCommit: process.env.GITHUB_SHA,
  startedAt: new Date().toISOString(),
  networkId: 'preview',
  requestedLaceVersion: '2.5.1',
  scope: 'Unmodified official extension package and initial production UI boot only',
  walletCreated: false,
  fundsRequested: false,
  internalWasmModeSelected: false,
  acceptedTransactions: [],
  limitations: ['No wallet, proving-mode selection, proof generation or network acceptance is claimed by this probe.'],
};
const save = () => writeFile(path.join(evidenceDirectory, 'probe-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
let context;
let timer;
try {
  evidence.stage = 'verify-official-package';
  await save();
  const { acquireOfficialLace } = await import('./lace-ci-package.mjs');
  const { extensionDirectory, evidence: packageEvidence } = await acquireOfficialLace({ outputDirectory: path.join(privateRoot, 'package') });
  evidence.package = packageEvidence;
  evidence.harnessSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  evidence.stage = 'launch-unmodified-extension';
  await save();
  // No proxy, request rewriting, feature-flag overrides, mock API, source
  // mutation, devtools inspector, trace, video or screenshot is enabled.
  context = await chromium.launchPersistentContext(path.join(privateRoot, 'profile'), {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    viewport: { width: 1280, height: 900 },
    timeout: 60_000,
  });
  timer = setTimeout(() => { void context?.close(); }, 180_000);
  evidence.browserVersion = context.browser()?.version() ?? null;
  let worker = context.serviceWorkers().find(item => item.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!worker) worker = await context.waitForEvent('serviceworker', {
    predicate: item => item.url().startsWith(`chrome-extension://${extensionId}/`), timeout: 45_000,
  });
  evidence.extensionServiceWorkerObserved = Boolean(worker);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/expo/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
  evidence.status = onboardingVisible ? 'passed' : 'blocked';
  if (!onboardingVisible) evidence.blocker = 'EXPECTED_ONBOARDING_CONTROL_NOT_OBSERVED';
} catch (error) {
  // Browser/package exceptions may embed paths, URLs or page values. Do not
  // publish their message, cause, stack or console/network payloads.
  evidence.status = 'blocked';
  evidence.blocker = error?.name === 'TimeoutError' ? 'UI_OR_STARTUP_TIMEOUT' : 'PACKAGE_OR_BROWSER_CHECK_FAILED';
  evidence.errorType = ['Error', 'TimeoutError', 'TypeError'].includes(error?.name) ? error.name : 'Error';
  if (error?.name === 'LacePackageError' && /^[a-z-]{1,80}$/.test(error.code ?? '')) evidence.packageCheck = error.code;
} finally {
  clearTimeout(timer);
  await context?.close().catch(() => {});
  evidence.completedAt = new Date().toISOString();
  await save();
}
console.log(JSON.stringify({ status: evidence.status, stage: evidence.stage, blocker: evidence.blocker, workflowRunId: runId }));
if (evidence.status !== 'passed') process.exitCode = 1;
