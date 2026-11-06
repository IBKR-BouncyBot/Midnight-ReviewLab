import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {MidnightBech32m,UnshieldedAddress} from '@midnight-ntwrk/wallet-sdk-address-format';

const endpoint='https://indexer.preview.midnight.network/api/v4/graphql';
const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--attempt'||!['1','2'].includes(args[1])))throw new Error('EXPECTED_FIXED_FUNDING_ATTEMPT_1_OR_2');
const attempt=args[1]??'1';
const attempts=Object.freeze({
  '1':{txId:'00cae2416d0dacbe8573c7a519f5ce933d7e36004f0ea2e18c6532d793f23c5e6b',
    recipient:'mn_addr_preview1h9uhqe9t8pkxmn9ykfk3gwetw8p4uf3vvkqcvsdd9atxhtgqwufshdnhp2',
    expectedBlock:1629256,workflowRunId:'42290089655'},
  '2':{txId:'00144ac7d3b8431e5ad09e9ac4ae377c0e3442314a9c7f7ff668a6d50bf77a498c',
    recipient:'mn_addr_preview1l535axegyq3ccstq0y6smdpqqztj9smdeezs98hxe8wkslzq297qsnaxv7',
    expectedBlock:1629437,workflowRunId:'42293370522'},
});
const {txId,recipient,expectedBlock,workflowRunId}=attempts[attempt];
const expectedAmount=1_000_000_000n;
const root=path.resolve(import.meta.dirname,'..');
const report={schema:'reviewlab-lace-ci-public-funding-verification-v1',status:'running',
  checkedAt:new Date().toISOString(),networkId:'preview',confirmationSource:'canonical-public-Preview-indexer',
  endpoint,txId,recipient,fundingAttempt:attempt,workflowRunId,scope:'Public funding-transfer output and accepted proof-presence verification only',
  walletAccessed:false,transactionSubmitted:false,laceFundingSynchronizationObserved:false,
  proofGenerationLocationObserved:false,independentConsensusOrCryptographicProofVerification:false};
class VerificationFailure extends Error{constructor(code){super(code);this.code=code;}}
const check=(ok,code)=>{if(!ok)throw new VerificationFailure(code);};
const original=new Map(['log','info','warn','error','debug','trace','dir','table'].map(name=>[name,console[name]]));
for(const name of original.keys())console[name]=()=>{};
try{
  check(/^[0-9a-f]{66}$/.test(txId),'INVALID_EXPECTED_IDENTIFIER');
  const parsed=MidnightBech32m.parse(recipient);check(parsed.network==='preview','EXPECTED_ADDRESS_WRONG_NETWORK');
  const owner=parsed.decode(UnshieldedAddress,'preview').hexString;
  const nativeType=ledger.unshieldedToken().raw;check(nativeType==='0'.repeat(64),'NATIVE_TOKEN_TYPE_MISMATCH');
  const query='query($offset: TransactionOffset!){transactions(offset:$offset){raw hash block{height hash} ... on RegularTransaction{identifiers transactionResult{status} fees{paidFees estimatedFees}}}}';
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({query,variables:{offset:{identifier:txId}}}),credentials:'omit',redirect:'error',
    cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30_000)});
  check(response.ok&&response.url===endpoint&&!response.redirected&&response.body,'CANONICAL_INDEXER_UNAVAILABLE');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;check(size<=32*1024*1024,'INDEXER_RESPONSE_LIMIT');chunks.push(chunk);}
  const result=JSON.parse(Buffer.concat(chunks,size));
  check(!result.errors?.length&&Array.isArray(result.data?.transactions)&&result.data.transactions.length<=10,'INVALID_INDEXER_RESPONSE');
  const matches=result.data.transactions.filter(item=>item.identifiers?.includes(txId));check(matches.length===1,'FUNDING_TRANSACTION_NOT_FOUND');
  const indexed=matches[0];check(indexed.transactionResult?.status==='SUCCESS','FUNDING_TRANSACTION_NOT_SUCCESSFUL');
  check(/^[0-9a-f]{64}$/.test(indexed.hash)&&/^[0-9a-f]{64}$/.test(indexed.block?.hash),'INDEXER_HASH_INVALID');
  check(Number(indexed.block.height)===expectedBlock,'FUNDING_BLOCK_MISMATCH');
  check(typeof indexed.raw==='string'&&/^(?:[0-9a-f]{2})+$/.test(indexed.raw)&&indexed.raw.length<16*1024*1024,'RAW_TRANSACTION_INVALID');
  const tx=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(indexed.raw,'hex'));
  check(tx.transactionHash()===indexed.hash&&tx.identifiers().includes(txId),'DESERIALIZED_TRANSACTION_IDENTITY_MISMATCH');
  const matchingOutputs=[],dustProofBytes=[];
  for(const [segment,intent] of tx.intents){
    for(const [section,offer] of [['guaranteed',intent.guaranteedUnshieldedOffer],['fallible',intent.fallibleUnshieldedOffer]]){
      for(const output of offer?.outputs??[]){
        if(output.owner===owner&&output.type===nativeType)matchingOutputs.push({segment,section,value:output.value.toString()});
      }
    }
    for(const spend of intent.dustActions?.spends??[]){
      check(spend.proof?.instance==='proof','DUST_PROOF_MISSING');const bytes=spend.proof.serialize().byteLength;
      check(bytes>0,'DUST_PROOF_EMPTY');dustProofBytes.push(bytes);
    }
  }
  check(matchingOutputs.length===1&&matchingOutputs.reduce((sum,item)=>sum+BigInt(item.value),0n)===expectedAmount,'FUNDING_OUTPUT_MISMATCH');
  check(dustProofBytes.length>0,'DUST_PROOF_NOT_PRESENT');
  const fee=String(indexed.fees?.paidFees);check(/^\d+$/.test(fee),'FUNDING_FEE_INVALID');
  Object.assign(report,{status:'passed',indexerStatus:'SucceedEntirely',transactionHash:indexed.hash,
    blockHeight:expectedBlock,blockHash:indexed.block.hash,transactionBytes:indexed.raw.length/2,
    recipientAddressChecksumVerified:true,recipientOutputMatched:true,matchingOutputCount:matchingOutputs.length,
    matchingOutputSections:matchingOutputs.map(({segment,section})=>({segment,section})),
    nativeNightTokenType:nativeType,amountSTAR:expectedAmount.toString(),amountTestNIGHT:'1000',
    dustSpendCount:dustProofBytes.length,dustProofCount:dustProofBytes.length,dustProofBytes,paidFeesIndexerUnits:fee,
    helperSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),
    limitations:['Only the expected recipient output is reported; unrelated outputs and raw transaction bytes are omitted.',
      'An indexed successful funding transfer does not establish that the Lace wallet has synchronized or can access its configured Preview services.']});
}catch(error){report.status='failed';report.code=error instanceof VerificationFailure?error.code:'PUBLIC_FUNDING_CHECK_FAILED';process.exitCode=1;}
finally{
  report.completedAt=new Date().toISOString();
  const directory=path.join(root,'artifacts');await mkdir(directory,{recursive:true});
  const output=path.join(directory,attempt==='1'?'lace-ci-funding-verification.json':'lace-ci-funding-verification-2.json');
  await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n');await rename(output+'.tmp',output);
  for(const [name,fn] of original)console[name]=fn;
}
console.log(JSON.stringify({status:report.status,code:report.code,txId,blockHeight:report.blockHeight,
  recipientOutputMatched:report.recipientOutputMatched,amountSTAR:report.amountSTAR,dustProofCount:report.dustProofCount}));
