/** Visible-UI approvals for the disposable, unmodified Lace CI profile only.
 * No connector injection, extension state access, screenshots, or DOM text logs.
 * Selectors/scopes reviewed against official Lace source at:
 * https://github.com/input-output-hk/lace/tree/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d
 * packages/module/dapp-connector-midnight/src/render/{components/,}*.tsx
 * packages/module/dapp-connector-midnight/src/store/dapp-connector-util.ts
 * packages/module/authentication-prompt-ui-v2-extension/src/components/PasswordAuthPrompt.tsx
 * packages/module/blockchain-midnight/src/customisations/dust-designation/DustDesignationSheet.tsx
 * packages/lib/ui-extension/src/components/DappConnector/DappConnectorLayoutV2.tsx
 * The signed 2.5.1 package must expose these visible controls at runtime; source
 * review alone is not evidence of a successful 2.5.1 approval or transaction.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { LACE_PACKAGE } from './lace-ci-package.mjs';

const APP_ORIGIN = 'https://ibkr-bouncybot.github.io';
const SOURCE_COMMIT = 'bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d';
const TRANSACTIONS = new Set(['deploy', 'create-task', 'enroll-expert', 'submit-review',
  'approve-review', 'claim-entitlement', 'close-task']);
const KINDS = new Set(['connect', 'unlock', 'dust-registration', ...TRANSACTIONS]);
const AUTH_MESSAGES = Object.freeze({
  unlock: 'To unlock your wallet, please enter your password',
  transaction: "Confirm the transaction using your wallet's password",
  signTransaction: 'Please enter your password to sign this transaction',
});
const DUST_RESULT_SUBTITLES = Object.freeze({
  processing: 'Processing transaction',
  success: 'Transaction confirmed on the network. Your balance and activity may take a moment to update.',
  failure: 'Please check the details below',
});
// Static identifiers observed in the signed 2.5.1 JS package. Lace's
// parseErrorDetails renders `Error Code: ${submissionError.code || name}`.
// Its generic fallback description mentions a network timeout even when the
// underlying error is unknown, so that fallback must NOT imply network cause.
const DUST_FAILURE_CLASSES = Object.freeze({
  InsufficientDustForFeeError: 'insufficientDust',
  ProvingError: 'proof', ProvingConfigurationError: 'proof',
  ProvingEpochMismatchError: 'proof', UnsupportedProvingVersionError: 'proof',
  ProofOperationUnavailableError: 'proof',
  NetworkError: 'network', ConnectionError: 'network',
  WebsocketConnectionError: 'network', ConnectTimeoutError: 'network',
  HeadersTimeoutError: 'network', BodyTimeoutError: 'network',
  TransactionRejectedRpcError: 'rejected', UserRejectedRequestError: 'rejected',
});

class LaceApprovalError extends Error {
  constructor(code) { super(code); this.name = 'LaceApprovalError'; this.code = code; }
}
const requireValue = (ok, code) => { if (!ok) throw new LaceApprovalError(code); };
const visible = async locator => await locator.count() === 1 && await locator.isVisible();
// RN Web Pressable may be a DIV whose disabled prop is represented by pointer
// behavior rather than an HTML disabled attribute. isEnabled() alone is not a
// readiness check. Inspect only rendered interactivity, never React internals.
const pressableReady = async locator => await visible(locator) && await locator.isEnabled() &&
  await locator.evaluate(el => {
    if (getComputedStyle(el).pointerEvents === 'none') return false;
    for (let node = el; node instanceof HTMLElement; node = node.parentElement) {
      if (node.matches(':disabled,[aria-disabled="true"],[inert]')) return false;
    }
    const inner = [...el.querySelectorAll('button,[role="button"]')];
    return !inner.some(node => node.matches(':disabled,[aria-disabled="true"]'));
  });

function isLaceUi(page) {
  if (page.isClosed()) return false;
  try {
    const url = new URL(page.url());
    return url.protocol === 'chrome-extension:' && url.hostname === LACE_PACKAGE.extensionId &&
      url.pathname === '/expo/index.html' && url.search === '' && !url.username && !url.password;
  } catch { return false; }
}

async function safeMetadata(context) {
  const snapshots = [];
  for (const page of context.pages().filter(isLaceUi).slice(0, 8)) {
    try {
      snapshots.push(await page.evaluate(() => ({
        controls: [...document.querySelectorAll('[data-testid],button,input,[role="button"]')]
          .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
          .slice(0, 80).map(el => {
            const id = el.getAttribute('data-testid') ?? '';
            return { tag: el.tagName.toLowerCase(),
              testId: /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(id) && !/[a-f0-9]{16,}|\d{7,}/i.test(id) ? id : '',
              inputType: el.tagName === 'INPUT' && ['password', 'text', 'checkbox', 'radio', 'number', 'email', 'hidden'].includes(el.getAttribute('type'))
                ? el.getAttribute('type') : undefined };
          }),
      })));
    } catch { /* A closing popup has no diagnostic value. */ }
  }
  return snapshots;
}

/** The caller owns a fresh CI context, password lifetime, and serialized save().
 * until() must return a Boolean from a bounded public-state/UI check. Returning
 * true means the caller's condition holds; it does not attest transaction success.
 */
export function createLaceApprover({ context, walletPassword, evidence, save }) {
  requireValue(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.GITHUB_REPOSITORY === 'IBKR-BouncyBot/Midnight-ReviewLab', 'LACE_APPROVAL_REQUIRES_ISOLATED_CI');
  requireValue(context && typeof context.pages === 'function' && typeof save === 'function' &&
    typeof walletPassword === 'string' && walletPassword.length >= 12 && walletPassword.length <= 256,
  'LACE_APPROVAL_ARGUMENTS_INVALID');
  requireValue(evidence?.package?.extensionId === LACE_PACKAGE.extensionId &&
    evidence.package.version === LACE_PACKAGE.version && evidence.package.crxSha256 === LACE_PACKAGE.sha256 &&
    evidence.package.signaturesVerified >= 2, 'LACE_APPROVAL_PACKAGE_NOT_VERIFIED');
  evidence.walletApprovals ??= [];
  requireValue(Array.isArray(evidence.walletApprovals), 'LACE_APPROVAL_EVIDENCE_INVALID');
  evidence.approvalSelectorSourceCommit = SOURCE_COMMIT;
  let active = false;

  return async function approveWallet({ kind, timeoutMs = 120_000, until }) {
    requireValue(KINDS.has(kind) && typeof until === 'function' && Number.isInteger(timeoutMs) &&
      timeoutMs >= 1_000 && timeoutMs <= 900_000, 'LACE_APPROVAL_SCOPE_INVALID');
    requireValue(!active, 'LACE_APPROVAL_ALREADY_ACTIVE');
    active = true;
    const deadline = Date.now() + timeoutMs;
    const pageState = new WeakMap();
    const transactionKind = TRANSACTIONS.has(kind);
    let actionCount = 0;
    let transactionAuthorized = false;
    let dustAuthorized = false;
    let lastDustResult;
    const remaining = () => Math.max(1, Math.min(5_000, deadline - Date.now()));
    async function bounded(predicate) {
      let timer;
      try {
        return await Promise.race([Promise.resolve().then(predicate), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new LaceApprovalError('LACE_APPROVAL_CONDITION_TIMEOUT')),
            Math.max(1, Math.min(30_000, deadline - Date.now())));
        })]);
      } finally { clearTimeout(timer); }
    }
    async function record(action, observation = 'click-dispatched') {
      actionCount += 1;
      requireValue(actionCount <= 32 && evidence.walletApprovals.length < 256, 'LACE_APPROVAL_ACTION_LIMIT');
      evidence.walletApprovals.push({ kind, action, observation, at: new Date().toISOString() });
      await bounded(save);
    }
    async function click(page, locator, action, expectedLabel) {
      requireValue(isLaceUi(page), 'LACE_APPROVAL_PAGE_CHANGED');
      const readyDeadline = Math.min(deadline, Date.now() + 5_000);
      while (Date.now() < readyDeadline && !await pressableReady(locator)) await delay(100);
      requireValue(await pressableReady(locator), 'LACE_APPROVAL_CONTROL_UNAVAILABLE');
      if (expectedLabel) requireValue(await locator.evaluate((el, label) => el.textContent?.trim() === label,
        expectedLabel), 'LACE_APPROVAL_LABEL_MISMATCH');
      await locator.click({ timeout: remaining() });
      await record(action);
    }
    async function checkDappOrigin(page) {
      const origin = page.getByTestId('dapp-info-url');
      requireValue(await visible(origin) && await origin.evaluate((el, expected) => el.textContent?.trim() === expected,
        APP_ORIGIN), 'LACE_APPROVAL_DAPP_ORIGIN_MISMATCH');
    }
    async function observeDustResult() {
      if (kind !== 'dust-registration') return false;
      let resultOpen = false;
      for (const page of context.pages().filter(isLaceUi)) {
        const subtitle = page.getByTestId('send-result-subtitle');
        if (!await visible(subtitle)) continue;
        resultOpen = true;
        const failureDetails = await visible(page.getByTestId('send-result-error-title'));
        const result = failureDetails ? 'failure' : await subtitle.evaluate((el, known) =>
          Object.entries(known).find(([, text]) => text === el.textContent?.trim())?.[0] ?? 'unrecognized',
        DUST_RESULT_SUBTITLES);
        if (lastDustResult !== result) {
          lastDustResult = result;
          evidence.dustRegistrationResultUiHistory ??= [];
          requireValue(evidence.dustRegistrationResultUiHistory.length < 32, 'LACE_APPROVAL_RESULT_STATE_LIMIT');
          evidence.dustRegistrationResultUiHistory.push({ state: result, observedAt: new Date().toISOString(),
            source: 'released-Lace-result-UI', independentlyConfirmedTransaction: false });
          await bounded(save);
        }
        if (result === 'failure') {
          const failure = await page.evaluate(knownClasses => {
            const code = document.querySelector('[data-testid="send-result-error-code"]')?.textContent?.trim();
            const matched = Object.entries(knownClasses).find(([name]) => code === `Error Code: ${name}`);
            if (matched) return {category:matched[1], matchedStaticIdentifier:matched[0]};
            // Previously source-reviewed ledger/RPC rejection codes only. The
            // number is evidence of the displayed code, not its underlying cause.
            for (const knownCode of ['117', '1010', '1012']) {
              if (code === `Error Code: ${knownCode}`)
                return {category:'rejected', matchedStaticIdentifier:`numeric-code-${knownCode}`};
            }
            const description = document.querySelector('[data-testid="send-result-error-description"]')?.textContent?.trim();
            // Exact variants of designation-flow.error.insufficient-dust.
            if (description === 'Insufficient tDUST balance' || description === 'Insufficient DUST balance')
              return {category:'insufficientDust', matchedStaticIdentifier:'designation-insufficient-dust'};
            return {category:'unknown', matchedStaticIdentifier:null};
          }, DUST_FAILURE_CLASSES);
          evidence.dustRegistrationFailureUi = {...failure, observedAt:new Date().toISOString(),
            source:'released-Lace-result-UI', independentlyConfirmedTransaction:false};
          await bounded(save);
          throw new LaceApprovalError('LACE_APPROVAL_DUST_REGISTRATION_UI_FAILURE');
        }
        // Midnight's processing result is deliberately not closable. Its
        // failure primary action is Try again: this helper never clicks it.
        if (result !== 'success' || await visible(page.getByTestId('authentication-prompt-body'))) continue;
        requireValue(dustAuthorized, 'LACE_APPROVAL_UNEXPECTED_DUST_RESULT');
        const state = pageState.get(page) ?? { authSubmitted: false, clicked: new Set() };
        pageState.set(page, state);
        const close = page.getByTestId('send-result-close-button');
        if (!state.clicked.has('dust-result-close') && await pressableReady(close)) {
          await click(page, close, 'close-successful-dust-result', 'Close');
          state.clicked.add('dust-result-close');
        }
      }
      if (!resultOpen && lastDustResult === 'success') {
        lastDustResult = 'closed';
        evidence.dustRegistrationResultUiHistory.push({ state: 'closed', observedAt: new Date().toISOString(),
          source: 'released-Lace-result-UI', independentlyConfirmedTransaction: false });
        await bounded(save);
      }
      return resultOpen;
    }
    try {
      while (Date.now() < deadline) {
        // A result sheet can obscure the Home balance. Observe its explicit
        // terminal state and dismiss only success before checking the cap.
        const resultOpen = await observeDustResult();
        const complete = resultOpen ? false : await bounded(until);
        requireValue(typeof complete === 'boolean', 'LACE_APPROVAL_CONDITION_INVALID');
        if (complete) {
          // The caller may use an error/idle condition to end its wait. This is
          // not proof that a click authorized a request or a transaction passed.
          await record('caller-completion-condition-observed', 'condition-observed');
          return;
        }
        for (const page of context.pages().filter(isLaceUi)) {
          if (Date.now() >= deadline) break;
          const state = pageState.get(page) ?? { authSubmitted: false, clicked: new Set() };
          pageState.set(page, state);
          const auth = page.getByTestId('authentication-prompt-body');
          if (await visible(auth)) {
            const message = page.getByTestId('authentication-prompt-message');
            requireValue(await visible(message), 'LACE_APPROVAL_AUTH_SCOPE_UNAVAILABLE');
            const scope = await message.evaluate((el, allowed) => {
              const value = el.textContent?.trim();
              return Object.entries(allowed).find(([, text]) => text === value)?.[0] ?? 'unrecognized';
            }, AUTH_MESSAGES);
            const permitted = scope === 'unlock' ||
              ((scope === 'transaction' || scope === 'signTransaction') &&
                ((transactionKind && transactionAuthorized) || (kind === 'dust-registration' && dustAuthorized)));
            requireValue(permitted && !(kind === 'unlock' && scope !== 'unlock'), 'LACE_APPROVAL_AUTH_SCOPE_REJECTED');
            requireValue(!await visible(page.getByTestId('authentication-prompt-input-input-error')),
              'LACE_APPROVAL_AUTH_REJECTED');
            if (!state.authSubmitted) {
              const input = page.getByTestId('authentication-prompt-input-value');
              requireValue(await visible(input) && await input.isEditable() &&
                await input.getAttribute('type') === 'password', 'LACE_APPROVAL_PASSWORD_CONTROL_UNAVAILABLE');
              requireValue(isLaceUi(page), 'LACE_APPROVAL_PAGE_CHANGED');
              // The synthetic CI password is sent only to the visible extension
              // password control, never to evaluate(), evidence, or a logger.
              await input.fill(walletPassword, { timeout: remaining() });
              state.authSubmitted = true;
              await click(page, page.getByTestId('authentication-prompt-button-confirm'),
                `password-${scope}`);
            }
            continue;
          }
          state.authSubmitted = false;
          const connect = page.getByTestId('midnight-dapp-connect-description-list');
          if (await visible(connect)) {
            requireValue(kind === 'connect', 'LACE_APPROVAL_UNEXPECTED_CONNECTION');
            await checkDappOrigin(page);
            if (state.clicked.has('connect')) continue;
            const authorize = page.getByTestId('dapp-connector-primary-button');
            // selectedAccount starts null in MidnightDappConnectView. Always
            // select explicitly; an enabled-looking DIV cannot establish that
            // the underlying Authorize handler has an account to authorize.
            if (!state.clicked.has('account-selected')) {
              const option = page.getByTestId('dropdown-menu-item-0');
              if (!await visible(option)) {
                if (!state.clicked.has('account-menu')) {
                  await click(page, page.getByTestId('dropdown-button'), 'open-single-account-selector');
                  state.clicked.add('account-menu');
                }
                continue;
              }
              const options = page.locator('[data-testid^="dropdown-menu-item-"]').filter({ visible: true });
              const count = await options.evaluateAll(elements => elements.filter(el =>
                /^dropdown-menu-item-\d+$/.test(el.getAttribute('data-testid') ?? '')).length);
              requireValue(count === 1, 'LACE_APPROVAL_ACCOUNT_SELECTION_AMBIGUOUS');
              await click(page, option, 'select-single-midnight-account');
              state.clicked.add('account-selected');
              continue;
            }
            // Source binds this title to selectedAccount.metadata.name and the
            // primary disabled prop to !selectedAccount. Observe the resulting
            // UI change after the selection, not the click return value.
            const title = page.getByTestId('dropdown-button-title');
            const menu = page.getByTestId('dropdown-menu');
            if (await visible(menu) || !await visible(title) ||
                !await title.evaluate(el => Boolean(el.textContent?.trim()) &&
                  el.textContent.trim() !== 'Select Account') || !await pressableReady(authorize)) continue;
            if (!state.clicked.has('account-selection-observed')) {
              await record('single-midnight-account-selection-observed', 'ui-state-observed');
              state.clicked.add('account-selection-observed');
            }
            await click(page, authorize, 'authorize-published-app', 'Authorize');
            state.clicked.add('connect');
            continue;
          }
          const prove = page.getByTestId('dapp-sign-description');
          if (await visible(prove)) {
            requireValue(transactionKind, 'LACE_APPROVAL_UNEXPECTED_TRANSACTION');
            await checkDappOrigin(page);
            requireValue(await prove.evaluate(el => el.textContent?.trim() === 'Signing this transaction will prove this transaction'),
              'LACE_APPROVAL_TRANSACTION_DESCRIPTION_MISMATCH');
            if (!state.clicked.has('prove') && await pressableReady(page.getByTestId('dapp-connector-primary-button'))) {
              await click(page, page.getByTestId('dapp-connector-primary-button'),
                'authorize-midnight-transaction', 'Sign transaction');
              state.clicked.add('prove');
              transactionAuthorized = true;
            }
            continue;
          }
          const designation = page.getByTestId('confirm-designation-button');
          if (await visible(designation)) {
            requireValue(kind === 'dust-registration', 'LACE_APPROVAL_UNEXPECTED_DUST_REGISTRATION');
            requireValue(await visible(page.getByTestId('dust-designation-review-account-tag')) &&
              !await visible(page.getByTestId('dust-designation-review-external-address')) &&
              await visible(page.getByTestId('dust-designation-review-designating-label')),
            'LACE_APPROVAL_DUST_RECIPIENT_NOT_OWN_ACCOUNT');
            if (!state.clicked.has('dust') && await pressableReady(designation)) {
              await click(page, designation, 'confirm-own-dust-registration');
              state.clicked.add('dust');
              dustAuthorized = true;
            }
          }
        }
        await delay(Math.min(250, Math.max(1, deadline - Date.now())));
      }
      throw new LaceApprovalError('LACE_APPROVAL_TIMEOUT');
    } catch (error) {
      const code = error instanceof LaceApprovalError ? error.code : 'LACE_APPROVAL_UI_FAILED';
      evidence.approvalFailure = { kind, code, controlsOnly: await safeMetadata(context) };
      await bounded(save).catch(() => {});
      // Do not retain Playwright errors: they can contain input values or UI text.
      throw new LaceApprovalError(code);
    } finally { active = false; }
  };
}
