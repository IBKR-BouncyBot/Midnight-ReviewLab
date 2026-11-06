# Privacy and trust boundaries

ReviewLab is an experimental marketplace application, not a professional accreditation authority or a production payment service.

## What a credential check means

A valid credential proves that the caller can satisfy the contract's accepted registry and expertise rules. The registry is only as trustworthy as its issuer. In the demonstration, anyone controlling the browser can issue demonstration credentials; those credentials must never be described as verified professional qualifications.

Credential secrets must not appear in public state, receipts, browser local storage, logs or uploaded build artifacts. An explicitly downloaded private credential file is sensitive and should be protected by its owner. Exporting a receipt must not export that file or a mapping from an expert's private identity to a review.

The Merkle registry is issuer-authenticated. Credentials must remain valid through the task's deadline. Marketplace-and-task-specific nullifiers prevent repeated use of a credential for that task. They do not prove that two credentials belong to different people. Sybil resistance requires issuer policies outside the circuit.

## Review contents

An expert can reveal their identity in the feedback they write. Cryptographic credential privacy cannot remove identifying details from free text. Sample prompts and AI answers are educational evaluation material; they are not financial, medical or legal advice.

Local public records are readable by scripts on the same origin and by users of the same browser profile. The static application has no shared private database. Do not use the research prototype for confidential customer submissions without an appropriately secured backend.

The testnet client's SDK uses encrypted browser storage for maintenance/signing keys and empty contract private state. Its per-call witness-input object is released afterward, but the page keeps role-key fields, the loaded credential and feedback openings in session memory until they are cleared or the session ends. Disconnecting clears the application's private inputs; it does not erase downloaded files or the encrypted SDK store. This does not make the browser, its extensions or the user's machine a trusted enclave. Explicitly downloaded private role-key files must be protected separately.

## Honest evidence

Executing generated Compact code locally is not the same as generating a zero-knowledge proof. Generating proof keys is not proof generation either. A proof is not a network confirmation, and deploying the website is not deploying the contract.

A downloaded record that agrees with itself can still be fabricated. Receipts bind the task content digest and the scored feedback commitment; these checks detect mismatched supplied content but do not establish the source's authenticity. Mutable approval status is not part of the immutable receipt digest. Independent chain authenticity requires verifying the network, contract, state and transaction evidence. Browser clocks are not authoritative network time. Demonstration state must not be represented as current public-chain state.

## Rewards and sponsorship

An owner approval and an author-only claim record track eligibility; the author can claim that recorded entitlement only once. The contract has no reward escrow or payment transfer. A record is not a transfer of money unless an actual settlement integration has completed and supplied transfer evidence. Keep rewards separate from DUST, which is only a transaction-fee resource.

A sponsor service must authenticate and limit requests before paying fees, and accept transactions only after the user has bound their intended action. The fee payer must not become the action's author. Wallet secrets belong in a protected service, never in a static bundle or repository. The current testnet client uses wallet-paid fees; it does not implement this sponsor service.

## Testnet operations

Mainnet is blocked. The wallet and page must agree on an explicit test network. Public use requires Lace's internal WASM setting and a session confirmation; the app rejects reported prover URLs, including localhost, before proof, balance and submission requests. This covers the intended contract and wallet/DUST proving path, but API 4 cannot attest the selected mode: Lace also omits the URL for its remote TEE mode. Verify the setting inside Lace; the page cannot control the extension's network traffic. See [Lace proving boundaries](LACE-WASM.md). The isolated developer harness retains its separate local prover.

Wallet approval is required for each transaction; a rejected or uncertain operation must not be reported as accepted. Confirmation from the configured indexer is not independent consensus verification.

Test-network credential enrollment is still demonstration issuance unless a trusted organization has actually vetted the expert. A real transaction does not establish real-world qualifications, review quality or payment settlement.

## Imports and deployment

Treat every imported credential or record as untrusted. Enforce schema, size and numeric bounds and perform the relevant native cryptographic checks. Render imported text as text, never as HTML.

The project uses a pinned compiler and a committed dependency lockfile. These make builds reproducible; they are not a substitute for review or audits. A production deployment additionally requires credential governance, revocation, recovery, server controls, payment safeguards and network-specific testing.
