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

The [support-section checks](support-evidence.json) confirm that the Cardano mainnet support address matches BallotLab, the displayed QR decodes to that exact address, copying works, denied clipboard access offers selected text, and the section fits 320px and 390px widths. No browser errors or automatic third-party requests were recorded. These optional tips are separate from the testnet wallet and marketplace reward accounting.

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

**The complete public Preview lifecycle passed on 6 November 2026.** The [sanitized public evidence](public-preview-evidence.json) records eight accepted transactions: DUST registration plus seven marketplace operations, including six proved contract calls. The run completed at 17:46:37 UTC. The final task is closed and the exact review receipt is `claimed`.

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

The [export privacy check](public-preview-privacy-check.json) found none of the exact private seed, role secrets, password, credential, feedback or opening values in the five public SDK/browser artifacts. Published evidence excludes private-store pointers and serialized transactions. Configured-indexer confirmation and local ledger replay are not independent chain-inclusion verification. No reward payment or sponsor service ran. Public use requires the wallet and local prover setup in [TESTNET.md](TESTNET.md).

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

The two-demo release at revision `e801196918e1ad8306ebc3b01467a7d28689f05d` passed compilation, contract tests, both browser suites and GitHub Pages publication in [run 42257455932](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42257455932). This identifies the published frontend and its checks; it is separate from public Preview contract execution.

The same revision also passed the separate [isolated-network CI run 42257495410](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42257495410), including both the SDK lifecycle and funded Chromium/API-4 workflow against actual node, indexer and prover services on the Linux runner. Its retained reports are scoped to that disposable `undeployed` chain.

The optional-support release at revision `edcdd8d38f949f0535f98ec464341459225c4236` subsequently passed compilation, unit tests, both browser suites and Pages deployment in [run 42261190359](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/42261190359).

The browser lab executes the contract locally. The separate testnet client connects to a real wallet/provider transaction path and requires the setup in [TESTNET.md](TESTNET.md). Neither mode establishes independently vetted professional qualifications or transfers reviewer rewards. Sponsorship remains a proposed service; the testnet wallet pays its own DUST fees. Website deployment, installed SDK support and standalone proof checks do not imply accepted public-network transactions.
