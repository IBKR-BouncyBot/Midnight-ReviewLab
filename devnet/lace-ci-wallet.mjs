/** Fresh CI-only Lace wallet setup. No existing seed or user profile is read. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { createLaceApprover } from './lace-ci-approver.mjs';

const EXTENSION = 'chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/';
const APP = 'https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = locator => locator.isVisible().catch(() => false);
const extensionPages = context => context.pages().filter(page => page.url().startsWith(EXTENSION) && !page.isClosed());
const password = () => `Ci!${randomBytes(30).toString('base64url')}7aQ`;

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
  assert.equal(await group.getByTestId('radio-button-midnight-preview').getAttribute('aria-selected'), 'true');
  await stage('confirm-midnight-preview-network');
  await page.getByTestId('network-selection-sheet-confirm-button').click();
  await group.waitFor({ state: 'hidden', timeout: 30_000 });
  await stage('recheck-persisted-preview-network');
  await page.getByTestId('option-list-item-network').click();
  await group.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await page.getByTestId('radio-button-testnet').getAttribute('aria-selected'), 'true');
  assert.equal(await group.getByTestId('radio-button-midnight-preview').getAttribute('aria-selected'), 'true');
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
    assert.equal(await radio.getAttribute('aria-selected'), 'true');
    await page.getByTestId('save-configuration-button').click();
    await radio.waitFor({ state: 'hidden', timeout: 60_000 });
    // Read the selected persisted option again through UI, not extension state.
    await page.getByTestId('option-list-item-midnight').click();
    await radio.waitFor({ state: 'visible', timeout: 30_000 });
  }
  assert.equal(await radio.getAttribute('aria-selected'), 'true');
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
  const account = await page.evaluate(async () => {
    const initial = Object.values(window.midnight ?? {}).find(wallet => wallet.rdns === 'io.lace.wallet' && /^4\./.test(wallet.apiVersion));
    if (!initial) throw new Error('REAL_LACE_CONNECTOR_MISSING');
    const api = await initial.connect('preview');
    const configuration = await api.getConfiguration();
    const connection = await api.getConnectionStatus();
    const address = await api.getUnshieldedAddress();
    if (configuration.proverServerUri !== undefined || configuration.networkId !== 'preview' || connection.networkId !== 'preview') throw new Error('PREVIEW_INTERNAL_MODE_REQUIRED');
    // The authenticated 2.5.1 Store bundle ships IO's Preview proxy. This is
    // a network service, not a prover; retain the same strict Preview boundary.
    const indexer = new URL(configuration.indexerUri);
    const previewIndexer = (indexer.origin === 'https://indexer.preview.midnight.network' && indexer.pathname === '/api/v4/graphql') ||
      (indexer.origin === 'https://blockfrost.lw.iog.io' && /^\/midnight-preview\/?$/.test(indexer.pathname));
    if (!previewIndexer || indexer.search || indexer.hash || indexer.username || indexer.password) throw new Error('EXPECTED_PREVIEW_INDEXER_REQUIRED');
    return { unshieldedAddress: address.unshieldedAddress, networkId: configuration.networkId,
      apiVersion: initial.apiVersion, rdns: initial.rdns,
      indexerEndpoint: `${indexer.origin}${indexer.pathname}`,
      reportedProverServerUri: null };
  });
  assert.match(account.unshieldedAddress, /^mn_addr_preview1[ac-hj-np-z02-9]+$/);
  evidence.connector = account; await save();
  return page;
}

async function balances(page) {
  return page.evaluate(async () => {
    const initial = Object.values(window.midnight ?? {}).find(wallet => wallet.rdns === 'io.lace.wallet' && /^4\./.test(wallet.apiVersion));
    const api = await initial.connect('preview');
    const configuration = await api.getConfiguration();
    if (configuration.networkId !== 'preview' || configuration.proverServerUri !== undefined) throw new Error('PREVIEW_INTERNAL_MODE_REQUIRED');
    const [unshielded, dust] = await Promise.all([api.getUnshieldedBalances(), api.getDustBalance()]);
    return { night: String(unshielded['0'.repeat(64)] ?? 0n), dust: String(dust.balance), dustCap: String(dust.cap) };
  });
}

export async function setupFreshWallet({context, privateRoot, evidence, save}) {
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
  await stage('select-midnight-account-only');
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
  const approveWallet = createLaceApprover({context, walletPassword: secrets.walletPassword, evidence, save});
  await connectApp(context, secrets, approveWallet, evidence, save);
  evidence.fundsRequested = true;
  evidence.stage = 'public-funding-address-ready';
  evidence.status = 'awaiting-funding';
  await save();
  return {
    networkId: 'preview', laceVersion: '2.5.1', unshieldedAddress: evidence.connector.unshieldedAddress,
    workflowRunId: process.env.GITHUB_RUN_ID, workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceCommit: process.env.GITHUB_SHA, requestedTestNight: '1000',
    internalWasmSelectedAndSavedInUi: true, packageSha256: evidence.package.crxSha256,
    createdAt: new Date().toISOString(),
  };
}

export async function resumeFundedWallet({context, privateRoot, evidence, save}) {
  const secrets = JSON.parse(await readFile(path.join(privateRoot, 'temporary-passwords.json'), 'utf8'));
  const approveWallet = createLaceApprover({context, walletPassword: secrets.walletPassword, evidence, save});
  evidence.stage = 'unlock-same-ephemeral-lace-profile'; await save();
  await approveWallet({ kind: 'unlock', timeoutMs: 180_000, until: async () => {
    const pages = extensionPages(context);
    for (const page of pages) if (await visible(page.getByTestId('authentication-prompt-body'))) return false;
    for (const page of pages) if (await visible(page.getByTestId('main-menu-tab-btn'))) return true;
    return false;
  }});
  await wasmSettings(context, evidence, save, false);
  const appPage = await connectApp(context, secrets, approveWallet, evidence, save);
  const request = JSON.parse(await readFile(path.join(privateRoot, 'funding-request.json'), 'utf8'));
  assert.equal(evidence.connector.unshieldedAddress, request.unshieldedAddress);
  evidence.stage = 'wait-for-authorized-preview-funding'; await save();
  let balance;
  const deadline = Date.now() + 40 * 60_000;
  while (Date.now() < deadline) {
    balance = await balances(appPage);
    if (BigInt(balance.night) > 0n) break;
    await delay(15_000);
  }
  assert.ok(balance && BigInt(balance.night) > 0n, 'PREVIEW_FUNDING_TIMEOUT');
  evidence.fundingObserved = { unshieldedNightBaseUnits: balance.night, observedAt: new Date().toISOString() };
  await save();
  if (BigInt(balance.dustCap) === 0n) {
    evidence.stage = 'register-night-for-dust-through-lace-ui'; await save();
    // The Portfolio route exposes the official account action. No wallet SDK
    // or raw registration transaction is substituted for Lace here.
    const walletPage = await settings(context);
    let portfolio = walletPage.getByTestId('portfolio-tab-btn');
    if (!await visible(portfolio)) { await walletPage.getByTestId('main-menu-tab-btn').click(); portfolio = walletPage.getByTestId('portfolio-tab-btn'); }
    await portfolio.click({ timeout: 20_000 });
    await clickControl(context, 'account-card-generate-dust-button', 300_000);
    const address = await findControl(context, 'dust-address-input-value');
    assert.match(await address.control.inputValue(), /^mn_dust_preview1[ac-hj-np-z02-9]+$/);
    await clickControl(context, 'designate-button');
    await approveWallet({ kind: 'dust-registration', timeoutMs: 900_000, until: async () => {
      balance = await balances(appPage); return BigInt(balance.dustCap) > 0n;
    }});
    evidence.dustRegistrationObserved = true; await save();
  }
  evidence.stage = 'wait-for-usable-dust'; await save();
  const dustDeadline = Date.now() + 20 * 60_000;
  while (Date.now() < dustDeadline) {
    balance = await balances(appPage);
    if (BigInt(balance.dust) >= 1_000_000_000_000_000n) break;
    await delay(15_000);
  }
  assert.ok(BigInt(balance.dust) >= 1_000_000_000_000_000n, 'DUST_GENERATION_TIMEOUT');
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
      .filter(id => /^(?:onboarding|next|password|new-password|confirm-password|settings|portfolio|network|radio-button|proof-server|restore|option-list|main-menu|side-sheet|account-card|designate|dust-|authentication)/.test(id) && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0,100)));
  }
  return result;
}
