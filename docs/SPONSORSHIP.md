# NIGHT and DUST sponsorship

NIGHT is the resource-generating asset. Registered NIGHT generates DUST over time toward a cap determined by the network's parameters. DUST is nontransferable and pays Midnight transaction fees. Spending or moving backing NIGHT changes the associated DUST generation and decay behavior.

A marketplace can hold registered NIGHT and use a sponsor wallet to cover transaction fees for contributors. The expert still authorizes the review with their own private inputs. A correctly finalized sponsored transaction lets the sponsor add its fee contribution without changing the authorized action.

ReviewLab's current testnet client uses the connected wallet's own DUST. The browser-lab calculator explains a possible sponsor model; a running fee-sponsorship service remains separate production work.

## ReviewLab's planning screen

The calculator illustrates possible fee capacity from user-supplied assumptions. It does not query live network parameters or establish the amount of NIGHT a business should purchase. Estimates are not price quotes or guaranteed throughput.

Any operating plan must distinguish:

- DUST generation rate and the capacity cap.
- The DUST currently available, including possible decay.
- Actual transaction fees and any failure fees.
- Local proof-server or proving infrastructure costs.
- Task storage, AI model inference and reviewer rewards, which DUST does not pay for.

## A production sponsor

The sponsor should accept only requests that satisfy its own service policy, enforce allowances and rate limits, check the target contract and network, and avoid accepting unbound user transactions. It must protect its wallet key, monitor generation and fees, and handle unavailable capacity without pretending a review was submitted.

Sponsorship is a wallet/service operation. A Compact contract does not itself hold and spend DUST. There is no exchange of transferable DUST between an expert and a marketplace.

See Midnight's official [DUST management guide](https://docs.midnight.network/guides/manage-dust) and [fee sponsorship guide](https://docs.midnight.network/guides/dust-sponsorship).
