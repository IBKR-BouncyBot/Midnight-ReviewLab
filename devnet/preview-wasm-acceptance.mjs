/** Fresh public Preview lifecycle with official on-device WASM for BOTH layers.
 * SDK acceptance, not a Lace extension test. Existing dedicated DPAPI test wallet
 * only. Every run gets separate encrypted keys and a separate marketplace.
 */
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startPreviewWallet,PREVIEW_ENVIRONMENT} from './preview-acceptance.mjs';
import {writePreviewSecret} from './preview-wallet.mjs';
import {stageRuntime} from './stage-runtime.mjs';
import {createLocalWasmProving} from './wasm-proving.mjs';

const root=resolve(import.meta.dirname,'..');
const runId=`wasm-${Date.now()}-${randomBytes(4).toString('hex')}`;
const directory=join(root,'artifacts/preview-wasm',runId);
const report={schema:'reviewlab-preview-wasm/v1',runId,startedAt:new Date().toISOString(),status:'running',networkId:'preview',wallet:'dedicated-DPAPI-SDK-test-wallet',realLaceWalletTested:false,proving:'official-wallet-sdk-WASM-worker-contract-and-DUST',httpProvingServiceConfigured:false,confirmationSource:'public-Preview-indexer',independentChainInclusionVerified:false,acceptedTransactions:[],rejectedBeforeSubmission:[],provingMetrics:{},rewardPaymentExecuted:false,sponsorServiceUsed:false};
let context,db,timer,stage='prerequisites',submissionAttempts=0,failNextProof=false,loseNextResponse=false,lastSubmittedId,client;
const output=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const save=async()=>{await mkdir(directory,{recursive:true});await writeFile(join(directory,'evidence.json'),JSON.stringify(report,null,2)+'\n');};
async function bounded(promise,ms=600000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
async function step(name,fn){stage=name;report.currentStage=name;await save();output({stage,status:'started'});return bounded(Promise.resolve().then(fn));}

try{
  assert.deepEqual(process.argv.slice(2),['--public-preview']);
  for(const name of ['MN_TEST_WALLET_SEED','TEST_WALLET_SEED','WALLET_SEED'])assert.equal(process.env[name],undefined);
  for(const method of ['log','info','warn','error','debug','trace','dir'])console[method]=()=>{};
  const chain=await fetch(PREVIEW_ENVIRONMENT.node,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'system_chain',params:[]}),signal:AbortSignal.timeout(15000)}).then(r=>r.json());
  assert.equal(chain.result,'Midnight Preview');
  const staged=await stageRuntime();report.sourceHashes=staged.hashes;
  for(const file of ['preview-wasm-acceptance.mjs','wasm-proving.mjs','preview-state.mjs','preview-acceptance.mjs','package-lock.json'])report.sourceHashes[`devnet/${file}`]=createHash('sha256').update(await readFile(join(import.meta.dirname,file))).digest('hex');
  const [{NodeZkConfigProvider},{indexerPublicDataProvider},{levelPrivateStateProvider},{Level},{validatePassword},sdk]=await Promise.all([
    import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),import('@midnight-ntwrk/midnight-js-level-private-state-provider'),import('level'),import('@midnight-ntwrk/midnight-js-utils'),import(pathToFileURL(join(staged.runtime,'lib/network/sdk-client.mjs')).href)]);
  const compiledAssetsPath=join(root,'contracts/managed/reviewlab'),zkConfigProvider=new NodeZkConfigProvider(compiledAssetsPath);
  const wasm=await createLocalWasmProving({zkConfigProvider,metrics:report.provingMetrics});
  context=await step('restore-dedicated-wallet',()=>startPreviewWallet({localWasmProvingService:wasm.walletProvingService,onState:state=>{report.walletState=state;}}));
  report.unshieldedAddress=context.address;report.restoredCheckpointAt=context.restoredCheckpointAt;
  timer=setInterval(()=>{output({stage,status:'waiting',proofsCompleted:report.provingMetrics.proofs.length});save().catch(()=>{});},30000);
  await step('sync-wallet',()=>context.built.wallet.waitForSyncedState());
  await step('wait-usable-dust',()=>context.waitFor(state=>state.isSynced&&state.dust.balance(new Date())>1_000_000_000_000_000n,300000));
  await context.checkpoint();
  const publicDataProvider=indexerPublicDataProvider(PREVIEW_ENVIRONMENT.indexer,PREVIEW_ENVIRONMENT.indexerWS,context.WebSocket);
  let password;for(;;){password=`Wasm-${randomBytes(32).toString('base64url')}-P7!`;try{validatePassword(password);break;}catch{}}
  const marketplaceId=sdk.randomHex32(),issuerSecret=sdk.randomHex32(),ownerSecret=sdk.randomHex32(),issuerIdentity=sdk.issuerIdentityFor(issuerSecret);
  const now=Math.floor(Date.now()/1000),credential=sdk.createCredential({marketplaceId,profession:'software',expiresAt:now+7*86400});
  const task={id:sdk.randomHex32(),profession:'software',deadline:now+2*86400,capacity:3,reward:100,contentDigest:await sdk.sha256Text('WASM Preview independent SDK acceptance: concurrent cache review')};
  await writePreviewSecret(`${runId}-plan`,{marketplaceId,issuerSecret,ownerSecret,credential,task,password});
  const privateStateProvider=levelPrivateStateProvider({midnightDbName:join(root,'.local',runId,'private-state'),accountId:`preview:${context.address}`,privateStoragePasswordProvider:()=>password,levelFactory:name=>{db=new Level(name,{valueEncoding:'utf8'});return db;}});
  const providers={privateStateProvider,publicDataProvider,zkConfigProvider,walletProvider:context.walletProvider,
    proofProvider:{async proveTx(transaction,options){if(failNextProof){failNextProof=false;throw new Error('Injected failure before proving');}return wasm.proofProvider.proveTx(transaction,options);}},
    midnightProvider:{async submitTx(transaction){
      const identifiers=transaction.identifiers(),txId=identifiers.at(-1);assert.ok(txId);
      const record=`transaction-${Date.now()}-${randomBytes(4).toString('hex')}`;
      await writePreviewSecret(record,{networkId:'preview',address:context.address,identifiers,transaction:Buffer.from(transaction.serialize()).toString('hex'),pendingReview:client?.pendingReview??null,opening:client?.pendingReview?client.getFeedbackOpening(client.pendingReview.receiptId):null});
      report.pendingSubmission={operation:stage,txId,identifiers,encryptedRecord:record};await save();
      submissionAttempts++;lastSubmittedId=await context.walletProvider.submitTx(transaction);
      if(loseNextResponse){loseNextResponse=false;throw new Error('Injected lost submission response');}
      return lastSubmittedId;
    }},
  };
  client=sdk.createNetworkClient(providers,{compiledAssetsPath,networkId:'preview'});
  async function confirmation(name,txId){
    const value=await bounded(publicDataProvider.watchForTxData(txId),180000);assert.equal(value.status,'SucceedEntirely');
    const calls=[],dustProofs=[];
    for(const intent of value.tx.intents.values())for(const action of intent.actions){
      if(action instanceof context.ledger.ContractCall)calls.push({entryPoint:typeof action.entryPoint==='string'?action.entryPoint:Buffer.from(action.entryPoint).toString('utf8'),proofBytes:action.proof?.serialize?.().length??action.proof?.length??0});
    }
    for(const intent of value.tx.intents.values())for(const spend of intent.dustActions?.spends??[])dustProofs.push(spend.proof?.serialize?.().length??spend.proof?.length??0);
    report.acceptedTransactions.push({operation:name,txId,blockHeight:String(value.blockHeight),status:value.status,contractCalls:calls,dustProofBytes:dustProofs});
    delete report.pendingSubmission;await save();output({stage:name,status:'accepted-on-public-preview',txId,blockHeight:String(value.blockHeight)});
  }
  async function accepted(name,fn){const result=await step(name,fn);await confirmation(name,result.txId);return result;}
  async function rejected(name,fn){const before={proofs:report.provingMetrics.proofs.length,submissionAttempts};let failed=false;try{await step(name,fn);}catch{failed=true;}assert.equal(failed,true);assert.equal(submissionAttempts,before.submissionAttempts);assert.equal(report.provingMetrics.proofs.length,before.proofs);report.rejectedBeforeSubmission.push(name);await save();}
  const deployment=await accepted('deploy',()=>client.deploy({marketplaceId,issuerIdentity}));
  report.contractAddress=deployment.contractAddress;report.marketplaceId=marketplaceId;report.issuerIdentity=issuerIdentity;await save();
  await accepted('enroll-expert',()=>client.enrollExpert({credential,issuerSecret}));
  await accepted('create-task',()=>client.createTask({...task,ownerSecret}));
  const reviewInput={taskId:task.id,credential,feedback:'The cache check occurs before await. Cache the pending promise before awaiting it to prevent concurrent duplicate fetches.',scores:[2,2,4]};
  failNextProof=true;await rejected('proof-failure-clears-pending',()=>client.submitReview(reviewInput));assert.equal(client.pendingReview,null);
  loseNextResponse=true;let uncertain=false;
  try{await step('submit-review-lose-response',()=>client.submitReview(reviewInput));}catch{uncertain=true;}
  assert.equal(uncertain,true);assert.ok(client.pendingReview);const savedReceipt=client.pendingReview.receiptId;
  await rejected('pending-review-blocks-new-submission',()=>client.submitReview(reviewInput));
  await confirmation('submit-review',lastSubmittedId);
  const submissionsBeforeRecovery=submissionAttempts;
  const review=await step('recover-exact-review',()=>client.recoverPendingReview());
  assert.equal(review.receiptId,savedReceipt);assert.equal(review.receiptMatchesIndexedState,true);assert.equal(review.txId,undefined);assert.equal(client.pendingReview,null);assert.equal(submissionAttempts,submissionsBeforeRecovery);
  report.uncertainSubmissionRecovery={tested:true,receiptRecovered:true,resubmitted:false,transactionReferenceFabricated:false,pendingStatePersistedAutomatically:false};
  await rejected('duplicate-review',()=>client.submitReview(reviewInput));
  await rejected('wrong-task-owner',()=>client.approveReview({receiptId:review.receiptId,ownerSecret:sdk.randomHex32()}));
  await accepted('approve-review',()=>client.approveReview({receiptId:review.receiptId,ownerSecret}));
  await accepted('claim-entitlement',()=>client.claimReward({receiptId:review.receiptId,credential}));
  await rejected('duplicate-claim',()=>client.claimReward({receiptId:review.receiptId,credential}));
  await accepted('close-task',()=>client.closeTask({taskId:task.id,ownerSecret}));
  const joined=sdk.createNetworkClient(providers,{compiledAssetsPath,networkId:'preview'});
  await rejected('wrong-marketplace-identity',()=>joined.join({contractAddress:client.contractAddress,marketplaceId:sdk.randomHex32(),issuerIdentity}));
  await joined.join({contractAddress:client.contractAddress,marketplaceId,issuerIdentity});
  const checked=await joined.checkReceipt(review);assert.equal(checked.receiptMatchesIndexedState,true);assert.equal(checked.currentStatus,'claimed');
  const final=await joined.readState();assert.equal(final.expertsEnrolled,1);assert.equal(final.tasks.length,1);assert.equal(final.tasks[0].closed,true);assert.equal(final.reviews.length,1);assert.equal(final.claims,1);
  assert.equal(report.provingMetrics.proofs.filter(p=>p.circuit==='midnight/dust/spend').length,7);
  for(const circuit of ['enroll','createTask','submitReview','approveReview','claimReward','closeTask'])assert.equal(report.provingMetrics.proofs.filter(p=>p.circuit===circuit).length,1);
  report.finalState={experts:1,tasks:1,reviews:1,claims:1,taskClosed:true};report.receiptCheck=checked;
  await writeFile(join(directory,'public-record.json'),JSON.stringify(final,null,2)+'\n');
  report.status='passed';report.completedAt=new Date().toISOString();delete report.currentStage;await save();
  output({status:'passed',acceptedTransactions:report.acceptedTransactions.length,rejectedBeforeSubmission:report.rejectedBeforeSubmission.length,evidence:`artifacts/preview-wasm/${runId}/evidence.json`});
}catch(error){
  report.status='failed';report.failedStage=stage;report.failedAt=new Date().toISOString();
  const message=String(error?.message??'');report.failureCategory=/deadline|timeout/i.test(message)?'timeout-outcome-uncertain':/proof|prover|verif|worker/i.test(message)?'proving-or-worker':/dust|fund|balance/i.test(message)?'wallet-funding-or-balancing':/connect|fetch|socket/i.test(message)?'connection':'operation-failed-details-withheld';
  await save();output({status:'failed',stage,category:report.failureCategory,evidence:`artifacts/preview-wasm/${runId}/evidence.json`});process.exitCode=1;
}finally{
  clearInterval(timer);if(context){await context.checkpoint().catch(()=>{});await context.close();}if(db)await bounded(db.close(),20000).catch(()=>{});
}
// Upstream worker requests leave ten-minute timeout handles after completion.
// Wallet and database have been explicitly stopped before ending this runner.
process.exit(process.exitCode??0);
