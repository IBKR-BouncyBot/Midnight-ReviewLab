# Architecture

ReviewLab separates the evaluation workflow from the rules that make a review acceptable.

## Roles

| Role | Responsibility |
| --- | --- |
| AI team | Publishes a task, defines expertise and the rubric, inspects feedback and approves reward eligibility. |
| Credential issuer | Admits an expert to the accepted credential registry after checking qualifications outside the contract. |
| Expert | Keeps a credential secret, evaluates an answer and submits a review tied to a task. |
| Sponsor | Pays transaction fees using DUST without obtaining the expert's authorization secret. |

The browser lab puts the issuer, task owner and expert in one browser. That makes their complete journey explorable, but it does not establish independence between parties. Sponsorship is a design scenario, not an implemented payer. The separate testnet client connects the same contract logic to real wallet authorization, proving and network submission.

## Two entry points

`index.html` is a two-choice landing page. `browser.html` opens the local lab; `network.html` opens the testnet client. Navigation between them does not turn local records into network state.

The network client uses Midnight.js 4.1.1 providers and DApp Connector API 4. It defaults to Preview and blocks mainnet. The connected wallet pays its own DUST fees. Its account, selected network and reported loopback prover configuration are checked again before proving, balancing and submitting.

## Native execution

The Compact source encodes the acceptance rules. The official compiler generates the JavaScript contract implementation, circuit artifacts and proof keys. A local adapter supplies private witnesses and executes that generated implementation using the Midnight runtime.

A credential binds a secret to expertise and expiry information. An issuer-authenticated Merkle registry authenticates eligibility. The contract requires a credential to remain valid through the task deadline. A review receipt binds the marketplace, task identifier, task content digest, salted feedback commitment, nullifier and all three scores. A marketplace-and-task-specific nullifier prevents the same credential from submitting twice to that task. Authorization is separate from the party that would pay network fees.

Campaign owners approve reviews. The author can then record a claim once. This claim records entitlement only: the contract does not escrow or transfer reward funds.

Approval status changes after submission and is not part of the immutable receipt digest. A supplied record's current status is reported separately; it is unauthenticated local-record state unless additional network evidence is verified.

The browser must present its evidence accurately:

| Stage | What it establishes |
| --- | --- |
| Local generated-contract execution | The local call satisfies the encoded constraints against the supplied local state. |
| Zero-knowledge proof generation | A real prover generated a proof for the circuit and its inputs. |
| Network acceptance | A transaction was accepted by the identified network and contract. |
| Public record check | The supplied record and receipt satisfy the checks actually implemented; a self-consistent file is not automatically an authentic chain record. |

None of these alone proves that the expert is honest, that the credential issuer vetted them correctly, or that an AI answer is accurate.

## Storage and exports

Public application records may be stored in browser storage for convenience. Private credential material belongs in memory or an explicit private download. Users must keep private credential files separate from shareable receipts.

The network client's SDK creates a scoped witness-input object for each call and releases it afterward. The page still retains role-key fields, the loaded expert credential and feedback openings in session memory so the user can continue the workflow or recover an uncertain submission. Disconnecting clears those application inputs; explicit private downloads remain the user's responsibility. Witnesses leave the contract's persisted private state empty. The SDK's encrypted browser store may retain maintenance/signing keys; its password is separate from a wallet password. Connecting the same wallet in another browser does not automatically restore application role keys.

GitHub Pages serves static files and compiled public proof material. It does not provide a shared task database, receive confidential feedback, run a sponsor wallet or host a prover. Network participants can join the same deployed contract and manually exchange a public marketplace JSON file containing the task's prompt and AI answer; the page checks their content commitment. Written feedback stays in the submitting tab and can be downloaded with its private opening. Automatic confidential feedback delivery to the buyer needs a separate storage and access layer.

## Production components

1. An independent credential issuer with revocation and expiry handling.
2. An authenticated Midnight contract deployment and providers for the intended network.
3. A task API and access-controlled feedback storage; sensitive text should not be placed on a public ledger.
4. A sponsor wallet service with acceptance rules, rate limits, monitoring and sufficient generated DUST.
5. A payment integration that settles approved rewards and records independent transfer evidence.
6. A recovery strategy for private credentials, and a security review of identity leakage, access control and source authenticity.

The AI in this product is the subject of expert evaluation. The prototype does not need to call a model API to demonstrate the review market. A future model integration must make its data destination and credentials explicit.
