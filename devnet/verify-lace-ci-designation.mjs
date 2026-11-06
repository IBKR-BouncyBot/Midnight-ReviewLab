/** Reproducible public-only verification of the accepted SDK-assisted DUST
 * designation for the isolated Lace CI runner. No wallet, private records,
 * signing, proving or submission. Indexer evidence cannot attest Lace's mode.
 */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {toTxStatus} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {MidnightBech32m,DustAddress,UnshieldedAddress} from '@midnight-ntwrk/wallet-sdk-address-format';

const INDEXER='https://indexer.preview.midnight.network/api/v4/graphql';
const TX_ID='005e20f9d3184b30d9b8c25fc075f3f6431735c753420fd8e7ff742e07add2c517';
const TX_HASH='faaf1a67252a7bb51172d729dd4e8c360dffc68d19fb75c63869fbcd494972f3';
const BLOCK_HEIGHT='1629969';
const RECIPIENT='mn_dust_preview1wv8axhhnpu5fa2qu8cmcd8fqruz5hhxzktgkk3fwj8pmhqgat0s55tff7m5';
const SPONSOR='mn_addr_preview1p35fx287danunuhw7ezctf5n0hkr5cc4ctxv00nhsf7wmvyjxx8sqc3n0f';
const EXPECTED_NIGHT=3_000_000_000n,MAX_RESPONSE=8*1024*1024;
const root=resolve(import.meta.dirname,'..');
class VerificationFailure extends Error{constructor(code){super(code);this.code=code;}}
function requireValue(condition,code){if(!condition)throw new VerificationFailure(code);}
const decimal=value=>{const text=String(value);requireValue(/^(?:0|[1-9][0-9]{0,79})$/.test(text),'INVALID_PUBLIC_NUMBER');return text;};
const evidence={version:1,purpose:'public verification of SDK-assisted DUST designation',networkId:'preview',
  checkedAt:new Date().toISOString(),source:INDEXER,workflowRunId:'42297109348',status:'failed',
  networkSubmission:false,privateWalletAccess:false,provingPerformed:false,
  laceRegistrationUiTested:false,laceMarketplaceTransactionTested:false,
  walletAndProvingModeAttestedByIndexer:false,independentChainVerification:false,
  cryptographicProofsIndependentlyVerified:false};
for(const name of ['log','info','debug','warn','error','trace','dir','table'])console[name]=()=>{};

async function queryTransaction(){
  const query=`query($offset:TransactionOffset!){transactions(offset:$offset){raw hash block{height hash timestamp}
    ... on RegularTransaction{identifiers transactionResult{status} fees{paidFees estimatedFees}}}}`;
  const response=await fetch(INDEXER,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({query,variables:{offset:{identifier:TX_ID}}}),redirect:'error',credentials:'omit',
    cache:'no-store',signal:AbortSignal.timeout(30000)});
  requireValue(response.ok&&!response.redirected&&response.url===INDEXER&&response.body,'PUBLIC_INDEXER_UNAVAILABLE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>MAX_RESPONSE){await reader.cancel();throw new VerificationFailure('PUBLIC_RESPONSE_TOO_LARGE');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const body=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
  requireValue(!body.errors?.length&&Array.isArray(body.data?.transactions)&&body.data.transactions.length<=10,'INVALID_PUBLIC_INDEXER_RESPONSE');
  const matches=body.data.transactions.filter(tx=>Array.isArray(tx.identifiers)&&tx.identifiers.includes(TX_ID));
  requireValue(matches.length===1,'ACCEPTED_TRANSACTION_NOT_FOUND');return matches[0];
}

async function writeEvidence(file,value){
  const temporary=`${file}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await rename(temporary,file);
}

let exitCode=1;
try{
  requireValue(process.argv.length===2,'INVALID_VERIFIER_ARGUMENTS');
  evidence.verifierSourceSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
  const encodedRecipient=MidnightBech32m.parse(RECIPIENT),encodedSponsor=MidnightBech32m.parse(SPONSOR);
  requireValue(encodedRecipient.network==='preview'&&encodedSponsor.network==='preview','PREVIEW_ADDRESS_REQUIRED');
  const recipient=encodedRecipient.decode(DustAddress,'preview');
  const sponsorRaw=Buffer.from(encodedSponsor.decode(UnshieldedAddress,'preview').data).toString('hex');
  const indexed=await queryTransaction();
  requireValue(indexed.hash===TX_HASH&&String(indexed.block?.height)===BLOCK_HEIGHT
    &&/^[0-9a-f]{64}$/.test(indexed.block?.hash),'INDEXED_TRANSACTION_IDENTITY_MISMATCH');
  requireValue(toTxStatus(indexed.transactionResult)==='SucceedEntirely','TRANSACTION_NOT_FULLY_SUCCESSFUL');
  requireValue(typeof indexed.raw==='string'&&indexed.raw.length>0&&indexed.raw.length<=MAX_RESPONSE
    &&/^(?:[0-9a-f]{2})+$/.test(indexed.raw),'INVALID_INDEXED_TRANSACTION_BYTES');
  const transaction=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(indexed.raw,'hex'));
  requireValue(transaction.transactionHash()===TX_HASH&&transaction.identifiers().includes(TX_ID),'DECODED_TRANSACTION_IDENTITY_MISMATCH');
  requireValue(transaction.rewards===undefined&&transaction.guaranteedOffer===undefined
    &&(transaction.fallibleOffer===undefined||transaction.fallibleOffer.size===0),'UNEXPECTED_REWARD_OR_SHIELDED_ACTION');
  requireValue(transaction.intents instanceof Map&&transaction.intents.size===2,'UNEXPECTED_INTENT_COUNT');
  const native=ledger.unshieldedToken().raw;
  let registrationCount=0,nightInputs=0,nightOutputs=0,inputTotal=0n,outputTotal=0n,contractCalls=0,dustSpendCount=0,dustFees=0n;
  const dustProofBytes=[];
  for(const [segment,intent] of transaction.intents){
    contractCalls+=intent.actions.length;requireValue(intent.actions.length===0,'CONTRACT_ACTION_PRESENT');
    const registrations=intent.dustActions?.registrations??[],spends=intent.dustActions?.spends??[];
    requireValue(registrations.length===1&&spends.length===0||registrations.length===0&&spends.length===1,'UNEXPECTED_DUST_ACTION_LAYOUT');
    for(const registration of registrations){
      requireValue(registration.dustAddress===recipient.data&&ledger.addressFromKey(registration.nightKey)===sponsorRaw
        &&registration.allowFeePayment===0n,'DESIGNATION_RECIPIENT_OR_SPONSOR_MISMATCH');registrationCount++;
    }
    for(const spend of spends){
      requireValue(spend.proof?.instance==='proof'&&spend.vFee>0n,'MISSING_POSITIVE_DUST_SPEND_PROOF');
      const proofBytes=spend.proof.serialize().byteLength;requireValue(proofBytes===2940,'UNEXPECTED_DUST_PROOF_SIZE');
      dustProofBytes.push(proofBytes);dustSpendCount++;dustFees+=spend.vFee;
      requireValue(intent.guaranteedUnshieldedOffer===undefined&&intent.fallibleUnshieldedOffer===undefined,'UNEXPECTED_NIGHT_IN_FEE_INTENT');
    }
    for(const offer of [intent.guaranteedUnshieldedOffer,intent.fallibleUnshieldedOffer])if(offer){
      requireValue(offer.signatures.length===offer.inputs.length,'NIGHT_SIGNATURE_COUNT_MISMATCH');
      for(const [index,input] of offer.inputs.entries()){
        requireValue(input.type===native&&ledger.addressFromKey(input.owner)===sponsorRaw&&input.value>0n,'UNEXPECTED_NIGHT_INPUT');
        requireValue(ledger.verifySignature(input.owner,intent.signatureData(segment),offer.signatures[index]),'INVALID_NIGHT_SIGNATURE');
        inputTotal+=input.value;nightInputs++;
      }
      for(const output of offer.outputs){
        requireValue(output.owner===sponsorRaw&&output.type===native&&output.value>0n,'NIGHT_TRANSFER_OR_UNEXPECTED_OUTPUT');
        outputTotal+=output.value;nightOutputs++;
      }
    }
  }
  requireValue(registrationCount===1&&dustSpendCount===1&&nightInputs===1&&nightOutputs===1
    &&inputTotal===EXPECTED_NIGHT&&outputTotal===EXPECTED_NIGHT,'DESIGNATION_TOTAL_OR_COUNT_MISMATCH');
  Object.assign(evidence,{status:'passed-public-designation-verification',txId:TX_ID,transactionHash:TX_HASH,
    blockHeight:BLOCK_HEIGHT,blockHash:indexed.block.hash,blockTimestamp:new Date(indexed.block.timestamp).toISOString(),
    indexerStatus:'SucceedEntirely',recipientDustAddress:RECIPIENT,sponsorUnshieldedAddress:SPONSOR,
    registrationMode:'redesignation',registrationCount,nightInputCount:nightInputs,nightOutputCount:nightOutputs,
    nightInputStar:String(inputTotal),nightOutputStar:String(outputTotal),testNightRetainedBySponsor:3000,
    allNightRetainedBySponsor:true,nightTransferredStar:'0',nightSignaturesVerified:true,
    dustSpendCount,dustProofBytes,dustFeeSpeck:String(dustFees),contractCallCount:contractCalls,
    finalizedTransactionBytes:transaction.serialize().byteLength,
    indexerFees:{paidFees:decimal(indexed.fees?.paidFees),estimatedFees:decimal(indexed.fees?.estimatedFees)}});
  exitCode=0;
}catch(error){evidence.errorCode=error instanceof VerificationFailure?error.code:'PUBLIC_DESIGNATION_VERIFICATION_FAILED';}
try{
  const directory=resolve(root,'artifacts/lace-ci-designation');await mkdir(directory,{recursive:true});
  await writeEvidence(resolve(directory,'verification.json'),evidence);
  // Only this explicitly constructed public schema can enter the repository's
  // docs. Private operator reports are never read or copied by this verifier.
  if(exitCode===0)await writeEvidence(resolve(root,'docs/lace-ci-designation-verification.json'),evidence);
}catch{evidence.status='failed';evidence.errorCode='SANITIZED_EVIDENCE_WRITE_FAILED';exitCode=1;}
process.stdout.write(JSON.stringify(evidence)+'\n');process.exitCode=exitCode;
