/** Fresh CI-only Lace wallet setup. No existing seed or user profile is read. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { MidnightBech32m, DustAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { createLaceApprover } from './lace-ci-approver.mjs';
import { readPreviewReceivingAddress, readPreviewDustReceivingAddress, showMidnightAccountCard } from './lace-ci-receive.mjs';

const EXTENSION = 'chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/';
const APP = 'https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = locator => locator.isVisible().catch(() => false);
const extensionPages = context => context.pages().filter(page => page.url().startsWith(EXTENSION) && !page.isClosed());
const password = () => `Ci!${randomBytes(30).toString('base64url')}7aQ`;
const usableDustMinimum = 1_000_000_000_000_000n;
class LaceWalletUiError extends Error {
  constructor(code) { super(code); this.name = 'LaceWalletUiError'; this.code = code; }
}
class LaceConnectorReadError extends Error {
  constructor(code) { super(code); this.name = 'LaceConnectorReadError'; this.code = code; }
}

async function findControl(context, id, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const page of extensionPages(context)) {
      const control = page.getByTestId(id).first();
      if (await visible(control)) return { page, control };
    }
    await delay(250);
  }
  throw new Error('EXPECTED_LACE_CONTROL_NOT_FOUND');
}
async function clickControl(context, id, timeout) {
  const found = await findControl(context, id, timeout);
  await found.control.click({ timeout: 15_000 });
  return found.page;
}
async function settings(context) {
  for (const page of extensionPages(context)) {
    const current = page.getByTestId('option-list-item-midnight');
    if (await visible(current)) return page;
  }
  const { page } = await findControl(context, 'main-menu-tab-btn', 120_000);
  let item = page.getByTestId('settings-tab-btn');
  if (!await visible(item)) {
    await page.getByTestId('main-menu-tab-btn').click();
    item = page.getByTestId('settings-tab-btn');
  }
  await item.click({ timeout: 20_000 });
  await page.getByTestId('option-list-item-midnight').waitFor({ state: 'visible', timeout: 30_000 });
  return page;
}
async function closeSheet(page) {
  const close = page.getByTestId('side-sheet-close-button');
  if (await visible(close)) await close.click();
}
async function requireSelectedRadio(page, control) {
  await control.waitFor({state:'visible', timeout:30_000});
  const id = await control.getAttribute('data-testid');
  assert.match(id, /^(?:radio-button-|proof-server-)[a-z0-9-]+$/);
  // Released Lace's RadioButton shows a checkmark on selected OR hover/focus.
  // Its bundled web adapter may omit legacy accessibilityState attributes.
  // Clear only ordinary UI focus/hover before using the rendered checkmark.
  await control.evaluate(el => el.blur());
  await page.mouse.move(0, 0);
  await page.waitForFunction(testId => {
    const rendered = node => {
      if (!node || ![...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!rendered(el) || el.matches(':hover,:focus-within')) return false;
    const checked = el.getAttribute('aria-checked'), selected = el.getAttribute('aria-selected');
    if (checked === 'false' || selected === 'false') return false;
    if (checked === 'true' || selected === 'true') return true;
    const mark = el.querySelector(`[data-testid="${testId}-checkmark"]`);
    return rendered(mark);
  }, id, {timeout:15_000, polling:'raf'});
}
async function selectPreview(context, evidence, save) {
  const stage = async name => { evidence.stage = name; await save(); };
  await stage('open-real-lace-network-settings');
  const page = await settings(context);
  await page.getByTestId('option-list-item-network').click();
  await stage('select-testnet-network-mode');
  await page.getByTestId('radio-button-testnet').click({ timeout: 30_000 });
  const group = page.getByTestId(/network-selection-sheet-radio-group-midnight/i);
  await stage('select-midnight-preview-radio');
  await group.getByTestId('radio-button-midnight-preview').click({ timeout: 30_000 });
  await requireSelectedRadio(page, group.getByTestId('radio-button-midnight-preview'));
  await stage('confirm-midnight-preview-network');
  await page.getByTestId('network-selection-sheet-confirm-button').click();
  await group.waitFor({ state: 'hidden', timeout: 30_000 });
  await stage('recheck-persisted-preview-network');
  await page.getByTestId('option-list-item-network').click();
  await group.waitFor({ state: 'visible', timeout: 30_000 });
  await requireSelectedRadio(page, page.getByTestId('radio-button-testnet'));
  await requireSelectedRadio(page, group.getByTestId('radio-button-midnight-preview'));
  await page.getByTestId('network-selection-sheet-cancel-button').click();
  await group.waitFor({ state: 'hidden', timeout: 30_000 });
  evidence.previewSelectedInExtensionUi = true; await save();
}
async function wasmSettings(context, evidence, save, select) {
  const page = await settings(context);
  await page.getByTestId('option-list-item-midnight').click();
  const radio = page.getByTestId('proof-server-in-process-radio');
  await radio.waitFor({ state: 'visible', timeout: 30_000 });
  if (select) {
    await radio.click();
    await requireSelectedRadio(page, radio);
    await page.getByTestId('save-configuration-button').click();
    await radio.waitFor({ state: 'hidden', timeout: 60_000 });
    // Read the selected persisted option again through UI, not extension state.
    await page.getByTestId('option-list-item-midnight').click();
    await radio.waitFor({ state: 'visible', timeout: 30_000 });
  }
  await requireSelectedRadio(page, radio);
  evidence.internalWasmModeSelected = true;
  evidence.internalWasmSettingChecks = (evidence.internalWasmSettingChecks ?? 0) + 1;
  await closeSheet(page); await save();
}

async function connectApp(context, secrets, approveWallet, evidence, save) {
  evidence.stage = 'connect-published-app-to-real-lace'; await save();
  const page = await context.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => !document.getElementById('storage-password')?.disabled, null, { timeout: 120_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('#wallet-select option')].some(item => /lace/i.test(item.textContent)), null, { timeout: 45_000 });
  await page.locator('#network-select').selectOption('preview');
  await page.locator('#storage-password').fill(secrets.appPassword);
  await page.locator('#internal-prover-confirmed').check();
  await page.locator('#connect-form button.primary').click();
  await approveWallet({ kind: 'connect', timeoutMs: 600_000, until: async () =>
    /Wallet connected.*preview/.test(await page.locator('#connection-badge').innerText()) ||
    await page.locator('#connect-form button.primary').isEnabled() });
  assert.match(await page.locator('#connection-badge').innerText(), /Wallet connected.*preview/);
  // Use only the real, already authorized DApp Connector. No injected API or
  // provider replacement is created by this harness.
  evidence.stage = 'authorize-one-public-wallet-read-connection'; await save();
  const metadata = await page.evaluate(() => {
    const initial = Object.values(window.midnight ?? {}).find(wallet => wallet.rdns === 'io.lace.wallet' && /^4\./.test(wallet.apiVersion));
    if (!initial) throw new Error('REAL_LACE_CONNECTOR_MISSING');
    return {apiVersion:initial.apiVersion, rdns:initial.rdns};
  });
  // Lace intentionally re-authorizes each connect(). Retain one genuine API
  // object as a Playwright handle for public reads instead of reconnecting on
  // every balance poll. Both promise branches are attached immediately.
  let connectionSettled = false;
  const pendingConnection = page.evaluateHandle(async () => {
    const initial = Object.values(window.midnight ?? {}).find(wallet => wallet.rdns === 'io.lace.wallet' && /^4\./.test(wallet.apiVersion));
    if (!initial) throw new Error('REAL_LACE_CONNECTOR_MISSING');
    return initial.connect('preview');
  }).then(apiHandle => { connectionSettled = true; return {apiHandle}; },
    () => { connectionSettled = true; return {apiHandle:null}; });
  await approveWallet({kind:'connect', timeoutMs:600_000, until:async () => connectionSettled});
  const {apiHandle} = await pendingConnection;
  if (!apiHandle) throw new LaceConnectorReadError('LACE_CONNECTOR_PUBLIC_CONNECTION_FAILED');
  evidence.connectorReadChecks = {};
  const readStep = async (step, readFailureCode, read) => {
    evidence.stage = `read-public-preview-wallet-${step}`; await save();
    let result;
    try { result = await read(); }
    catch { throw new LaceConnectorReadError(readFailureCode); }
    evidence.connectorReadChecks[step] = result.diagnostics; await save();
    if (!result.ok) throw new LaceConnectorReadError(result.code);
    return result;
  };
  await readStep('configuration', 'LACE_CONNECTOR_CONFIGURATION_READ_FAILED', () => apiHandle.evaluate(async api => {
    const configuration = await api.getConfiguration();
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
      return {ok:false, code:'LACE_CONNECTOR_CONFIGURATION_INVALID', diagnostics:{validObject:false}};
    }
    const diagnostics = {
      networkId:['preview','preprod','mainnet','undeployed'].includes(configuration.networkId) ? configuration.networkId :
        configuration.networkId === undefined ? 'absent' : 'other',
      reportedProverServerUriAbsent:configuration.proverServerUri === undefined,
      indexer:{reported:configuration.indexerUri !== undefined},
    };
    if (configuration.networkId !== 'preview') return {ok:false, code:'LACE_CONNECTOR_CONFIGURATION_NETWORK_MISMATCH', diagnostics};
    if (configuration.proverServerUri !== undefined) return {ok:false, code:'LACE_CONNECTOR_REPORTED_PROVER_URI', diagnostics};
    // Match the app's optional runtime service metadata contract. Released
    // Lace refreshes its services dynamically; this harness never sends a
    // request to the reported URI or uses it to configure the public dApp.
    if (configuration.indexerUri !== undefined) {
      if (typeof configuration.indexerUri !== 'string' || configuration.indexerUri.length > 8192) {
        return {ok:false, code:'LACE_CONNECTOR_INDEXER_INVALID', diagnostics};
      }
      let indexer;
      try { indexer = new URL(configuration.indexerUri); }
      catch { return {ok:false, code:'LACE_CONNECTOR_INDEXER_INVALID', diagnostics}; }
      if (indexer.protocol !== 'https:') return {ok:false, code:'LACE_CONNECTOR_INDEXER_NON_HTTPS', diagnostics};
      if (indexer.username || indexer.password) return {ok:false, code:'LACE_CONNECTOR_INDEXER_USERINFO', diagnostics};
      const knownPaths = ['/', '/api/v4/graphql', '/api/v3/graphql', '/graphql', '/midnight-preview', '/midnight-preview/'];
      diagnostics.indexer = {reported:true, origin:indexer.origin,
        path:knownPaths.includes(indexer.pathname) ? indexer.pathname : 'redacted',
        queryPresent:Boolean(indexer.search), fragmentPresent:Boolean(indexer.hash)};
    }
    return {ok:true, diagnostics};
  }));
  await readStep('connection-status', 'LACE_CONNECTOR_STATUS_READ_FAILED', () => apiHandle.evaluate(async api => {
    const connection = await api.getConnectionStatus();
    const diagnostics = {
      status:['connected','disconnected'].includes(connection?.status) ? connection.status : 'other',
      networkId:['preview','preprod','mainnet','undeployed'].includes(connection?.networkId) ? connection.networkId :
        connection?.networkId === undefined ? 'absent' : 'other',
    };
    if (connection?.status !== 'connected') return {ok:false, code:'LACE_CONNECTOR_STATUS_NOT_CONNECTED', diagnostics};
    if (connection.networkId !== 'preview') return {ok:false, code:'LACE_CONNECTOR_STATUS_NETWORK_MISMATCH', diagnostics};
    return {ok:true, diagnostics};
  }));
  const address = await readStep('unshielded-address', 'LACE_CONNECTOR_ADDRESS_READ_FAILED', () => apiHandle.evaluate(async api => {
    const result = await api.getUnshieldedAddress();
    const valid = typeof result?.unshieldedAddress === 'string' && /^mn_addr_preview1[ac-hj-np-z02-9]+$/.test(result.unshieldedAddress);
    return {ok:valid, code:'LACE_CONNECTOR_ADDRESS_INVALID', diagnostics:{previewAddressFormat:valid},
      ...(valid ? {unshieldedAddress:result.unshieldedAddress} : {})};
  }));
  try {
    const encoded = MidnightBech32m.parse(address.unshieldedAddress);
    assert.equal(encoded.network, 'preview'); assert.equal(encoded.asString(), address.unshieldedAddress);
    encoded.decode(UnshieldedAddress, 'preview');
  } catch { throw new LaceConnectorReadError('LACE_CONNECTOR_ADDRESS_CHECKSUM_INVALID'); }
  evidence.connectorReadChecks['unshielded-address'].checksumVerified = true;
  evidence.connector = {unshieldedAddress:address.unshieldedAddress, networkId:'preview',
    reportedProverServerUri:null, ...metadata}; await save();
  // Context closure owns disposal of this handle. The object is not exported
  // or persisted, and the public dApp keeps its own separate real connection.
  return {appPage:page, apiHandle};
}

async function balances(apiHandle) {
  return apiHandle.evaluate(async api => {
    const configuration = await api.getConfiguration();
    if (configuration.networkId !== 'preview' || configuration.proverServerUri !== undefined) throw new Error('PREVIEW_INTERNAL_MODE_REQUIRED');
    const [unshielded, dust] = await Promise.all([api.getUnshieldedBalances(), api.getDustBalance()]);
    return { night: String(unshielded['0'.repeat(64)] ?? 0n), dust: String(dust.balance), dustCap: String(dust.cap) };
  });
}

async function positiveDustCapUi(context) {
  for (const page of extensionPages(context)) {
    const cap = page.getByTestId('dust-tank-max-value').first();
    if (!await visible(cap)) continue;
    const positive = await cap.evaluate(el => {
      const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
      // Public formatted balance only. Do not store its text or infer a chain
      // transaction from this UI observation. English is the runner locale.
      const match = text.match(/^(?:\/\s*)?([0-9][0-9,.\s]*)(?:\s*(?:tDUST|DUST))?$/);
      return Boolean(match && /[1-9]/.test(match[1]));
    });
    if (positive) return true;
  }
  return false;
}

async function openOwnDustForm(context, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of extensionPages(context)) {
      const input = page.getByTestId('dust-address-input-value');
      if (await visible(input)) {
        // The official form fills its own public DUST address in an effect.
        // Wait for that update without editing or exporting the address.
        await page.waitForFunction(() => {
          const field = document.querySelector('[data-testid="dust-address-input-value"]');
          return field && /^mn_dust_preview1[ac-hj-np-z02-9]+$/.test(field.value);
        }, null, {timeout:Math.max(1, deadline - Date.now()), polling:'raf'});
        return;
      }
      assert.equal(await visible(page.getByTestId('confirm-designation-button')), false);
      const action = page.getByTestId('account-card-generate-dust-button');
      if (await visible(action)) {
        // ActionButton places its test ID on a wrapper; the nested Pressable
        // owns disabled state. Opening this view is the only retry permitted.
        const disabled = action.locator('[aria-disabled="true"], [disabled]');
        if (await disabled.count() === 0) {
          try { await action.click({timeout:5_000}); }
          catch (error) { if (error?.name !== 'TimeoutError') throw error; }
        }
      }
    }
    await delay(3_000);
  }
  throw new Error('OWN_DUST_FORM_NOT_READY');
}

async function openDustReviewOnce(context, evidence, save) {
  evidence.stage = 'wait-for-own-dust-designate-readiness'; await save();
  const {page, control} = await findControl(context, 'designate-button');
  await control.scrollIntoViewIfNeeded();
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="designate-button"]');
      if (!el || !el.getClientRects().length || getComputedStyle(el).pointerEvents === 'none') return false;
      for (let node = el; node instanceof HTMLElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.matches(':disabled,[aria-disabled="true"],[inert]') || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
      }
      if ([...el.querySelectorAll('button,[role="button"]')].some(node =>
        node.matches(':disabled,[aria-disabled="true"]') || getComputedStyle(node).pointerEvents === 'none')) return false;
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    }, null, {timeout:300_000, polling:'raf'});
  } catch { throw new LaceWalletUiError('LACE_WALLET_DESIGNATE_NOT_READY'); }
  evidence.stage = 'open-own-dust-designation-review-once'; await save();
  // This is deliberately one click. A failure after dispatch never causes a
  // new designation or confirmation attempt to be manufactured by this helper.
  await control.click({timeout:15_000});
  evidence.dustDesignationClickDispatched = true; await save();
  try {
    await findControl(context, 'confirm-designation-button', 120_000);
    await findControl(context, 'dust-designation-review-account-tag', 15_000);
  } catch { throw new LaceWalletUiError('LACE_WALLET_DUST_REVIEW_NOT_OBSERVED'); }
  evidence.dustDesignationReviewUiObserved = true;
  evidence.stage = 'approve-own-dust-registration'; await save();
}

export async function setupFreshWallet({context, privateRoot, evidence, save}) {
  assert.ok(['self-registration', 'sdk-dust-designation'].includes(evidence.fundingMode));
  const sdkDesignation = evidence.fundingMode === 'sdk-dust-designation';
  const secrets = { walletPassword: password(), appPassword: password() };
  await writeFile(path.join(privateRoot, 'temporary-passwords.json'), JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
  const stage = async name => { evidence.stage = name; await save(); };
  await stage('open-restore-wallet-for-fresh-ci-wallet');
  await clickControl(context, 'onboarding-start-restore-wallet-button');
  await stage('enter-fresh-runner-only-mnemonic');
  const phrase = await findControl(context, 'restore-passphrase-input-value');
  assert.equal(await phrase.control.isEditable(), true);
  let mnemonic = generateMnemonic(wordlist, 256);
  try { await phrase.control.fill(mnemonic); } finally { mnemonic = undefined; }
  await stage('confirm-fresh-ci-mnemonic');
  await clickControl(context, 'next-button');
  await stage('set-fresh-ci-wallet-password');
  const login = await findControl(context, 'new-password-input-value');
  assert.equal(await login.control.getAttribute('type'), 'password');
  await login.control.fill(secrets.walletPassword);
  const confirmation = login.page.getByTestId('confirm-password-input-value');
  assert.equal(await confirmation.getAttribute('type'), 'password');
  await confirmation.fill(secrets.walletPassword);
  await stage('confirm-fresh-ci-wallet-password');
  await clickControl(context, 'next-btn');
  await stage('enable-midnight-account');
  const midnight = await findControl(context, 'onboarding-create-wallet-toggle-midnight');
  if (await midnight.control.getAttribute('aria-checked') !== 'true') await midnight.control.click();
  const cardano = midnight.page.getByTestId('onboarding-create-wallet-toggle-cardano');
  if (await visible(cardano) && await cardano.getAttribute('aria-checked') === 'true') await cardano.click();
  await stage('finish-fresh-ci-wallet-creation');
  await clickControl(context, 'onboarding-create-wallet-finish-button');
  await stage('wait-for-created-wallet-home');
  await findControl(context, 'main-menu-tab-btn', 180_000);
  evidence.walletCreated = true;
  evidence.walletOrigin = 'Fresh cryptographic mnemonic generated in runner memory and imported through released Lace UI';
  evidence.privatePersistence = 'Lace encrypted profile and temporary mode-0600 password file in RUNNER_TEMP; no seed file or private artifact';
  await selectPreview(context, evidence, save);
  evidence.stage = 'select-and-save-internal-wasm'; await save();
  await wasmSettings(context, evidence, save, true);
  evidence.stage = 'read-own-preview-unshielded-receive-address'; await save();
  const unshieldedAddress = await readPreviewReceivingAddress({context, evidence, save});
  assert.match(unshieldedAddress, /^mn_addr_preview1[ac-hj-np-z02-9]+$/);
  const dustAddress = sdkDesignation ? await readPreviewDustReceivingAddress({context, evidence, save}) : undefined;
  evidence.fundingAddress = {unshieldedAddress, source:'Released Lace Unshielded Receive UI', networkId:'preview'};
  if (sdkDesignation) evidence.dustFundingAddress = {dustAddress, source:'Released Lace Dust Receive UI', networkId:'preview'};
  evidence.fundingMechanism = sdkDesignation ? 'External SDK designation of NIGHT generation to Lace public DUST address' : 'Test NIGHT funding followed by Lace own DUST registration';
  evidence.fundsRequested = true;
  evidence.stage = 'public-funding-address-ready';
  evidence.status = 'awaiting-funding';
  await save();
  return {
    networkId: 'preview', laceVersion: '2.5.1', unshieldedAddress,
    fundingMode: evidence.fundingMode, ...(sdkDesignation ? {dustAddress} : {}),
    workflowRunId: process.env.GITHUB_RUN_ID, workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceCommit: process.env.GITHUB_SHA, requestedTestNight: sdkDesignation ? '0' : '1000',
    internalWasmSelectedAndSavedInUi: true, packageSha256: evidence.package.crxSha256,
    createdAt: new Date().toISOString(),
  };
}

export async function resumeFundedWallet({context, privateRoot, evidence, save}) {
  const secrets = JSON.parse(await readFile(path.join(privateRoot, 'temporary-passwords.json'), 'utf8'));
  const approveWallet = createLaceApprover({context, walletPassword: secrets.walletPassword, evidence, save});
  evidence.stage = 'wait-for-restarted-lace-password-prompt'; await save();
  // Home can render before the restart lock overlay mounts. The fresh browser
  // process must show its real password prompt before unlock can be observed.
  await findControl(context, 'authentication-prompt-body', 180_000);
  const unlockApprovalStart = evidence.walletApprovals.length;
  evidence.stage = 'unlock-same-ephemeral-lace-profile'; await save();
  await approveWallet({ kind: 'unlock', timeoutMs: 180_000, until: async () => {
    const passwordSubmitted = evidence.walletApprovals.slice(unlockApprovalStart).some(entry =>
      entry.kind === 'unlock' && entry.action === 'password-unlock' && entry.observation === 'click-dispatched');
    if (!passwordSubmitted) return false;
    const pages = extensionPages(context);
    for (const page of pages) if (await visible(page.getByTestId('authentication-prompt-body'))) return false;
    for (const page of pages) if (await visible(page.getByTestId('main-menu-tab-btn'))) return true;
    return false;
  }});
  evidence.walletRestartUnlockUiObserved = true;
  evidence.stage = 'recheck-saved-internal-wasm-after-unlock'; await save();
  await wasmSettings(context, evidence, save, false);
  const request = JSON.parse(await readFile(path.join(privateRoot, 'funding-request.json'), 'utf8'));
  assert.ok(['self-registration', 'sdk-dust-designation'].includes(request.fundingMode));
  assert.equal(request.fundingMode, evidence.fundingMode);
  assert.equal(request.fundingMode, process.env.REVIEWLAB_CI_FUNDING_MODE ?? 'self-registration');
  assert.equal(request.networkId, 'preview');
  assert.equal(request.workflowRunId, process.env.GITHUB_RUN_ID);
  assert.equal(request.workflowRunAttempt, process.env.GITHUB_RUN_ATTEMPT);
  assert.equal(request.sourceCommit, process.env.GITHUB_SHA);
  const sdkDesignation = request.fundingMode === 'sdk-dust-designation';
  assert.equal(request.requestedTestNight, sdkDesignation ? '0' : '1000');
  const receiveAddress = await readPreviewReceivingAddress({context, evidence, save});
  assert.equal(receiveAddress, request.unshieldedAddress);
  if (sdkDesignation) {
    // This mode funds generation from an external SDK wallet. It never opens
    // or retries Lace's own registration flow and cannot prove that flow works.
    evidence.laceOwnRegistration = {attempted:false, reason:'Explicit SDK-assisted DUST funding mode'};
  } else {
    await showMidnightAccountCard({context});
    if (!await positiveDustCapUi(context)) {
      evidence.stage = 'wait-for-funded-own-dust-form-in-lace-ui'; await save();
      // The Portfolio route exposes the official account action. No wallet SDK
      // or raw registration transaction is substituted for Lace in this mode.
      await openOwnDustForm(context, 40 * 60_000);
      evidence.fundedDesignationFormUiObserved = true;
      evidence.stage = 'register-night-for-dust-through-lace-ui'; await save();
      await openDustReviewOnce(context, evidence, save);
      await approveWallet({ kind: 'dust-registration', timeoutMs: 900_000, until: async () => {
        return positiveDustCapUi(context);
      }});
    }
    evidence.dustRegistrationUiObservation = {positiveDisplayedDustCap:true, observedAt:new Date().toISOString(), independentlyConfirmedTransaction:false};
  }
  await save();
  const {appPage, apiHandle} = await connectApp(context, secrets, approveWallet, evidence, save);
  assert.equal(evidence.connector.unshieldedAddress, request.unshieldedAddress);
  if (sdkDesignation) {
    evidence.stage = 'verify-real-lace-api-dust-address'; await save();
    const {dustAddress} = await apiHandle.evaluate(async api => {
      const configuration = await api.getConfiguration();
      if (configuration.networkId !== 'preview' || configuration.proverServerUri !== undefined) throw new Error('PREVIEW_INTERNAL_MODE_REQUIRED');
      return api.getDustAddress();
    });
    assert.match(dustAddress, /^mn_dust_preview1[ac-hj-np-z02-9]+$/);
    const encoded = MidnightBech32m.parse(dustAddress);
    assert.equal(encoded.network, 'preview'); assert.equal(encoded.asString(), dustAddress);
    encoded.decode(DustAddress, 'preview');
    assert.equal(dustAddress, request.dustAddress);
    evidence.connector.dustAddress = dustAddress;
    evidence.dustFundingAddressMatchesRealApi = true;
  }
  let balance = await balances(apiHandle);
  if (!sdkDesignation) {
    assert.ok(BigInt(balance.night) > 0n && BigInt(balance.dustCap) > 0n, 'FUNDED_REGISTERED_PREVIEW_WALLET_REQUIRED');
    evidence.fundingObserved = {unshieldedNightBaseUnits:balance.night, observedAt:new Date().toISOString(), source:'Real Lace API'};
  }
  evidence.stage = sdkDesignation ? 'wait-for-sdk-designated-usable-dust' : 'wait-for-usable-dust';
  evidence.dustFundingWaitLimitMinutes = sdkDesignation ? 45 : 20; await save();
  const dustDeadline = Date.now() + evidence.dustFundingWaitLimitMinutes * 60_000;
  while (Date.now() < dustDeadline) {
    balance = await balances(apiHandle);
    evidence.dustFundingReadiness = {positiveCap:BigInt(balance.dustCap) > 0n, usableBalance:BigInt(balance.dust) >= usableDustMinimum, source:'Real Lace API', observedAt:new Date().toISOString()};
    await save();
    if (evidence.dustFundingReadiness.positiveCap && evidence.dustFundingReadiness.usableBalance) break;
    await delay(15_000);
  }
  assert.ok(BigInt(balance.dustCap) > 0n && BigInt(balance.dust) >= usableDustMinimum, 'DUST_GENERATION_TIMEOUT');
  if (sdkDesignation) evidence.dustFundingObservation = {
    requestedMechanism:'External SDK NIGHT designation to this Lace DUST address',
    source:'Real Lace API cap and balance', ownNightFundingRequired:false,
    designationTransactionIndependentlyVerifiedByRunner:false, observedAt:new Date().toISOString(),
  };
  evidence.dustObserved = { balanceBaseUnits: balance.dust, capBaseUnits: balance.dustCap, observedAt: new Date().toISOString() }; await save();
  const assertInternalWasm = async () => {
    assert.equal(evidence.outboundProofRequestObserved, false);
    await wasmSettings(context, evidence, save, false);
    await appPage.bringToFront();
  };
  const { runLaceMarketplace } = await import('./lace-ci-marketplace.mjs');
  return runLaceMarketplace({context, appPage, approveWallet, assertInternalWasm, evidence, save});
}

export async function safeUiIdentifiers(context) {
  const result = [];
  for (const page of extensionPages(context)) {
    result.push(await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')]
      .filter(el => el.getClientRects().length > 0)
      .map(el => el.getAttribute('data-testid'))
      .filter(id => /^(?:onboarding|next|password|new-password|confirm-password|settings|portfolio|network|radio-button|proof-server|restore|option-list|main-menu|side-sheet|account-card|designate|dust-|authentication|receive-|dropdown-|send-result-|Unshielded$|Shielded$|Dust$)/.test(id) && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0,160)));
  }
  return result;
}

export async function safeWalletUiReadiness(context) {
  const pages = [];
  for (const page of extensionPages(context)) {
    try {
      pages.push(await page.evaluate(() => {
        const get = id => document.querySelector(`[data-testid="${id}"]`);
        const visible = el => {
          if (!el || ![...el.getClientRects()].some(box => box.width > 0 && box.height > 0)) return false;
          for (let node = el; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
          }
          return true;
        };
        const dustAmount = id => {
          const el = get(id), shown = visible(el);
          const text = shown ? (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() : '';
          const match = text.match(/^(?:\/\s*)?([0-9][0-9,.\s]*)(?:\s*(?:tDUST|DUST))?$/);
          return {visible:shown, numericFormatRecognized:Boolean(match), positive:Boolean(match && /[1-9]/.test(match[1]))};
        };
        const buttonState = id => {
          const el = get(id), shown = visible(el);
          if (!shown) return {visible:false, disabled:false, interactive:false};
          // ActionButton's icon is directly inside its nested Pressable.
          const icon = id === 'account-card-generate-dust-button' ? get(`${id}-icon`) : null;
          const target = icon?.parentElement && el.contains(icon.parentElement) ? icon.parentElement : el;
          let disabled = false;
          for (let node = target; node; node = node.parentElement) {
            if (node.matches(':disabled,[aria-disabled="true"],[inert]') || getComputedStyle(node).pointerEvents === 'none') disabled = true;
          }
          if ([...target.querySelectorAll('button,[role="button"]')].some(node => node.matches(':disabled,[aria-disabled="true"]'))) disabled = true;
          const box = target.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {visible:shown, disabled, interactive:!disabled && Boolean(hit && (hit === target || target.contains(hit)))};
        };
        const knownResultIds = ['send-result-sheet-header','send-result-subtitle','send-result-close-button',
          'send-result-primary-button','send-result-error-title','send-result-error-description','send-result-error-code',
          'send-result-error-timestamp','send-result-error-request-id','send-result-sent-label',
          'send-result-recipient-value','send-result-fee-value'];
        const subtitle = visible(get('send-result-subtitle')) ? get('send-result-subtitle').textContent?.trim() : '';
        const knownSubtitles = {
          'Processing transaction':'processing',
          'Transaction confirmed on the network. Your balance and activity may take a moment to update.':'success',
          'Please check the details below':'failure',
        };
        return {
          dustCap:dustAmount('dust-tank-max-value'), dustBalance:dustAmount('dust-tank-current-value'),
          generateDust:buttonState('account-card-generate-dust-button'), designate:buttonState('designate-button'),
          confirmDesignation:buttonState('confirm-designation-button'),
          authenticationPresent:visible(get('authentication-prompt-body')),
          dustFormPresent:visible(get('dust-address-input-value')),
          ownDustReviewPresent:visible(get('dust-designation-review-account-tag')),
          transactionResultUi:visible(get('send-result-error-title')) ? 'failure' :
            Object.hasOwn(knownSubtitles, subtitle) ? knownSubtitles[subtitle] :
              (subtitle || visible(get('send-result-sheet-header')) ? 'unrecognized' : 'absent'),
          visibleTransactionResultControls:knownResultIds.filter(id => visible(get(id))),
          resultClose:buttonState('send-result-close-button'),
        };
      }));
    } catch { /* A closing UI page is omitted without exporting its error. */ }
  }
  return {observedAt:new Date().toISOString(), source:'Visible released-Lace UI only; no chain confirmation inferred', pages};
}

export async function safeRadioStates(context) {
  const result = [];
  for (const page of extensionPages(context)) {
    result.push(await page.evaluate(() => [...document.querySelectorAll('[data-testid]')]
      .filter(el => /^(?:radio-button-[a-z0-9-]+|proof-server-[a-z0-9-]+-radio)$/.test(el.getAttribute('data-testid')) &&
        !el.getAttribute('data-testid').endsWith('-checkmark') && el.getClientRects().length)
      .slice(0,64).map(el => {
        const id = el.getAttribute('data-testid');
        const mark = el.querySelector(`[data-testid="${id}-checkmark"]`);
        let checkmarkVisible = Boolean(mark && [...mark.getClientRects()].some(rect => rect.width > 0 && rect.height > 0));
        for (let current = mark; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) checkmarkVisible = false;
        }
        return {testId:id, role:el.getAttribute('role'), ariaChecked:el.getAttribute('aria-checked'),
          ariaSelected:el.getAttribute('aria-selected'), focused:el.matches(':focus-within'), hovered:el.matches(':hover'),
          checkmarkVisible};
      })));
  }
  return result;
}
