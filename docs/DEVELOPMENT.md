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

Use synthetic demonstration credentials and test funds. Keep keys, wallet seeds, private state, prover input and secrets out of source control, browser storage, CI artifacts and screenshots. Do not copy the contents of private downloads into bug reports.

## Network integration

The implemented testnet client uses real Midnight.js providers and API-4 wallet authorization. Network execution needs an identified Midnight network and contract, an appropriate wallet, generated DUST and a real proving provider. The current wallet pays its own fees. A static host supplies none of these automatically. Test network submission independently of the frontend deployment and retain only public, non-sensitive evidence. Follow [TESTNET.md](TESTNET.md) for Preview and isolated-network setup.

Actual circuit proof checks are separate from local generated-contract tests. Start proof-server 8.1.3 on loopback port 6301, set `MIDNIGHT_LOCAL_PROOF_SERVER=http://127.0.0.1:6301`, and run `npm run test:proofs`. The optional GitHub proof workflow demonstrates the pinned Docker invocation. Do not enable request-body logging: private witnesses are sent to the prover. A local proof result is not a network transaction confirmation.

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

Both harnesses write sanitized reports under `artifacts/local-devnet/`; do not retain raw wallet databases or prover request bodies. See the manually dispatched [devnet workflow](../.github/workflows/devnet.yml) for the complete repeatable sequence and scoped service cleanup. On Windows, keep the WSL distribution running while its Docker services are needed.
