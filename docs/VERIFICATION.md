# Verification

ReviewLab reports four different milestones separately: generated-contract execution, real circuit proof generation, blockchain acceptance and website deployment. Passing one does not imply the others.

## Lace internal WASM status

**The complete marketplace lifecycle passed independently through real Lace 2.5.1 on public Preview at 22:11:28 UTC on 6 November 2026.** [Workflow 42297109348](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42297109348) ran the unchanged official Store package in Chromium on an ephemeral GitHub-hosted Linux runner, using a fresh encrypted wallet and the published ReviewLab client. The package hash and all three CRX3 signatures were verified; no source rebuild or mocked wallet API was used. The [acceptance evidence](lace-ci-acceptance-evidence.json) records seven `SucceedEntirely` transactions:

| Action | Preview block | Serialized proofs present |
| --- | --- | --- |
| Deploy | 1,629,979 | One DUST proof |
| Create task | 1,629,991 | One contract proof and one DUST proof |
| Enroll expert | 1,630,003 | One contract proof and one DUST proof |
| Submit review | 1,630,025 | One contract proof and one DUST proof |
| Approve review | 1,630,037 | One contract proof and one DUST proof |
| Claim entitlement | 1,630,049 | One contract proof and one DUST proof |
| Close task | 1,630,061 | One contract proof and one DUST proof |

All six contract circuits were exercised through Lace, with **six 4,508-byte contract proofs** and **seven 2,940-byte DUST-spend proofs** in the indexed transactions. The [final public record](lace-ci-public-record.json) contains one expert, one closed task, one review and one claimed entitlement. Duplicate review and duplicate claim attempts added no accepted transaction. The browser checked the receipt and public export, reported no page errors, and the workflow successfully removed its private wallet profile. No reward payment or application sponsor service ran.

A [separate public recheck](lace-ci-public-verification.json) passed at 22:14:30 UTC, decoding all seven transactions from the canonical Preview indexer and confirming their identities, contract, operations and proof counts without a wallet or submission. From a checkout with the developer dependencies installed, reproduce that read-only check with `node devnet/verify-lace-ci-marketplace.mjs`. It uses the same public indexer and does not independently verify consensus or proof cryptography.

The runner saved and rechecked Lace's internal-WASM setting **ten times**, unlocked its encrypted profile after restart, and observed no recognized outbound HTTP proving request through Playwright. All marketplace contract proving, wallet/DUST proving, balancing and submission used the real Lace connector. These UI and surfaced-request observations are not cryptographic mode attestation or an operating-system packet capture. Acceptance and proof presence were checked against the public Preview indexer, not independently verified consensus or proof cryptography. The report includes the harness revision and loaded public application asset hashes.

The report's nested `package.extensionExecuted: false` and `package.walletAccess: false` describe only package validation before launch. Actual extension execution is recorded by `extensionServiceWorkerObserved: true` and the subsequent wallet and transaction steps.

Funding was a separate **SDK-assisted DUST designation**, [accepted at block 1,629,969](lace-ci-designation-verification.json): generation from 3,000 test NIGHT was assigned to the fresh Lace DUST address while NIGHT stayed with the sponsor. The successful marketplace run did not attempt Lace's own registration UI or require NIGHT in the Lace wallet. This is test funding infrastructure, not a local SDK or proof-server requirement for app users; the public client needs a browser, Lace and usable test DUST.

### Earlier independent wallet attempts

The [isolated GitHub runner probe](lace-ci-probe-evidence.json) independently downloaded the released **Lace 2.5.1** Chrome Store package, verified its pinned hash, three CRX3 signatures, developer identity and Store publisher signature, and opened its unchanged production UI in Chromium. The real extension service worker and onboarding controls were observed in [workflow 42279947215](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42279947215). This first checkpoint created no wallet and made no transaction; it is not full Lace acceptance evidence. No source rebuild, mocked backend or earlier-version binary was used.

Subsequent independent runs used that genuine package on ephemeral GitHub-hosted Linux runners, created fresh wallets through the real UI, saved and rechecked Preview/internal-WASM settings, and unlocked the same encrypted profile after a browser restart. Private profiles and temporary passwords stayed in the runner's private temporary directory and were excluded from published artifacts. Two wallets each received **1,000 test NIGHT**, verified against the canonical public Preview indexer:

| Run | Accepted funding | Registration outcome |
| --- | --- | --- |
| [42290089655](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42290089655) | [1,000 test NIGHT, block 1,629,256](lace-ci-funding-verification.json) | [Operator-cancelled before a terminal result was observed](lace-ci-funded-attempt-1.json). This is not a completed test or an observed registration failure. |
| [42293370522](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42293370522) | [1,000 test NIGHT, block 1,629,437](lace-ci-funding-verification-2.json) | [Lace's actual registration UI changed from processing to failure](lace-ci-registration-failure.json) at 21:09:10 UTC; its cause remains unknown. |

Neither of these earlier runs recorded an accepted marketplace transaction. The second run's UI failure does not establish a node rejection or a proving failure. Legacy service probes returning HTTP 410 do not explain it: Lace refreshed its service configuration dynamically and recognized the funding. The later complete marketplace success used SDK-assisted designation and does not resolve the cause of that own-registration failure.

A separate SDK-assisted funding path designates generation from the test sponsor's NIGHT to the fresh Lace wallet's public DUST address; NIGHT remains sponsor-owned. Its [first transaction was structurally invalid](lace-ci-designation-invalid-attempt.json): a second SDK signing call appended a duplicate signature to one NIGHT input. Strict local ledger validation identified the mismatch, and the public indexer showed no acceptance after the bounded confirmation wait. The helper now preserves the original signatures, verifies their counts and cryptography, and requires strict local validation before submitting. The [native regression](native-signature-regression.json) reproduces the append behavior using synthetic keys. This funding helper is separate from Lace's own registration UI and does not establish marketplace acceptance.

The corrected designation used to fund the successful Lace run [passed all five strict local validation flags](lace-ci-designation-preflight.json) against newer public block parameters before its single submission. The preflight waits for the indexed block time to reach the transaction's DUST creation time; it does not change timestamps or disable validation. The [public designation check](lace-ci-designation-verification.json) establishes SDK-assisted funding. Marketplace acceptance is established separately by the seven Lace transactions above.

### Earlier user-operated test

**A user-operated Edge / Lace 2.5.1 test produced an accepted public Preview task-creation transaction on 6 November 2026.** The user followed the published application's Lace connection and task-creation steps and supplied the transaction identifier. The [session record](lace-preview-session.json) records the user-reported environment separately from the [read-only transaction verification](lace-preview-transaction.json), completed at 18:28:58 UTC.

| Indexed result | Value |
| --- | --- |
| Transaction identifier | `008239371f3f4996cadc573d89272d4ce9e4f06041c90b3f44f26b2b54ebe7ec51` |
| Network status | Preview, `SucceedEntirely`, block **1,627,842** |
| Operation | One `createTask` call on the published ReviewLab contract |
| Contract proof | One serialized proof, **4,508 bytes** |
| Wallet/DUST proof | One serialized DUST-spend proof, **2,940 bytes** |

The verifier decoded the public transaction and checked its identifier, contract and operation; it did not access a wallet or submit anything. This earlier result establishes indexed acceptance and the presence of both proof types for one task creation. It does not independently verify their cryptography or chain inclusion; the complete independent Lace lifecycle is recorded above.

An additional historical before/after state query did not produce usable states, so no separate state-delta verification is claimed.

The instructed setup uses Lace's **Run in this app (WASM)** mode. The [source review](LACE-WASM.md) confirms that path in the released 2.5.0 snapshot; this user's reported version was 2.5.1. The extension UI and its network traffic were not directly observed by the verifier. API 4 also omits the prover URL for remote TEE mode, so the app's session confirmation and URL rejection are guardrails, not attestation. The transaction cannot prove where its proofs were generated. The earlier HTTP-prover reports below remain separate historical evidence.

At that earlier client-policy revision, 26 unit tests passed (15 contract and 11 network-boundary tests), full compilation regenerated all six circuit key sets, and the production build passed. Both updated Chromium suites passed eight cases each, as detailed below. The expanded suite is recorded separately below.

## Expanded automated checks — 6 November 2026

**A fresh complete public Preview lifecycle passed at 19:26:13 UTC with local WASM for both contract and wallet/DUST proving.** The [SDK WASM evidence](preview-wasm-evidence.json) records seven `SucceedEntirely` transactions: deployment, enrollment, task creation, review, approval, entitlement claim and closure. The official wallet SDK prover worker generated six contract proofs and seven DUST-spend proofs. No HTTP proving service was configured; only public parameter/key downloads used the official public asset host. This run used the dedicated encrypted SDK test wallet, not Lace.

| Action | Preview block |
| --- | --- |
| Deploy | 1,628,365 |
| Enroll expert | 1,628,372 |
| Create task | 1,628,380 |
| Submit review | 1,628,396 |
| Approve review | 1,628,403 |
| Claim entitlement | 1,628,411 |
| Close task | 1,628,419 |

Every accepted transaction contains a 2,940-byte serialized DUST proof; each of the six contract calls contains a 4,508-byte serialized contract proof. The [final public record](preview-wasm-record.json) contains one expert, one closed task, one review and one claimed entitlement. Six pre-submission rejection checks passed: injected prover failure, a fresh submission while the previous outcome was pending, duplicate review, wrong task owner, duplicate claim and wrong marketplace identity. The review test deliberately lost the response after one real submission, then recovered the exact indexed receipt without submitting again or fabricating a transaction reference. Acceptance is reported by the public Preview indexer, not independent consensus or cryptographic verification. No reward payment or sponsor service was involved.

The current suite passes **38 tests**: 27 generated-contract tests and 11 network-boundary tests. The additional contract cases exercise the full 1,024-entry Merkle registry, exact deadline/expiry boundaries, corrupted membership paths, cross-market replay, cross-task ownership, rollback after late failures and immutable receipt fields. Both browser suites also passed eight cases each with zero page errors.

The [browser-worker evidence](browser-worker-proof-evidence.json) records six genuine proofs produced by official ZKIR 2.1.1 inside a Chromium Web Worker. Each raw proof is 4,501 bytes. The largest circuit took about 40 seconds; the six-proof run took about 96 seconds. A main-thread heartbeat continued throughout (largest observed gap 33 ms). Duplicate review execution and deliberately wrong proving material were rejected. This harness uses synthetic private inputs generated inside the worker and only local static assets during browser execution; the preparatory download retrieves two hash-pinned public parameter files. It neither connects a wallet nor submits transactions.

The worker test uses single-thread WASM without SharedArrayBuffer or cross-origin isolation. Peak recorded WASM memory was about 621 MiB. These are measurements on the test machine, not a mobile-device performance guarantee or a measurement of Lace's complete memory usage.

The [encrypted-storage evidence](private-storage-evidence.json) records nine checks against the official encryption provider and real filesystem LevelDB. State and signing keys survived reopen and password rotation; incorrect-password reads and failed rotation preserved the ciphertext; account, network-qualified account and contract namespaces were isolated; synthetic plaintext markers were absent from the database records/files. This does not establish browser IndexedDB crash recovery.

**Storage limitation:** the upstream provider's direct `set()` call encrypts with the supplied password but does not first authenticate that password against an existing entry. The disposable negative test confirmed that it can overwrite that entry under another valid password. The report does not label direct writes as authenticated. ReviewLab reads existing state when joining; encryption alone must not be used as write authorization. Pending review recovery and feedback openings remain session-local unless explicitly saved; reload recovery is not established by these tests.

## Recorded native results — 6 November 2026

Full compilation with Compact 0.31.1 generated all six circuit key sets. The 15 generated-runtime tests passed. A fresh proof-server 8.1.3 run then generated actual proofs for all six circuits after the task-content commitment was added to the receipt. Both documented negative checks passed. The run completed at 15:57:47 CET (14:57:47 UTC).

The [sanitized proof report](proof-evidence.json) records these exact source fingerprints:

| Artifact | SHA256 |
| --- | --- |
| Compact source | `b027c55cbe0266879acc753d96674b457799fbf810171568dcfae4195e14cad1` |
| Generated bindings | `db34e6d150d1c8350d9c3d9818536fd6e6ea922bb9ed69ef53a3dd7e556fd1c8` |

Each generated proof was 4,508 bytes. The report contains proof hashes and timing, not private witness data. That standalone proof run did not attempt network submission or network acceptance, and an independent proof verifier was not run. Browser, network and website deployment results are tracked separately by their acceptance checks and GitHub workflow runs.

## Browser checks — 6 November 2026

The [browser-lab evidence](browser-evidence.json) records eight passing acceptance scenarios in Chromium 156.0.8078.4: the two-choice landing page, Midnight palette and local fonts; native WASM loading and filtering; credential/review/approval/claim flow; duplicate rejection and private-data exclusion; receipt/report imports and tampering checks; campaign creation and closure; DUST calculation validation; and all six lab screens at 390px width. The landing page also passed 320px and 390px layout checks. The run completed at 18:02:15 UTC with zero browser errors and zero automatic third-party requests, using the production bundle beneath the GitHub Pages project path on a local HTTP server.

The separate [network-browser boundary evidence](network-browser-evidence.json) records eight passing cases against the real SDK bundle, completed at 18:02:12 UTC. It loaded both native WASM assets and checked all 18 compiled proving assets, Preview/local configuration, private key handling, strict imports, credential expiry, wallet-denial handling and all four network screens at 390px. New checks require a session-only internal-mode confirmation and reject even a localhost prover URL before provider creation. There were no runtime errors or remote requests. Both API-4 fixtures are negative-only: one denies wallet access and the other fails the external-prover gate. Neither fixture fabricates successful connection, proof generation or submission, and this suite establishes no network acceptance. It also guards the page's hash-navigation connection regression.

The [support-section checks](support-evidence.json) confirm that the Cardano mainnet support address matches BallotLab, the displayed QR decodes to that exact address, copying works, denied clipboard access offers selected text, and the section fits 320px and 390px widths. No browser errors or automatic third-party requests were recorded. These optional tips are separate from the testnet wallet and marketplace reward accounting.

## Accepted isolated-network transactions — 6 November 2026

The [SDK network evidence](network-evidence.json) records seven transactions accepted with `SucceedEntirely` on a dedicated `undeployed` chain: deployment, expert enrollment, task creation, review submission, approval, entitlement claim and task closure. Six proved contract-call transactions completed. The configured local indexer reported a final state of one credential, one task, one review, one claim and a closed task. The run completed at 16:30:08 CET (15:30:08 UTC).

Five checks rejected calls before submission: an intentionally unavailable prover, a duplicate review, the wrong task owner, a duplicate claim and a mismatched marketplace identity. The runner also deliberately lost the response after a real review submission, then recovered its exact committed receipt from indexed state without resubmission or a fabricated transaction reference. The immutable receipt still carries its submission-time status; the separate indexed check reports the current `claimed` status.

The wallet was a temporary synthetic genesis fixture funded on this isolated chain. Its generated test DUST paid the fees. This was not the user's wallet, a faucet request or public Preview funding. The test used node 1.0.400, indexer 4.3.5 and proof-server 8.1.3; the report records the separately locked wallet dependency graph. No payment or sponsor service ran.

The report retains exact source, generated-binding, runner and lockfile hashes for that tested revision. A later configuration-only fix permits the page's navigation fragment while continuing to reject fragments in service URLs; the configuration hash in this earlier SDK report therefore does not identify that later browser fix. The historical browser boundary checks and funded browser run cover that fix, but not the subsequent Lace-mode policy change. Indexer confirmation is not independent consensus or chain-inclusion verification.

## Funded browser workflow — 6 November 2026

The [funded browser evidence](browser-network-evidence.json) records a second complete seven-transaction lifecycle, driven through the built `network.html` page in Chromium on the isolated `undeployed` chain. All seven transactions reached `SucceedEntirely`, at blocks 84, 89, 94, 104, 109, 114 and 119. The real browser fetched all 18 generated circuit assets, made six proof and six proof-check requests and balanced seven transactions. There were zero page runtime errors. The final indexed state contains one enrolled credential, one task, one review, one claimed entitlement and a closed task.

This test uses the official `DAppConnectorWalletAdapter` from the Midnight testkit with a funded local genesis wallet. The adapter's proving provider executes the genuine ZKIR implementation in the local Node test process using the browser-supplied keys and circuit material. The wallet SDK balances and submits real transactions. No fake proof or success response substitutes for network acceptance. This tests the application's API-4/browser path, not the Lace extension itself; the separate SDK run above covers HTTP proof-server calls. The browser run completed at 17:53:50 CET (16:53:50 UTC).

The report hashes the exact built HTML, JavaScript and CSS, contract and SDK/provider/configuration sources. A subsequent HTML change points the setup-guide link to its rendered GitHub page; it does not change the transaction implementation. Fresh GitHub workflow runs identify the exact release revision they test. Neither isolated-network run establishes public Preview acceptance or independent chain-inclusion verification.

## Public Preview status

**The complete public Preview lifecycle passed on 6 November 2026 using the Node wallet SDK and a local HTTP prover.** The [sanitized public evidence](public-preview-evidence.json) records eight accepted transactions: DUST registration plus seven marketplace operations, including six proved contract calls. The run completed at 17:46:37 UTC. The final task is closed and the exact review receipt is `claimed`. This historical result is separate from the new browser/Lace internal-WASM workflow.

A dedicated Preview test wallet received 5,000 test NIGHT (5,000,000,000 STAR) from the public faucet. The [funding evidence](public-preview-funding.json) records `SUCCESS` at block 1,626,924, the transaction identifiers and the output to this wallet. It omits unrelated faucet change outputs. This is a randomly generated test wallet, separate from the isolated genesis wallets and the optional Cardano mainnet support address. Its private seed and wallet snapshots are protected locally with Windows DPAPI.

The public Preview indexer confirmed all eight transactions with `SucceedEntirely`:

| Action | Block |
| --- | --- |
| Register test NIGHT for DUST generation | 1,627,059 |
| Deploy the ReviewLab marketplace | 1,627,092 |
| Enroll the demonstration expert | 1,627,096 |
| Create the AI evaluation task | 1,627,407 |
| Submit the private review | 1,627,411 |
| Approve the review | 1,627,415 |
| Claim the entitlement | 1,627,419 |
| Close the task | 1,627,423 |

A separate [read-only contract-state check](public-preview-state.json) at 17:47:53 UTC verified the marketplace and issuer commitments and found one enrolled credential, one task, one review and one claim. It used the public indexer and generated contract decoder without submitting a transaction. The [public record](public-preview-record.json) retains the claimed receipt and closed task. The [join file](public-preview-marketplace.json) includes the public task text and its committed digest; follow the [inspection instructions](TESTNET.md#inspect-the-recorded-public-deployment) to join the deployed marketplace.

The original create-task attempt lost its submission response and was not found in repeated indexer checks. A same-ID replacement also lacked confirmation; retrying its exact saved bytes returned RPC code `1012` (a temporary transaction ban). [Strict local replay](public-preview-local-diagnostic.json) then identified the saved replacement as `NotNormalized` (117): its computed fee was zero and the wallet had added an empty fee section. This matches [upstream wallet issue 700](https://github.com/midnightntwrk/midnight-wallet/issues/700). The public RPC's remote dry-run was unavailable, so that diagnosis is a local validation result, distinct from the public retry's `1012` response.

The runner now uses the supported wallet setting `additionalFeeOverhead: 1000n` SPECK, which produces a real DUST spend even when the calculated fee rounds to zero. It rebuilt the same planned task only after absence and validity checks; the contract rejects duplicate task IDs. The corrected task and all remaining operations passed strict local preflight and public acceptance. The evidence preserves both earlier attempts and the correction. Contract and SDK sources were unchanged; the recorded runner hashes identify the recovery revisions. The proof-provider completion counter includes deployment and unsuccessful attempts, so it is not a count of accepted circuit proofs. Actual proving used the local HTTP proof-server 8.1.3.

The [published-browser check](public-preview-browser-evidence.json) connected to the production `network.html` page, joined this public Preview contract, read the claimed receipt and closed task, and checked the public export. It completed at 17:46:54 UTC with zero page errors and zero proof, balancing or submission requests. It used the official testkit `DAppConnectorWalletAdapter` with the dedicated wallet, not the Lace extension. The earlier isolated-network browser run separately verifies the browser's full proving/submission flow.

The [export privacy check](public-preview-privacy-check.json) found none of the exact private seed, role secrets, password, credential, feedback or opening values in the five public SDK/browser artifacts. Published evidence excludes private-store pointers and serialized transactions. Configured-indexer confirmation and local ledger replay are not independent chain-inclusion verification. No reward payment or sponsor service ran. The current public-client setup uses [Lace internal WASM](TESTNET.md), rather than the HTTP prover used for this historical run.

## Repeat the checks

| Command | Evidence produced |
| --- | --- |
| `npm run compile` | Official Compact 0.31.1 compilation and proof-key generation for the six state-changing circuits. |
| `npm test` | Real generated-contract execution, successful workflows and rejected invalid calls. |
| `npm run build` | Browser bundle containing generated Compact code and official Midnight WebAssembly. |
| `npm run test:browser` | Chromium acceptance checks against the actual browser application. |
| `npm run test:network-browser` | Real network bundle, asset, import, privacy, mobile and rejecting-wallet checks; no successful transaction. |
| `npm run test:proofs` | Actual proofs produced by a local proof-server 8.1.3, plus the specified negative checks. |
| `npm run test:devnet` | Actual proved transactions, configured-indexer acceptance and uncertain-submission recovery on the isolated local chain. |
| `npm run test:devnet:browser` | Built network page through the official API-4 testkit adapter, real proving and transactions on the isolated chain. |

The recorded pre-WASM-policy unit run passed all 24 tests: 15 generated-contract tests and nine network-boundary tests. The contract tests cover issuer authorization, membership and credential attributes, marketplace isolation, duplicate review prevention, capacity, deadline and closure rules, campaign ownership, author-only reward claims, receipt commitments, public exports and unsafe input rejection. Network checks cover configuration, prover destination, wallet discovery, credential commitments, session/network identity and safe errors. Consult the workflow for the exact revision and counts after later client changes.

## Local proof evidence

The proof runner writes `artifacts/proof-evidence.json` with the exact Compact-source and generated-binding SHA256 hashes, circuit names, proof sizes, proof hashes, timing and result. It does not retain private witnesses or serialized preimages. Proof requests are restricted to a loopback prover, and the runner checks the server version before sending them.

The six circuits are `enroll`, `createTask`, `submitReview`, `approveReview`, `claimReward` and `closeTask`. The negative checks reject a duplicate review before proving and a review preimage supplied to the wrong circuit at the proof server.

Source changes invalidate a previous run as evidence for the changed source. Rerun the proof checks after modifying the contract or generated bindings; compare the report's hashes before citing it. A proof-generation result is not an independent proof-verifier result.

## GitHub evidence

[Pages workflow runs](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/pages.yml) identify the exact revision tested and deployed, including both browser suites. The separate [proof workflow](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/proofs.yml) and [isolated-network workflow](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/devnet.yml) run only when dispatched and establish only the checks their completed runs report. A workflow definition or pending run is not execution evidence.

The two-demo release at revision `e801196918e1ad8306ebc3b01467a7d28689f05d` passed compilation, contract tests, both browser suites and GitHub Pages publication in [run 42257455932](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42257455932). This identifies the published frontend and its checks; it is separate from public Preview contract execution.

The same revision also passed the separate [isolated-network CI run 42257495410](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42257495410), including both the SDK lifecycle and funded Chromium/API-4 workflow against actual node, indexer and prover services on the Linux runner. Its retained reports are scoped to that disposable `undeployed` chain.

The optional-support release at revision `edcdd8d38f949f0535f98ec464341459225c4236` subsequently passed compilation, unit tests, both browser suites and Pages deployment in [run 42261190359](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42261190359).

The Lace internal-mode client and public transaction verifier at revision `d54970f5169b105edfd733052bfb68c8dbc00c5e` passed the build/test workflow and successfully deployed on the latest retry of [run 42268335926](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42268335926). This is the published frontend used for the user-operated test described above.

The browser lab executes the contract locally. The separate testnet client connects to a real wallet/provider transaction path and requires the setup in [TESTNET.md](TESTNET.md). Neither mode establishes independently vetted professional qualifications or transfers reviewer rewards. Sponsorship remains a proposed service; the testnet wallet pays its own DUST fees. Website deployment, installed SDK support and standalone proof checks do not imply accepted public-network transactions.
