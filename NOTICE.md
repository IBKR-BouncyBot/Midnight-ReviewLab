# Midnight ReviewLab

Required Notice: Copyright (c) 2026 IBKR-BouncyBot

Project-owned source code, documentation and graphics are offered under the PolyForm Noncommercial License 1.0.0 in [LICENSE](LICENSE). Noncommercial use, modification and sharing are permitted subject to that license. Commercial use requires separate written permission from the copyright holder.

This is source-available software with a noncommercial restriction. The license text governs; this notice is a summary and does not grant additional rights.

The deployment pattern and pinned Compact installer were adapted from [Midnight BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab), also by IBKR-BouncyBot. The native WebAssembly bundling plugin (`scripts/native-wasm-plugin.mjs`) is reused from that project under its existing PolyForm Noncommercial 1.0.0 license. Third-party components retain their own copyrights and licenses; their dependency packages include those notices.

The browser wallet provider, network configuration boundaries and SDK witness-scoping approach are adapted from BallotLab under the same license. The locally hosted Outfit typeface is licensed under the SIL Open Font License 1.1, retained in `src/fonts/OFL-Outfit.txt` and the published `fonts/` directory. The visual palette follows Midnight; this independent research app does not imply endorsement.

The Cardano support-address QR graphic is reused from BallotLab under the same license and encodes the same IBKR-BouncyBot receiving address.

## Runtime license texts

The Midnight runtime's Apache License text is preserved in `docs/licenses/Apache-2.0.txt`. The production build includes `THIRD_PARTY_NOTICES.txt` with the names, versions and available installed-package license texts of bundled dependencies. Third-party licenses remain in force independently of this project's license.
