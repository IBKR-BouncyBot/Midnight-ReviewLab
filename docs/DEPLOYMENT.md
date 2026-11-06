# GitHub Pages deployment

The application is hosted as static files, following Midnight BallotLab's GitHub Pages pattern.

- Repository: `IBKR-BouncyBot/Midnight-ReviewLab`
- Website: `https://ibkr-bouncybot.github.io/Midnight-ReviewLab/`
- Workflow: `.github/workflows/pages.yml`
- Published directory: `dist/`

## Workflow

The build job installs the pinned Compact toolchain and the committed npm dependency graph, compiles the real contract, runs the tests, produces the browser application and exercises it in Chromium. A successful push to `main` uploads the Pages artifact; the deploy job publishes it to the `github-pages` environment. Pull requests run the build without publishing.

The repository's Pages source must be **GitHub Actions**. GitHub's deployment URL and successful workflow conclusion establish website publication, not a Midnight network deployment.

## Independent proof checks

The manually dispatched `.github/workflows/proofs.yml` installs the same compiler, runs generated-contract tests and starts the official proof-server 8.1.3 image pinned by digest. It binds the prover to loopback, disables container logging and runs `npm run test:proofs`. It does not deploy the website or submit a blockchain transaction. Its conclusion is proof evidence only when that workflow has actually completed successfully for the revision being discussed.

## Static-host constraints

Use project-relative asset URLs so the application works beneath `/Midnight-ReviewLab/`. The host does not run a backend, sponsor wallet, AI model, proof server or Midnight node. Shared task storage, independent credential issuance and actual payouts require additional services.

Static hosting also cannot safely hold private API keys. Do not place sponsor keys, wallet seeds, inference API keys or confidential task data in environment variables consumed by the browser build; those values become public when bundled.

## Release checks

Confirm the exact revision's compiler, tests and build succeeded. Exercise the browser workflow and inspect the deployed application. Report any proof generation and network acceptance separately, including the network and public transaction identifiers only when those tests actually ran.

Do not upload private credential files or raw prover inputs as artifacts. Publish only public records, screenshots without secrets, and sanitized execution reports.
