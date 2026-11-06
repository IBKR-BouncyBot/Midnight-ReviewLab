# Testnet setup

The [ReviewLab testnet client](https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html) uses the real Midnight.js transaction path. It is separate from the [browser lab](https://ibkr-bouncybot.github.io/Midnight-ReviewLab/browser.html), which executes the contract locally without a wallet or network submission.

The default network is public **Preview**. Mainnet is disabled. Test NIGHT and test DUST have no monetary value. The wallet pays its own DUST fees in this version; a fee-sponsorship service is not implemented.

## Before opening a transaction

| Requirement | ReviewLab integration |
| --- | --- |
| Wallet | A Midnight wallet implementing DApp Connector API 4.x, such as Lace. A Cardano-only wallet connection is insufficient. |
| Network | The same explicit test network in the page and the wallet. Preview is the default. |
| Funds | Test NIGHT registered for DUST generation, with enough usable DUST for the intended transactions. |
| Prover | Local proof-server 8.1.3. The wallet must report a loopback prover address through its API. |
| Runtime | Compact 0.31.1, compact-runtime 0.16.0 and Midnight.js 4.1.1, included in the built application. |
| Browser storage | Site storage enabled for the encrypted SDK signing-key store; retain separate private role-key downloads when the application offers them. |

These versions follow the project's pinned ledger-8 integration. The [official browser guide](https://docs.midnight.network/guides/browser-dapp) explains the wallet/provider relationship.

## 1. Set up Preview in your wallet

Open the application in the same browser where your Midnight wallet is installed and unlock that wallet. Enable its Midnight account and select **Preview** in its test-network settings. Selecting a network on the application page does not switch the wallet's network.

Copy the wallet's unshielded Preview address, open the [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/), and complete its request and CAPTCHA yourself. After test NIGHT arrives, use the wallet's **Generate tDUST** action to register it. Wait until its DUST balance is usable. Receiving NIGHT alone does not start generation. See the [official funding guide](https://docs.midnight.network/guides/acquire-tokens).

Keep your wallet recovery phrase out of this application. ReviewLab connects through the extension; it does not need the phrase.

## 2. Run the local prover

Install Docker and start the official proof-server 8.1.3 image. This one-line command pins the reviewed image, binds it to loopback and disables container logging:

```sh
docker run --detach --rm --name reviewlab-proof-server --publish 127.0.0.1:6300:6300 --log-driver none midnightntwrk/proof-server@sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c
```

The image's default startup command is sufficient; do not append a network argument. If port 6300 is already occupied by the correct prover version, reuse that service instead of starting another container. The server may fetch public proving parameters during startup. Confirm readiness at `http://127.0.0.1:6300/ready`; the response should report `status: ok`. Its `/version` endpoint should report `8.1.3`.

In the wallet's Midnight proof-server settings, choose `http://localhost:6300`, save and confirm the change. Keep the prover running while creating proofs. Private witness data reaches this service, so use the local service you control. The [official proof-server guide](https://docs.midnight.network/guides/run-proof-server) explains the privacy boundary.

To stop only the container started by the command above:

```sh
docker stop reviewlab-proof-server
```

## 3. Connect deliberately

Open the testnet client, leave **Preview** selected and refresh the wallet list if necessary. Select a compatible wallet and enter a password for this application's encrypted local key storage. This is separate from your wallet password and recovery phrase. The installed SDK requires at least 16 characters drawn from three of uppercase, lowercase, numbers and symbols, and rejects simple sequences and repeated characters.

Connect and approve the wallet's connection request. The application checks that the account, network and local prover configuration agree. A successful connection is not a submitted transaction. A service check, when offered, is also not proof generation.

The Preview public-state endpoints are:

| Service | Address |
| --- | --- |
| Indexer HTTP | `https://indexer.preview.midnight.network/api/v4/graphql` |
| Indexer WebSocket | `wss://indexer.preview.midnight.network/api/v4/graphql/ws` |

No bundled access token is needed for these Preview defaults. The page offers Preview and an advanced isolated-local option. The underlying configuration library also supports Preprod for developer integrations, but it is not a page option. Never publish service credentials in a repository, screenshot or exported public record.

## Inspect the recorded public deployment

Download the [public Preview marketplace file](public-preview-marketplace.json) using GitHub's **Download raw file** control. After connecting your wallet on Preview, open **Set up marketplace**, choose the file under **Load public marketplace details**, then select **Join marketplace**. Open **Check receipts** and **Refresh contract state** to read the current indexed record.

The recorded deployment has one demonstration credential, one completed review, one claimed entitlement and a closed task. The file includes the public task text and identifiers, not issuer authority or an expert credential. Its task is closed after the acceptance test, so deploy your own marketplace to exercise every role and retain its private keys as described below. See the [public verification results](VERIFICATION.md#public-preview-status) for the accepted transactions, recovery history and published-browser check. This deployment uses test assets; the recorded claim did not transfer a reward.

## 4. Exercise the marketplace

1. **Deploy or join.** Create a new marketplace or join its known contract address on the selected network. Check the displayed marketplace and contract identifiers. Save the public join information and any separately offered private issuer key.
2. **Enroll a demonstration expert.** The issuer commits a credential to the registry. Save the resulting private credential separately from public records. The issuer must independently verify qualifications in a real marketplace; this test flow does not do so.
3. **Create a task.** Enter the required expertise, deadline, review limit, reward amount and task content. Save the task owner's private key when offered. The reward is an accounting amount, not escrowed funds.
4. **Submit a review.** Load the matching expert credential, choose the task and provide the three rubric scores and feedback. The contract checks registry membership, profession, validity through the task deadline, capacity and duplicate prevention.
5. **Approve and claim.** The task owner can approve a submitted review. Only its author can then record the claim entitlement, once. No reward token or money transfer occurs.
6. **Inspect the result.** Keep the receipt and public record. Check the actual transaction status before retrying an uncertain submission. A locally constructed receipt alone does not establish network acceptance.

Wallet approval is required for each transaction. The wallet's proving provider generates call proofs using the local prover, then the wallet balances, signs and submits. Contract deployment installs verifier material and is a separate operation from proving a contract call. The application reads confirmations through the configured indexer; this is not independent consensus verification.

## Isolated development network

The source also supports an isolated `undeployed` network for repeatable integration tests. Its service ports are deliberately separate from normal desktop defaults:

| Service | Local address |
| --- | --- |
| Node WebSocket RPC | `ws://127.0.0.1:29944` |
| Indexer HTTP | `http://127.0.0.1:28088/api/v4/graphql` |
| Indexer WebSocket | `ws://127.0.0.1:28088/api/v4/graphql/ws` |
| Proof server | `http://127.0.0.1:26300` |

The integration uses node 1.0.400, indexer 4.3.5 and proof-server 8.1.3. An accepted transaction on this isolated chain is not an accepted public Preview transaction. Consult [verification evidence](VERIFICATION.md) for the exact checks that ran. A locally funded developer wallet is not your Lace wallet, and no public faucet funding is implied. Follow [DEVELOPMENT.md](DEVELOPMENT.md) to run the isolated check yourself.

On Windows with Docker inside WSL, keep a WSL process or terminal running throughout the test. If the distribution shuts down, its Docker services may stop even though they were started in detached mode.

After installing the root dependencies and compiling the contract, run `npm ci --prefix devnet --ignore-scripts`, `bash devnet/services.sh up`, `node devnet/probe.mjs` and `npm run test:devnet` from the repository root. Use a Linux shell with Docker available. The harness funds its synthetic wallet from the isolated genesis fixture; it never uses your Preview wallet or recovery phrase. The [development guide](DEVELOPMENT.md) explains the separate browser and transaction suites.

## If a step fails

- **No wallet appears:** unlock the wallet, confirm its Midnight account is enabled in this browser, reload the page and refresh discovery. API 4 is required.
- **Network mismatch:** select the same network in both the wallet and page, then reconnect. ReviewLab rejects mainnet.
- **Local prover not reported:** save and confirm the wallet's custom prover setting. A wallet that omits the prover address cannot satisfy the application's destination check.
- **Insufficient DUST:** register the test NIGHT and allow generation to accrue. Fee capacity and generation are separate from having a NIGHT balance.
- **Proving fails:** check the prover version and readiness, leave it running, and confirm that the deployed contract matches the application's compiled version.
- **Submission outcome is uncertain:** inspect network state and the transaction identifier before resubmitting. Do not infer success from a completed proof or wallet dialog.
- **A private role key is missing:** a public receipt or join file cannot restore that authority. Use the matching private file or the original protected application state; never substitute a different key.

The [privacy guide](SECURITY.md) describes the remaining trust and storage boundaries. The [verification report](VERIFICATION.md) distinguishes browser checks, local proofs, isolated-network acceptance and public-network evidence.
