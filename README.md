# Midnight ReviewLab

**Expert feedback for AI, with private credentials and verifiable review records.**

Post an evaluation task, review an AI answer, and keep a receipt. ReviewLab explores how Midnight can check an expert's eligibility without publishing the credential secret, and how NIGHT-generated DUST can cover the blockchain fees of a marketplace.

[Open ReviewLab](https://ibkr-bouncybot.github.io/Midnight-ReviewLab/) · [Source](https://github.com/IBKR-BouncyBot/Midnight-ReviewLab) · [How it works](docs/ARCHITECTURE.md) · [Privacy and trust](docs/SECURITY.md) · [Verification](docs/VERIFICATION.md)

## Try the marketplace

1. Browse the example evaluation tasks and inspect a prompt, AI answer and review rubric.
2. Create a demonstration expert credential for the required field. Keep its private download if you want to use it again.
3. Score an answer and submit written feedback. The native contract checks eligibility and rejects a second submission by the same credential for that task.
4. Keep the review receipt, inspect campaign results and explore approval and reward accounting.
5. Use the sponsorship calculator to explore how NIGHT-generated DUST could support transaction fees.

The application runs genuine generated Compact contract code and official Midnight runtime cryptography locally. **A local contract check is not a generated zero-knowledge proof or a confirmed blockchain transaction.** Website deployment is separate from contract deployment.

## What is private?

The credential secret is private input. ReviewLab uses a commitment and a task-specific nullifier so the contract can check eligibility and prevent reuse. Public records intentionally contain review identifiers, task information and verification data. Written feedback can identify its author if the author includes personal details.

The initial browser experience is a research prototype. Its issuer, campaign owner and reviewer roles run in the same browser. Demonstration credentials are not independently verified professional qualifications. Public browser storage is not a shared marketplace backend, and reward records are not money transfers. See the [security boundaries](docs/SECURITY.md).

## Why NIGHT and DUST?

Registered NIGHT generates DUST toward a cap. DUST pays Midnight transaction fees and cannot be transferred like an ordinary token. A sponsor wallet can pay the fee for an action authorized by someone else, without obtaining that person's credential secret. This could let a marketplace cover contributors' blockchain fees from its own NIGHT reserve.

The sponsorship screen is an illustrative planning tool. It does not read a live wallet, purchase NIGHT, generate DUST or pay model-inference costs. See [sponsorship design](docs/SPONSORSHIP.md) and Midnight's [official DUST sponsorship guide](https://docs.midnight.network/guides/dust-sponsorship).

## Build and run

Use Node.js 24 and Compact compiler 0.31.1. On Linux, install the official Compact tools and select compiler 0.31.1; Windows compilation uses WSL. The [development guide](docs/DEVELOPMENT.md) explains the workflow.

```sh
npm ci --ignore-scripts
npm run compile
npm test
npm run build
```

Serve `dist/` over a local HTTP server. The browser bundle uses real generated contract code and native WebAssembly. Missing generated output must fail the build.

The GitHub Actions workflow repeats compilation, tests and the production build, then publishes `dist/` with GitHub Pages. It never uploads wallet secrets or private credential files. See [deployment](docs/DEPLOYMENT.md).

## From prototype to shared service

A production marketplace needs independent credential issuers, a shared task and feedback service, an authenticated network deployment, a sponsor service with usage limits, actual reward settlement, and an operational privacy review. The [architecture guide](docs/ARCHITECTURE.md) describes these boundaries.

## License

Project-owned material is available under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires separate written permission from IBKR-BouncyBot. Third-party packages retain their own licenses. See [NOTICE.md](NOTICE.md).
