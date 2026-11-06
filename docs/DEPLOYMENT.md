# GitHub Pages deployment

The application is hosted as static files, following Midnight BallotLab's GitHub Pages pattern.

- Repository: `IBKR-BouncyBot/Midnight-ReviewLab`
- Website: `https://ibkr-bouncybot.github.io/Midnight-ReviewLab/`
- Workflow: `.github/workflows/pages.yml`
- Published directory: `dist/`

The landing page offers `browser.html` for local contract execution and `network.html` for wallet-connected testnet operations. The build must include the corresponding SDK/WASM bundles and public compiled contract assets. Hosting those assets does not run a proving server.

## Workflow

The build job installs the pinned Compact toolchain and the committed npm dependency graph, compiles the real contract, runs the tests, produces the browser application and exercises it in Chromium. A successful push to `main` uploads the Pages artifact; the deploy job publishes it to the `github-pages` environment. Pull requests run the build without publishing.

The repository's Pages source must be **GitHub Actions**. GitHub's deployment URL and successful workflow conclusion establish website publication, not a Midnight network deployment.

## Independent proof checks

The manually dispatched `.github/workflows/proofs.yml` installs the same compiler, runs generated-contract tests and starts the official proof-server 8.1.3 image pinned by digest. It binds the prover to loopback, disables container logging and runs `npm run test:proofs`. It does not deploy the website or submit a blockchain transaction. Its conclusion is proof evidence only when that workflow has actually completed successfully for the revision being discussed.

The separate manually dispatched `.github/workflows/devnet.yml` starts a disposable local node, indexer and prover with pinned image digests. It runs `npm run test:devnet` with a synthetic local-chain wallet, then builds the real client and runs `npm run test:devnet:browser` through the official testkit's API-4 wallet adapter. Both exercise the complete marketplace lifecycle and retain only sanitized readiness and transaction reports. This workflow establishes the respective isolated-chain results when its run passes; it does not establish a public Preview transaction or a Lace extension interaction.

## Static-host constraints

Use project-relative asset URLs so the application works beneath `/Midnight-ReviewLab/`, including both demo entry points and `network-contract/` proof assets. The host does not run a backend, sponsor wallet, AI model, proof server or Midnight node. Shared task storage, independent credential issuance and actual payouts require additional services. The [testnet guide](TESTNET.md) covers the user's wallet and local prover setup.

Static hosting also cannot safely hold private API keys. Do not place sponsor keys, wallet seeds, inference API keys or confidential task data in environment variables consumed by the browser build; those values become public when bundled.

## Release checks

Confirm the exact revision's compiler, tests and build succeeded. Exercise the browser workflow and inspect the deployed application. Report any proof generation and network acceptance separately, including the network and public transaction identifiers only when those tests actually ran.

Do not upload private credential files or raw prover inputs as artifacts. Publish only public records, screenshots without secrets, and sanitized execution reports.
