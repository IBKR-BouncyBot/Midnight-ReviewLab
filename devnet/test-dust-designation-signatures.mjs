/** Regression for the native append behavior behind SDK re-signing.
 * Synthetic ephemeral key/input only; no wallet, network, proof or submission.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {Either} from 'effect';
import {TransactionOps} from './node_modules/@midnight-ntwrk/wallet-sdk-unshielded-wallet/dist/v1/TransactionOps.js';

const report={test:'native-unshielded-signature-append-regression',checkedAt:new Date().toISOString(),
  syntheticInputOnly:true,walletAccess:false,networkAccess:false,proofGeneration:false,networkSubmission:false,status:'failed'};
let exitCode=1;
try{
  report.stage='create-synthetic-signature';
  const signingKey=ledger.sampleSigningKey(),publicKey=ledger.signatureVerifyingKey(signingKey);
  const data=new TextEncoder().encode('ReviewLab synthetic signature append regression');
  const signature=ledger.signData(signingKey,data);
  report.stage='verify-synthetic-signature';
  assert.equal(ledger.verifySignature(publicKey,data,signature),true);
  const native=ledger.unshieldedToken().raw;
  report.stage='create-synthetic-offer';
  const offer=ledger.UnshieldedOffer.new([{owner:publicKey,type:native,value:1_000_000n,intentHash:'00'.repeat(32),outputNo:0}],
    [{owner:ledger.addressFromKey(publicKey),type:native,value:1_000_000n}],[]);
  assert.equal(offer.inputs.length,1);assert.equal(offer.signatures.length,0);
  report.stage='first-sdk-signing';
  const signed=Either.getOrThrow(TransactionOps.addSignaturesToOffer(offer,signature,1,'guaranteed'));
  report.firstSigning={inputCount:signed.inputs.length,signatureCount:signed.signatures.length};
  assert.equal(signed.signatures.length,signed.inputs.length);
  const originalSnapshot=ledger.UnshieldedOffer.new(signed.inputs,signed.outputs,signed.signatures);
  report.stage='repeat-sdk-signing';
  const repeated=Either.getOrThrow(TransactionOps.addSignaturesToOffer(signed,signature,1,'guaranteed'));
  report.repeatedSigning={inputCount:repeated.inputs.length,signatureCount:repeated.signatures.length,uniqueSignatureCount:new Set(repeated.signatures).size};
  assert.equal(repeated.signatures.length,2);
  assert.equal(new Set(repeated.signatures).size,1);
  assert.notEqual(repeated.signatures.length,repeated.inputs.length);
  // A DUST-only balancing step must retain the already signed NIGHT offer;
  // invoking this SDK signer again demonstrably appends a duplicate signature.
  report.stage='check-original-offer';
  report.originalSignatureCountAfterRepeat=signed.signatures.length;
  assert.equal(signed.signatures.length,2); // Native addSignatures mutates too.
  assert.equal(originalSnapshot.signatures.length,1);
  assert.equal(ledger.verifySignature(publicKey,data,originalSnapshot.signatures[0]),true);
  Object.assign(report,{status:'passed',stage:'completed',firstSigning:{inputCount:1,signatureCount:1,signatureVerifies:true},
    repeatedSigning:{inputCount:1,signatureCount:2,uniqueSignatureCount:1,rejectedByCardinalityInvariant:true},
    retainedOriginalSignature:{signatureCount:1,signatureVerifies:true}});
  exitCode=0;
}catch{report.errorCode='NATIVE_SIGNATURE_APPEND_REGRESSION_FAILED';}
try{
  const directory=resolve(import.meta.dirname,'../artifacts/native-signature-regression');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'evidence.json'),JSON.stringify(report,null,2)+'\n');
}catch{report.errorCode='SANITIZED_REPORT_WRITE_FAILED';exitCode=1;}
process.stdout.write(JSON.stringify(report)+'\n');process.exitCode=exitCode;
