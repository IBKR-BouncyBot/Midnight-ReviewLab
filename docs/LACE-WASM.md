# Lace internal WASM proving

The public ReviewLab client uses Lace for **both contract proofs and wallet/DUST proofs**. Select **Settings → Midnight → On this device → Run in this app (WASM) → Save configuration** in Lace, then confirm that selection when connecting ReviewLab. The setting is an explicit opt-in for the chosen network. The English labels come from [Lace's released translations](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/contract/i18n/src/translations/en.json#L350).

No Docker, localhost prover or remote proof server is part of this public-client setup. Public circuit keys and proving parameters may still be downloaded; proving inputs are processed inside Lace when internal mode is selected. The separate [developer harness](DEVELOPMENT.md#network-integration) retains its isolated local services.

Use the current desktop Lace extension and keep the browser open while proving. The first proof may need public parameter downloads; proofs consume CPU and memory, and Lace warns that complex transactions can exhaust available memory. No fixed minimum RAM is asserted here. If this device or installed version cannot run the internal prover, ReviewLab does not fall back to an external service.

## Version and source scope

Checked on 6 November 2026:

| Component | Verified scope |
| --- | --- |
| Lace Chrome Web Store | [2.5.1, updated 6 November](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk). The installed browser's version must be checked separately. |
| Latest published GitHub source release | [2.5.0](https://github.com/input-output-hk/lace/releases/tag/lace-extension%402.5.0), commit `bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d`. No 2.5.1 source tag was available at the time of this review. Source claims below refer to this exact 2.5.0 snapshot. |
| Reviewed connector and ledger | [DApp Connector 4.0.1, ledger-v8 8.1.0 and wallet SDK 1.2.0](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/package.json#L129). ReviewLab remains on its pinned ledger-8 integration. |
| Browser mechanism | Chromium Manifest V3 extension, offscreen document and dedicated Web Worker. Its use of `runtime.getContexts` requires [Chrome 116 or later](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts); this is an API floor, not a complete browser compatibility guarantee. Use a current browser supported by Lace. |

Some [Midnight setup documentation](https://docs.midnight.network/getting-started/installation) still describes a localhost proof server. The newer released Lace source contains the internal mode described here. Neither source inspection nor a Web Store version establishes a completed ReviewLab transaction; see [verification status](VERIFICATION.md#lace-internal-wasm-status).

## How the proofs run

1. ReviewLab executes the compiled contract and supplies its circuit keys through API 4's `getProvingProvider`. Lace exposes this provider through its [connector implementation](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/module/dapp-connector-midnight/src/midnight-wallet-api.ts#L120).
2. Internal mode creates an [extension Web Worker](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/apps/lace-extension/src/offscreen/index.ts#L5). It runs the official [`zkir-v2` proving provider](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/lib/vendor/src/wasm-proof-compute.ts#L1), with no proof-server fallback in that implementation.
3. ReviewLab hands the proved transaction to `balanceUnsealedTransaction`. Lace balances, signs and finalizes it. Its [wallet initialization](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/module/midnight-sync/src/store/dependencies.ts#L209) injects the selected proving service on both new and restored wallets. The [WASM service](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/lib/vendor/src/wasm-proof-server.ts#L114) proves wallet transactions too, including their DUST inputs. ReviewLab never receives the wallet's DUST keys.
4. Lace submits the finished transaction; ReviewLab waits for indexed confirmation and retains its existing encrypted state and recovery checks.

The extension [enables WASM support](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/contract/midnight-context/src/store/init.ts#L22), and its [mode selector](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/contract/midnight-context/src/store/slice.ts#L492) keeps it as an explicit choice. Existing localhost settings are not automatically replaced.

## What the application can check

ReviewLab requires an API-4 entry with Lace's declared `rdns`, `io.lace.wallet`, and a fresh session confirmation that you selected internal WASM. Lace's released [discovery entry](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/module/dapp-connector-midnight/src/dapp-connector-api.ts#L74) uses the display name `lace` and a new UUID key. These are discovery metadata, not cryptographic wallet authentication.

The public client rejects a reported `proverServerUri`, including a loopback URL, at connection and before proof, balance and submission requests. It does not supply an alternative prover. A session confirmation is not persisted as permanent approval of the wallet's settings.

**API 4 cannot independently attest internal mode.** Lace's [configuration response](https://github.com/input-output-hk/lace/blob/bec4d25a0ea75cc4fcd0dae36d63d4dfa8fb122d/packages/module/dapp-connector-midnight/src/store/dependencies/midnight-dapp-connector-api.ts#L414) omits `proverServerUri` for both internal WASM and its remote TEE mode. The API exposes neither the selected mode nor the installed extension version, and the dApp cannot inject a replacement prover into wallet balancing. Check the setting inside Lace; a page's CSP and network log do not control or cover all extension traffic. Verification of a no-external-prover run must include the extension's selected mode and its proving traffic, not merely an absent URL.

## Recorded user-operated test

On 6 November 2026, a user reporting **Edge and Lace 2.5.1** followed the published app's connection and task-creation steps and supplied a Preview transaction identifier. The [public transaction check](lace-preview-transaction.json) confirmed `SucceedEntirely` at block **1,627,842**, one `createTask` call for ReviewLab, a **4,508-byte contract proof** and a **2,940-byte DUST-spend proof**. See the [session record](lace-preview-session.json) and [verification details](VERIFICATION.md#lace-internal-wasm-status).

The requested mode was internal WASM; the verifier did not observe the extension UI or capture its traffic. Indexed acceptance establishes both proof types in this transaction, not their proving location. This is one user-operated task-creation test, not a complete Lace run of every marketplace circuit. The earlier eight accepted public transactions remain separate Node-wallet/HTTP-prover evidence.

## Inspecting a public test transaction

After creating an evaluation in the published Preview marketplace, share only its public transaction identifier. The browser user does not need any local service or command-line tool. For maintainers, `node devnet/verify-preview-lace.mjs --transaction <66-hex-identifier>` reads the fixed public Preview indexer and checks that the accepted transaction contains a `createTask` call for this contract, a contract proof and at least one DUST spend proof. It never accesses a wallet, generates proofs or submits anything.

The report contains public identifiers, proof counts and sizes, and indexed status. It cannot establish the wallet or machine that generated those proofs. Record the observed Lace version and internal-mode setting separately; an accepted transaction does not attest where proving happened. The optional `--historical-self-check` writes a separate report and must never be presented as a new Lace test.
