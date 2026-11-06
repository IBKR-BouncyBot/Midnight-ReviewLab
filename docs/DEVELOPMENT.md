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
npm run test:browser
```

The contract is `contracts/reviewlab.compact`; compilation writes its generated implementation to `contracts/managed/reviewlab/contract/index.js`. Full compilation generates circuit artifacts and keys. `npm run compile:fast` skips key generation for iteration; it is insufficient for a release that includes proving assets. The compiler wrapper supports `COMPACTC` for an explicitly selected compiler binary; otherwise Linux uses the official Compact CLI.

The generated-runtime tests should exercise valid reviews and rejection cases: wrong expertise, expired credentials, invalid membership, duplicate submission, altered review data, unauthorized campaign operations and repeat claims. Each test establishes only the level of execution it actually performs.

`npm run dev` serves the generated `dist/` directory locally. Install the test browser with `npx playwright install chromium`, then run `npm run test:browser`. Also exercise narrow screens, keyboard access, imports, receipt downloads, duplicate submissions, campaign creation and persistence. Use a clean browser context to distinguish restored public records from private credentials that have not been restored.

## Working with private material

Use synthetic demonstration credentials and test funds. Keep keys, wallet seeds, private state, prover input and secrets out of source control, browser storage, CI artifacts and screenshots. Do not copy the contents of private downloads into bug reports.

## Network integration

Network execution needs additional services: an identified Midnight network and contract, an appropriate wallet, generated DUST or a sponsor, and a real proving provider. A static host supplies none of these automatically. Test network submission independently of the frontend deployment and retain only public, non-sensitive evidence.

Actual circuit proof checks are separate from local generated-contract tests. Start proof-server 8.1.3 on loopback port 6301, set `MIDNIGHT_LOCAL_PROOF_SERVER=http://127.0.0.1:6301`, and run `npm run test:proofs`. The optional GitHub proof workflow demonstrates the pinned Docker invocation. Do not enable request-body logging: private witnesses are sent to the prover. A local proof result is not a network transaction confirmation.
