# Verification

ReviewLab reports four different milestones separately: generated-contract execution, real circuit proof generation, blockchain acceptance and website deployment. Passing one does not imply the others.

## Recorded native results — 6 November 2026

Full compilation with Compact 0.31.1 generated all six circuit key sets. The 15 generated-runtime tests passed. A fresh proof-server 8.1.3 run then generated actual proofs for all six circuits after the task-content commitment was added to the receipt. Both documented negative checks passed. The run completed at 15:57:47 CET (14:57:47 UTC).

The [sanitized proof report](proof-evidence.json) records these exact source fingerprints:

| Artifact | SHA256 |
| --- | --- |
| Compact source | `b027c55cbe0266879acc753d96674b457799fbf810171568dcfae4195e14cad1` |
| Generated bindings | `db34e6d150d1c8350d9c3d9818536fd6e6ea922bb9ed69ef53a3dd7e556fd1c8` |

Each generated proof was 4,508 bytes. The report contains proof hashes and timing, not private witness data. No network submission or network acceptance was attempted, and an independent proof verifier was not run. Browser and website deployment results are tracked separately by their acceptance checks and GitHub workflow runs.

## Repeat the local checks

The [browser evidence](browser-evidence.json) records seven passing acceptance scenarios in Chromium 156.0.8078.4 on 6 November 2026: native WASM loading and filtering; credential/review/approval/claim flow; duplicate rejection and private-data exclusion; receipt/report imports and tampering checks; campaign creation and closure; DUST calculation validation; and all six screens at 390px width. The run recorded zero browser errors and zero automatic third-party requests. It used the actual production bundle beneath the GitHub Pages project path on a local HTTP server.

| Command | Evidence produced |
| --- | --- |
| `npm run compile` | Official Compact 0.31.1 compilation and proof-key generation for the six state-changing circuits. |
| `npm test` | Real generated-contract execution, successful workflows and rejected invalid calls. |
| `npm run build` | Browser bundle containing generated Compact code and official Midnight WebAssembly. |
| `npm run test:browser` | Chromium acceptance checks against the actual browser application. |
| `npm run test:proofs` | Actual proofs produced by a local proof-server 8.1.3, plus the specified negative checks. |

The native contract tests cover issuer authorization, membership and credential attributes, marketplace isolation, duplicate review prevention, capacity, deadline and closure rules, campaign ownership, author-only reward claims, receipt commitments, public exports and unsafe input rejection.

## Local proof evidence

The proof runner writes `artifacts/proof-evidence.json` with the exact Compact-source and generated-binding SHA256 hashes, circuit names, proof sizes, proof hashes, timing and result. It does not retain private witnesses or serialized preimages. Proof requests are restricted to a loopback prover, and the runner checks the server version before sending them.

The six circuits are `enroll`, `createTask`, `submitReview`, `approveReview`, `claimReward` and `closeTask`. The negative checks reject a duplicate review before proving and a review preimage supplied to the wrong circuit at the proof server.

Source changes invalidate a previous run as evidence for the changed source. Rerun the proof checks after modifying the contract or generated bindings; compare the report's hashes before citing it. A proof-generation result is not an independent proof-verifier result.

## GitHub evidence

[Pages workflow runs](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/pages.yml) identify the exact revision tested and deployed. The separate [proof workflow](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab/actions/workflows/proofs.yml) runs only when dispatched and establishes only the checks its completed run reports.

The public website executes the contract locally. It does not submit a Midnight transaction, prove an independently vetted professional qualification, operate a real sponsor wallet or transfer a reviewer's reward. No public-network acceptance is implied by the website or the standalone proof checks.
