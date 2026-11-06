# Development

Use Node.js 24, Compact compiler 0.31.1 and compact-runtime 0.16.0. The package lockfile records the installed JavaScript dependency graph. Do not fabricate or hand-edit generated contract output.

## Install the compiler

Install the official Compact development tools following the [Midnight installation guide](https://docs.midnight.network/getting-started/installation). Select compiler 0.31.1:

```sh
compact update 0.31.1
compact compile +0.31.1 --version
```

On Windows, use a supported WSL Linux environment for the compiler. Windows' unrelated `compact.exe` compression utility is not the Midnight compiler. The compiler wrapper must resolve the intended executable explicitly.

The CI installer pins the Compact CLI installer version and checks its SHA256 before running it. Upgrading the toolchain requires reviewing a new checksum and all affected dependency versions.

## Compile, test and build

```sh
npm ci --ignore-scripts
npm run compile
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:network-browser
```

The contract is `contracts/reviewlab.compact`; compilation writes its generated implementation to `contracts/managed/reviewlab/contract/index.js`. Full compilation generates circuit artifacts and keys. `npm run compile:fast` skips key generation for iteration; it is insufficient for a release that includes proving assets. The compiler wrapper supports `COMPACTC` for an explicitly selected compiler binary; otherwise Linux uses the official Compact CLI.

The generated-runtime tests should exercise valid reviews and rejection cases: wrong expertise, expired credentials, invalid membership, duplicate submission, altered review data, unauthorized campaign operations and repeat claims. Each test establishes only the level of execution it actually performs.

`npm run dev` serves the generated `dist/` directory locally. The landing page leads to `browser.html` and `network.html`; both browser suites serve the real build beneath the GitHub Pages project path. `test:browser` exercises the local marketplace. `test:network-browser` checks the network UI, native WASM and proof assets, imports, private input handling, narrow screens and a wallet-denial path. Its API-4 connector fixture always rejects, so this suite cannot establish successful wallet connection or network acceptance. Use a clean browser context to distinguish restored public records from private credentials that have not been restored.

## Working with private material

Additional tests use the separately pinned SDK dependency graph:

```sh
npm ci --prefix devnet --ignore-scripts
npm run test:worker-proofs
npm run test:private-storage
```

The worker test needs full generated proof keys and Chromium. It downloads only two hash-pinned public parameter files, then runs six real contract proofs locally in a Web Worker. `npm run test:worker-proofs -- --offline` requires those files to be cached. Its bundle is isolated under ignored `artifacts/worker-proofs`; it does not change the public app's Lace proving integration. The storage test uses disposable synthetic data and the official filesystem LevelDB encryption provider, not a wallet or browser IndexedDB.

`npm run test:preview:wasm` is a separate, state-changing public Preview SDK test. It requires the existing dedicated Windows DPAPI wallet/checkpoint and usable test DUST; it never accepts an external seed. It creates a fresh marketplace, uses the official WASM worker for contract and wallet/DUST proofs, and keeps encrypted transaction records before submission. Each run has a distinct report and private test plan. It is not a Lace extension test. Never blindly retry an uncertain submission; reconcile its saved public identifier first.

Use synthetic demonstration credentials and test funds. Keep wallet seeds, private inputs and unencrypted keys out of source control, browser storage, CI artifacts and screenshots. The SDK's existing signing-key store is encrypted; role keys, credentials and feedback openings remain session-private unless explicitly downloaded. Do not copy private downloads into bug reports.

## Network integration

The public testnet client uses Midnight.js and Lace API 4 with **Run in this app (WASM)** selected. Both contract proving and wallet/DUST proving stay in Lace's internal worker path when that setting is active. ReviewLab does not implement an external prover fallback. The current wallet pays its own fees. Follow [TESTNET.md](TESTNET.md) for the user setup and [LACE-WASM.md](LACE-WASM.md) for the precise source, version and mode-check limitations.

Public connections require a session-only confirmation and reject a reported prover URL before proving, balancing and submission. Do not interpret an omitted URL as proof of internal mode: Lace also omits it for its remote TEE provider. Preserve encrypted SDK storage, private witness cleanup and confirmation recovery when changing providers. Test actual Lace/Preview acceptance separately from frontend deployment; the historical testkit adapter is not a replacement for this check.

Developer-only circuit proof checks remain separate from the public client and local generated-contract tests. Start proof-server 8.1.3 on loopback port 6301, set `MIDNIGHT_LOCAL_PROOF_SERVER=http://127.0.0.1:6301`, and run `npm run test:proofs`. The optional GitHub proof workflow demonstrates the pinned Docker invocation. Do not enable request-body logging: private witnesses are sent to that prover. A local proof result is not a network transaction confirmation or a Lace WASM test.

For actual transaction acceptance, install the isolated wallet dependency graph and run the local chain check from the repository root in a Linux shell with Docker available:

```sh
npm ci --prefix devnet --ignore-scripts
bash devnet/services.sh up
node devnet/probe.mjs
npm run test:devnet
npm run build
npx playwright install chromium
npm run test:devnet:browser
```

Compile the contract first. The service script pins node 1.0.400, indexer 4.3.5 and proof-server 8.1.3 by image digest and uses dedicated loopback ports. It refuses to replace pre-existing infrastructure with the same names. The SDK harness uses a synthetic genesis wallet only on this isolated `undeployed` chain, submits the complete marketplace lifecycle, checks `SucceedEntirely` through the configured indexer and tests submission-failure recovery.

The separate `test:devnet:browser` harness drives the built network page in Chromium. It exposes the official testkit's funded API-4 wallet adapter to that test page through Playwright. The adapter uses real Midnight cryptography and submits to the same isolated chain; it does not emulate success or access a personal wallet. Its contract proofs use the official ZKIR proving provider in the local Node test process with actual circuit material fetched by the browser. It is not a test of Lace's extension UI or public Preview. The SDK harness separately exercises the HTTP proof server.

The SDK harness writes sanitized reports under `artifacts/local-devnet/`; the funded browser harness uses `artifacts/local-devnet-browser/`. Do not retain raw wallet databases or prover request bodies. See the manually dispatched [devnet workflow](../.github/workflows/devnet.yml) for the complete repeatable sequence and scoped service cleanup. On Windows, keep the WSL distribution running while its Docker services are needed.

## Historical public Preview operator run

The retained `devnet/preview-*.mjs` helpers document the earlier Node-wallet/HTTP-prover acceptance run. They are not the current public browser setup and do not establish Lace internal-WASM behavior. The [recorded results](VERIFICATION.md#public-preview-status) contain eight accepted public transactions and the subsequent read-only browser check.

That run used a separate randomly generated test seed and loopback proof-server 8.1.3 on port 26300. `preview-wallet.mjs` protected the seed with Windows CurrentUser DPAPI under ignored `.local/`, printing only the public Preview address. The protected files are tied to the same Windows account, excluded from source and CI, and are not portable wallet backups. The private test plan, role keys, credential, feedback opening and SDK password are protected locally too. None is needed to connect a separate Lace wallet to the published contract.

The dedicated wallet uses the SDK's supported `additionalFeeOverhead: 1000n` SPECK option. This prevents the pinned wallet's zero-fee path from producing an empty fee section, as described in [upstream issue 700](https://github.com/midnightntwrk/midnight-wallet/issues/700). The public run diagnosed that malformed transaction through strict local ledger replay, then accepted the corrected same-task transaction. The remaining calls also passed local preflight before submission. No contract or dependency patch was needed.

The wallet saves DPAPI-encrypted snapshots every 90 seconds and at shutdown, using the SDK's supported subwallet serialization APIs. A matching snapshot is restored automatically on the next run. Its atomic pointer contains only the public address and an opaque checkpoint name; serialized wallet state remains encrypted. The runner also protects finalized contract transactions before submitting them and retains their public identifiers for confirmation recovery.

The report is written to `artifacts/public-preview/network-evidence.json`. A completed run also produces `marketplace.json` with public join details and task text, plus `public-record.json`. These are separate from the local-network reports. Inspect the recorded status and any pending submission before restarting; an interrupted response is not evidence that a transaction failed. Recovery checks confirmation first and retains earlier attempts. The recorded task recovery preserved the same task ID and protected plan; the contract rejects duplicate task IDs. One unknown attempt and a separately diagnosed malformed replacement remain in the evidence alongside the accepted correction.

The historical `preview-browser-read.mjs` check used the official API-4 testkit adapter to join the public contract and inspect its receipt/export without submission. Its report remains under `artifacts/public-preview-browser/`. The public client's new Lace identity and internal-mode gates intentionally do not treat that adapter as Lace; do not bypass those gates to label a new run as a Lace test. Preserve the old evidence and record any actual extension run separately.
