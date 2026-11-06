# Verification

ReviewLab reports four different milestones separately: generated-contract execution, real circuit proof generation, blockchain acceptance and website deployment. Passing one does not imply the others.

## Recorded native results — 6 November 2026

Full compilation with Compact 0.31.1 generated all six circuit key sets. The 15 generated-runtime tests passed. A fresh proof-server 8.1.3 run then generated actual proofs for all six circuits after the task-content commitment was added to the receipt. Both documented negative checks passed. The run completed at 15:57:47 CET (14:57:47 UTC).

The [sanitized proof report](proof-evidence.json) records these exact source fingerprints:

| Artifact | SHA256 |
| --- | --- |
| Compact source | `b027c55cbe0266879acc753d96674b457799fbf810171568dcfae4195e14cad1` |
| Generated bindings | `db34e6d150d1c8350d9c3d9818536fd6e6ea922bb9ed69ef53a3dd7e556fd1c8` |

Each generated proof was 4,508 bytes. The report contains proof hashes and timing, not private witness data. That standalone proof run did not attempt network submission or network acceptance, and an independent proof verifier was not run. Browser, network and website deployment results are tracked separately by their acceptance checks and GitHub workflow runs.

## Browser checks — 6 November 2026

The [browser-lab evidence](browser-evidence.json) records eight passing acceptance scenarios in Chromium 156.0.8078.4: the two-choice landing page, Midnight palette and local fonts; native WASM loading and filtering; credential/review/approval/claim flow; duplicate rejection and private-data exclusion; receipt/report imports and tampering checks; campaign creation and closure; DUST calculation validation; and all six lab screens at 390px width. The landing page also passed 320px and 390px layout checks. The run recorded zero browser errors and zero automatic third-party requests, using the production bundle beneath the GitHub Pages project path on a local HTTP server.

The separate [network-browser boundary evidence](network-browser-evidence.json) records seven passing cases against the real SDK bundle. It loaded both native WASM assets and checked all 18 compiled proving assets, Preview/local configuration, private key handling, strict imports, credential expiry, wallet-denial handling and all four network screens at 390px. There were no runtime errors or remote requests. Its API-4 fixture always rejects: this suite establishes neither a successful wallet connection nor a proof or transaction. It also guards the page's hash-navigation connection regression.

## Accepted isolated-network transactions — 6 November 2026

The [SDK network evidence](network-evidence.json) records seven transactions accepted with `SucceedEntirely` on a dedicated `undeployed` chain: deployment, expert enrollment, task creation, review submission, approval, entitlement claim and task closure. Six proved contract-call transactions completed. The configured local indexer reported a final state of one credential, one task, one review, one claim and a closed task. The run completed at 16:30:08 CET (15:30:08 UTC).

Five checks rejected calls before submission: an intentionally unavailable prover, a duplicate review, the wrong task owner, a duplicate claim and a mismatched marketplace identity. The runner also deliberately lost the response after a real review submission, then recovered its exact committed receipt from indexed state without resubmission or a fabricated transaction reference. The immutable receipt still carries its submission-time status; the separate indexed check reports the current `claimed` status.

The wallet was a temporary synthetic genesis fixture funded on this isolated chain. Its generated test DUST paid the fees. This was not the user's wallet, a faucet request or public Preview funding. The test used node 1.0.400, indexer 4.3.5 and proof-server 8.1.3; the report records the separately locked wallet dependency graph. No payment or sponsor service ran.

The report retains exact source, generated-binding, runner and lockfile hashes. Its SDK source hash matches the tested client. A later configuration-only fix permits the page's navigation fragment while continuing to reject fragments in service URLs; the configuration hash in this earlier SDK report therefore does not identify that later browser fix. The browser boundary checks and funded browser run cover the fix. Indexer confirmation is not independent consensus or chain-inclusion verification.

## Funded browser workflow — 6 November 2026

The [funded browser evidence](browser-network-evidence.json) records a second complete seven-transaction lifecycle, driven through the built `network.html` page in Chromium on the isolated `undeployed` chain. All seven transactions reached `SucceedEntirely`, at blocks 84, 89, 94, 104, 109, 114 and 119. The real browser fetched all 18 generated circuit assets, made six proof and six proof-check requests and balanced seven transactions. There were zero page runtime errors. The final indexed state contains one enrolled credential, one task, one review, one claimed entitlement and a closed task.

This test uses the official `DAppConnectorWalletAdapter` from the Midnight testkit with a funded local genesis wallet. The adapter's proving provider executes the genuine ZKIR implementation in the local Node test process using the browser-supplied keys and circuit material. The wallet SDK balances and submits real transactions. No fake proof or success response substitutes for network acceptance. This tests the application's API-4/browser path, not the Lace extension itself; the separate SDK run above covers HTTP proof-server calls. The browser run completed at 17:53:50 CET (16:53:50 UTC).

The report hashes the exact built HTML, JavaScript and CSS, contract and SDK/provider/configuration sources. A subsequent HTML change points the setup-guide link to its rendered GitHub page; it does not change the transaction implementation. Fresh GitHub workflow runs identify the exact release revision they test. Neither isolated-network run establishes public Preview acceptance or independent chain-inclusion verification.

## Public Preview status

The testnet page defaults to public Preview and implements the real wallet/prover/transaction path. A manual read-only page check received the expected Preview node identity and indexer block 1,626,008. That connectivity observation is not a wallet, proof or transaction test. The reports above do not establish public faucet funding, a public Preview transaction or a Lace extension transaction. Public use requires the wallet, test NIGHT/DUST and local prover setup in [TESTNET.md](TESTNET.md).

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

The current unit suite passes all 24 tests: 15 generated-contract tests and nine network-boundary tests. The contract tests cover issuer authorization, membership and credential attributes, marketplace isolation, duplicate review prevention, capacity, deadline and closure rules, campaign ownership, author-only reward claims, receipt commitments, public exports and unsafe input rejection. Network checks cover configuration, prover destination, wallet discovery, credential commitments, session/network identity and safe errors.

## Local proof evidence

The proof runner writes `artifacts/proof-evidence.json` with the exact Compact-source and generated-binding SHA256 hashes, circuit names, proof sizes, proof hashes, timing and result. It does not retain private witnesses or serialized preimages. Proof requests are restricted to a loopback prover, and the runner checks the server version before sending them.

The six circuits are `enroll`, `createTask`, `submitReview`, `approveReview`, `claimReward` and `closeTask`. The negative checks reject a duplicate review before proving and a review preimage supplied to the wrong circuit at the proof server.

Source changes invalidate a previous run as evidence for the changed source. Rerun the proof checks after modifying the contract or generated bindings; compare the report's hashes before citing it. A proof-generation result is not an independent proof-verifier result.

## GitHub evidence

[Pages workflow runs](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/pages.yml) identify the exact revision tested and deployed, including both browser suites. The separate [proof workflow](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/proofs.yml) and [isolated-network workflow](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/devnet.yml) run only when dispatched and establish only the checks their completed runs report. A workflow definition or pending run is not execution evidence.

The browser lab executes the contract locally. The separate testnet client connects to a real wallet/provider transaction path and requires the setup in [TESTNET.md](TESTNET.md). Neither mode establishes independently vetted professional qualifications or transfers reviewer rewards. Sponsorship remains a proposed service; the testnet wallet pays its own DUST fees. Website deployment, installed SDK support and standalone proof checks do not imply accepted public-network transactions.
