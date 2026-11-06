/** Fund a fresh isolated Lace CI wallet with TEST NIGHT from our dedicated
 * Preview wallet. No mainnet, faucet automation, external seeds or remote proof.
 * A recipient may be funded only once by this helper; uncertain outcomes stop.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {MidnightBech32m,UnshieldedAddress} from '@midnight-ntwrk/wallet-sdk-address-format';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {startPreviewWallet,PREVIEW_ENVIRONMENT} from './preview-acceptance.mjs';
import {writePreviewSecret} from './preview-wallet.mjs';
import {createLocalWasmProving} from './wasm-proving.mjs';

const root=resolve(import.meta.dirname,'..'),directory=join(root,'artifacts/lace-ci-funding');
let context,path,report;
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
try{
  assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--request');
  const bytes=await readFile(resolve(process.argv[3]));assert.ok(bytes.length<32768);
  const request=JSON.parse(bytes);assert.equal(request.networkId,'preview');assert.equal(request.laceVersion,'2.5.1');assert.match(request.workflowRunId,/^[0-9]{1,24}$/);
  const address=MidnightBech32m.parse(request.unshieldedAddress);assert.equal(address.network,'preview');
  const receiverAddress=address.decode(UnshieldedAddress,'preview');
  const recipient=address.asString();
  const recipientHash=createHash('sha256').update(recipient).digest('hex');
  path=join(directory,`${recipientHash}.json`);await mkdir(directory,{recursive:true});
  report={networkId:'preview',workflowRunId:request.workflowRunId,recipient,amountStar:'1000000000',amountTestNight:1000,status:'preparing',startedAt:new Date().toISOString(),provingMetrics:{},realMoneyTransferred:false};
  // Exclusive creation makes retries fail closed, even if a response was lost.
  await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  for(const method of ['log','info','debug','warn','error','trace','dir'])console[method]=()=>{};
  const wasm=await createLocalWasmProving({zkConfigProvider:{get(){throw new Error('Contract proofs not allowed in funding helper');}},metrics:report.provingMetrics});
  context=await startPreviewWallet({localWasmProvingService:wasm.walletProvingService});
  assert.notEqual(MidnightBech32m.parse(context.address).asString(),recipient);
  await context.built.wallet.waitForSyncedState();
  const {wallet,seeds,keystore}=context.built;
  const secretKeys={shieldedSecretKeys:context.ledger.ZswapSecretKeys.fromSeed(seeds.shielded),dustSecretKey:context.ledger.DustSecretKey.fromSeed(seeds.dust)};
  output({status:'preparing-preview-funding',recipient,amountTestNight:1000});
  const recipe=await wallet.transferTransaction([{type:'unshielded',outputs:[{type:context.ledger.unshieldedToken().raw,receiverAddress,amount:1_000_000_000n}]}],secretKeys,{ttl:new Date(Date.now()+3600000),payFees:true});
  const signed=await wallet.signRecipe(recipe,payload=>keystore.signData(payload));
  const transaction=await wallet.finalizeRecipe(signed);
  const identifiers=transaction.identifiers();report.txId=identifiers.at(-1);report.identifiers=identifiers;
  const encryptedRecord=`transaction-${Date.now()}-${randomBytes(4).toString('hex')}`;
  await writePreviewSecret(encryptedRecord,{networkId:'preview',address:context.address,identifiers,transaction:Buffer.from(transaction.serialize()).toString('hex')});
  report.status='submission-outcome-pending';report.encryptedRecord=encryptedRecord;await writeFile(path,JSON.stringify(report,null,2)+'\n');
  await wallet.submitTransaction(transaction);
  const provider=indexerPublicDataProvider(PREVIEW_ENVIRONMENT.indexer,PREVIEW_ENVIRONMENT.indexerWS,context.WebSocket);
  const confirmed=await provider.watchForTxData(report.txId);assert.equal(confirmed.status,'SucceedEntirely');
  report.status='accepted';report.blockHeight=String(confirmed.blockHeight);report.completedAt=new Date().toISOString();
  await writeFile(path,JSON.stringify(report,null,2)+'\n');
  output({status:'accepted-preview-funding',recipient:report.recipient,amountTestNight:1000,txId:report.txId,blockHeight:report.blockHeight});
}catch(error){
  if(error?.code==='EEXIST'){output({status:'refused-duplicate-funding',details:'Reconcile the existing public funding report before any further action.'});}
  else{if(path&&report){report.failureAt=new Date().toISOString();await writeFile(path,JSON.stringify(report,null,2)+'\n').catch(()=>{});}output({status:'funding-not-completed',details:'Private diagnostic details withheld; do not retry an uncertain submission.'});}
  process.exitCode=1;
}finally{if(context){await context.checkpoint().catch(()=>{});await context.close();}}
process.exit(process.exitCode??0);
