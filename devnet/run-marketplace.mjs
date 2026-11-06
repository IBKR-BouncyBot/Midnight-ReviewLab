/** Real isolated local-devnet transactions. Adapted from Midnight BallotLab's
 * validated wallet runner by IBKR-BouncyBot (PolyForm Noncommercial 1.0.0).
 * Genesis test credentials stay in memory; no private inputs/transactions/errors logged.
 */
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {stageRuntime} from './stage-runtime.mjs';
const directory=import.meta.dirname,root=resolve(directory,'..');
const evidenceDirectory=join(root,'artifacts/local-devnet'),evidencePath=join(evidenceDirectory,'network-evidence.json');
const env=Object.freeze({networkId:'undeployed',walletNetworkId:'undeployed',node:'http://127.0.0.1:29944',nodeWS:'ws://127.0.0.1:29944',indexer:'http://127.0.0.1:28088/api/v4/graphql',indexerWS:'ws://127.0.0.1:28088/api/v4/graphql/ws',proofServer:'http://127.0.0.1:26300',faucet:undefined});
const output=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let stage='prerequisites',walletProvider,db,privateDirectory,proofCompletions=0,submissionAttempts=0,failNextProof=false,failAfterSubmit=false,lastSubmittedId;
const evidence={executedAt:new Date().toISOString(),networkId:'undeployed',environment:'isolated-local-development-chain',confirmationSource:'configured-local-indexer',independentlyVerifiedChainInclusion:false,browserWalletTested:false,publicPreviewTransactionsTested:false,acceptedTransactions:[],rejectedBeforeSubmission:[],networkSubmission:false,status:'running'};
async function save(){evidence.proofTransactionsCompleted=proofCompletions;await mkdir(evidenceDirectory,{recursive:true});await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n');}
async function bounded(promise,timeoutMs=360000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation timeout')),timeoutMs);})]);}finally{clearTimeout(timer);}}
async function operation(name,fn){stage=name;evidence.currentStage=name;output({stage:name,status:'started'});await save();return bounded(fn());}
function category(error){const text=String(error?.message??'');if(/timeout/i.test(text))return 'timeout-outcome-uncertain';if(/dust|balance|fund|insufficient/i.test(text))return 'wallet-funding-or-balancing';if(/proof|prover|verif/i.test(text))return 'proof-or-verification';if(/connect|fetch|socket|ECONN/i.test(text))return 'service-connection';if(/assert|constraint|owner|credential/i.test(text))return 'contract-constraint';return 'operation-failed-details-withheld';}
async function blockTime(){const response=await fetch(env.indexer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'{ block { height timestamp } }'}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Indexer unavailable');const value=await response.json();if(value.errors||!Number.isFinite(value.data?.block?.timestamp))throw new Error('Indexer clock unavailable');return Math.floor(value.data.block.timestamp/1000);}
try{
  if(process.argv.length!==3||process.argv[2]!=='--isolated-local-devnet')throw new Error('Explicit isolated devnet flag required');
  if(process.env.MN_TEST_WALLET_SEED||process.env.TEST_WALLET_SEED)throw new Error('External wallet credentials refused');
  const staged=await stageRuntime();evidence.sourceHashes=staged.hashes;evidence.runnerSourceSha256=createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  const lock=JSON.parse(await readFile(join(directory,'package-lock.json'),'utf8'));
  evidence.lockfileSha256=createHash('sha256').update(await readFile(join(directory,'package-lock.json'))).digest('hex');
  evidence.versions=Object.fromEntries(['compact-runtime','midnight-js-contracts','testkit-js','wallet-sdk','ledger-v8','onchain-runtime-v3','zkir-v2'].map(name=>[name,lock.packages[`node_modules/@midnight-ntwrk/${name}`]?.version]));
  const [testkit,{default:pino},ledger,network,{NodeZkConfigProvider},{httpClientProofProvider},{indexerPublicDataProvider},{levelPrivateStateProvider},{Level},Rx,{default:WebSocket},{validatePassword},sdk]=await Promise.all([
    import('@midnight-ntwrk/testkit-js'),import('pino'),import('@midnight-ntwrk/midnight-js-protocol/ledger'),import('@midnight-ntwrk/midnight-js-network-id'),import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),import('@midnight-ntwrk/midnight-js-level-private-state-provider'),import('level'),import('rxjs'),import('ws'),import('@midnight-ntwrk/midnight-js-utils'),import(pathToFileURL(join(staged.runtime,'lib/network/sdk-client.mjs')).href)]);
  testkit.logger.level='silent';const silent=pino({level:'silent'});
  evidence.suppressedLibraryConsoleCalls=0;
  for(const method of ['log','debug','info','warn','error','trace','dir'])console[method]=()=>{evidence.suppressedLibraryConsoleCalls++;};
  globalThis.WebSocket=WebSocket;network.setNetworkId('undeployed');
  const fixture=new testkit.LocalTestEnvironment(silent);
  const built=await operation('build-synthetic-wallet',()=>testkit.FluentWalletBuilder.forEnvironment(env).withSeed(fixture.genesisMintWalletSeed[0]).buildWithoutStarting());
  walletProvider=await testkit.MidnightWalletProvider.withWallet(silent,env,built.wallet,ledger.ZswapSecretKeys.fromSeed(built.seeds.shielded),ledger.DustSecretKey.fromSeed(built.seeds.dust),built.keystore);
  await operation('start-wallet',()=>walletProvider.start(false));
  await operation('sync-wallet',()=>Rx.firstValueFrom(built.wallet.state().pipe(Rx.filter(value=>value.shielded.state.progress.isStrictlyComplete()&&value.dust.state.progress.isStrictlyComplete()&&value.unshielded.progress.isStrictlyComplete()),Rx.take(1),Rx.timeout(300000))));
  await operation('wait-for-generated-test-dust',async()=>{
    const state=await Rx.firstValueFrom(built.wallet.state().pipe(Rx.filter(value=>value.dust.availableCoins.length>0),Rx.take(1),Rx.timeout(300000)));
    const deadline=Date.now()+180000;while(state.dust.balance(new Date((await blockTime())*1000))<=0n){if(Date.now()>deadline)throw new Error('No spendable DUST');await delay(2000);}
  });
  privateDirectory=await mkdtemp(join(tmpdir(),'midnight-reviewlab-devnet-'));
  let password;for(;;){password=`Local-${randomBytes(32).toString('base64url')}-Q7!`;try{validatePassword(password);break;}catch{}}
  const privateStateProvider=levelPrivateStateProvider({midnightDbName:join(privateDirectory,'private-state'),accountId:walletProvider.getCoinPublicKey(),privateStoragePasswordProvider:()=>password,levelFactory:name=>{db=new Level(name,{valueEncoding:'utf8'});return db;}});
  const compiledAssetsPath=join(root,'contracts/managed/reviewlab'),zkConfigProvider=new NodeZkConfigProvider(compiledAssetsPath);
  const underlyingProof=httpClientProofProvider(env.proofServer,zkConfigProvider,{timeout:300000});
  const publicDataProvider=indexerPublicDataProvider(env.indexer,env.indexerWS,WebSocket);
  const providers={privateStateProvider,publicDataProvider,zkConfigProvider,walletProvider,
    proofProvider:{async proveTx(transaction,options){if(failNextProof){failNextProof=false;throw new Error('Intentional test prover rejection before submission');}const proven=await underlyingProof.proveTx(transaction,options);if(stage!=='deploy')proofCompletions++;return proven;}},
    midnightProvider:{async submitTx(transaction){submissionAttempts++;const txId=await walletProvider.submitTx(transaction);lastSubmittedId=txId;evidence.networkSubmission=true;evidence.pendingSubmission={operation:stage,txId};await save();if(failAfterSubmit){failAfterSubmit=false;throw new Error('Intentional test transport failure after submission');}return txId;}}};
  const client=sdk.createNetworkClient(providers,{compiledAssetsPath,networkId:'undeployed'});
  async function accepted(name,fn){const result=await operation(name,fn);assert.match(result.txId,/^[0-9a-f]+$/i);const confirmation=await bounded(publicDataProvider.watchForTxData(result.txId),60000);assert.equal(confirmation.status,'SucceedEntirely');evidence.acceptedTransactions.push({operation:name,txId:result.txId,blockHeight:String(confirmation.blockHeight),status:confirmation.status});delete evidence.pendingSubmission;await save();output({stage:name,status:'accepted-by-local-chain',txId:result.txId,blockHeight:String(confirmation.blockHeight)});return result;}
  async function rejected(name,fn){const before={proofCompletions,submissionAttempts};let failed=false;try{await operation(name,fn);}catch{failed=true;}assert.equal(failed,true);assert.equal(proofCompletions,before.proofCompletions);assert.equal(submissionAttempts,before.submissionAttempts);evidence.rejectedBeforeSubmission.push({operation:name,rejected:true,proofGenerated:false,submitted:false});await save();}
  const issuerSecret=sdk.randomHex32(),ownerSecret=sdk.randomHex32(),marketplaceId=sdk.randomHex32(),issuerIdentity=sdk.issuerIdentityFor(issuerSecret);
  const deployment=await accepted('deploy',()=>client.deploy({marketplaceId,issuerIdentity}));evidence.contractAddress=deployment.contractAddress;evidence.marketplaceId=marketplaceId;evidence.issuerIdentity=issuerIdentity;
  const now=Math.max(await blockTime(),Math.floor(Date.now()/1000));
  const credential=sdk.createCredential({marketplaceId,profession:'accounting',expiresAt:now+86400});
  await accepted('enroll-expert',()=>client.enrollExpert({credential,issuerSecret}));
  const taskId=sdk.randomHex32();
  await accepted('create-task',()=>client.createTask({id:taskId,profession:'accounting',deadline:now+3600,capacity:3,reward:25,contentDigest:sdk.randomHex32(),ownerSecret}));
  const reviewInput={taskId,credential,feedback:'The example answer needs an accrual adjustment and a supporting explanation.',scores:[3,2,5]};
  failNextProof=true;
  await rejected('reject-prover-before-submission',()=>client.submitReview(reviewInput));
  assert.equal(client.pendingReview,null);
  // Deliberately lose the submission response AFTER a real funded transaction
  // was sent. Recovery must use the original public commitment, never resubmit.
  failAfterSubmit=true;let uncertain=false;
  try{await operation('submit-review-response-lost',()=>client.submitReview(reviewInput));}catch{uncertain=true;}
  assert.equal(uncertain,true);assert.ok(client.pendingReview);assert.equal(client.pendingReview.expectedReceipt.mode,'network-pending');
  const recoveredConfirmation=await bounded(publicDataProvider.watchForTxData(lastSubmittedId),60000);
  assert.equal(recoveredConfirmation.status,'SucceedEntirely');
  evidence.acceptedTransactions.push({operation:'submit-review',txId:lastSubmittedId,blockHeight:String(recoveredConfirmation.blockHeight),status:recoveredConfirmation.status});
  const review=await operation('recover-submitted-review',()=>client.recoverPendingReview());
  assert.equal(review.receiptMatchesIndexedState,true);assert.equal(review.submissionOutcomeKnown,false);assert.equal(review.txId,undefined);assert.equal(client.pendingReview,null);
  evidence.uncertainSubmissionRecovery={tested:true,submittedOnce:true,receiptRecovered:true,transactionReferenceFabricated:false};
  delete evidence.pendingSubmission;await save();output({stage:'submit-review',status:'accepted-by-local-chain-response-recovered',txId:lastSubmittedId,blockHeight:String(recoveredConfirmation.blockHeight)});
  await rejected('reject-duplicate-review',()=>client.submitReview({taskId,credential,feedback:'Repeat',scores:[3,3,3]}));
  await rejected('reject-wrong-owner',()=>client.approveReview({receiptId:review.receiptId,ownerSecret:sdk.randomHex32()}));
  await accepted('approve-review',()=>client.approveReview({receiptId:review.receiptId,ownerSecret}));
  await accepted('claim-entitlement',()=>client.claimReward({receiptId:review.receiptId,credential}));
  await rejected('reject-duplicate-claim',()=>client.claimReward({receiptId:review.receiptId,credential}));
  await accepted('close-task',()=>client.closeTask({taskId,ownerSecret}));
  const joined=sdk.createNetworkClient(providers,{compiledAssetsPath,networkId:'undeployed'});
  await rejected('reject-wrong-marketplace-identity',()=>joined.join({contractAddress:client.contractAddress,marketplaceId:sdk.randomHex32(),issuerIdentity}));
  await joined.join({contractAddress:client.contractAddress,marketplaceId,issuerIdentity});
  const check=await joined.checkReceipt(review);assert.equal(check.receiptMatchesIndexedState,true);assert.equal(check.currentStatus,'claimed');
  const state=await joined.readState();assert.equal(state.expertsEnrolled,1);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].closed,true);assert.equal(state.reviews.length,1);assert.equal(state.claims,1);
  evidence.finalState={expertsEnrolled:1,tasks:1,reviews:1,claims:1,taskClosed:true};evidence.receipt=review;evidence.receiptCheck=check;evidence.rewardPaymentExecuted=false;evidence.sponsorServiceUsed=false;
  await writeFile(join(evidenceDirectory,'public-record.json'),JSON.stringify(state,null,2)+'\n');
  evidence.status='passed';evidence.completedAt=new Date().toISOString();delete evidence.currentStage;await save();output({status:'passed',acceptedTransactions:evidence.acceptedTransactions.length,rejectedBeforeSubmission:evidence.rejectedBeforeSubmission.length,evidence:'artifacts/local-devnet/network-evidence.json'});
}catch(error){evidence.status='failed';evidence.failedStage=stage;evidence.failureCategory=category(error);evidence.failedAt=new Date().toISOString();await save();output({status:'failed',stage,category:evidence.failureCategory,acceptedTransactions:evidence.acceptedTransactions.length});process.exitCode=1;}
finally{
  if(walletProvider)await bounded(walletProvider.stop(),20000).catch(()=>{});
  if(db)await bounded(db.close(),20000).catch(()=>{});
  if(privateDirectory&&dirname(resolve(privateDirectory))===resolve(tmpdir())&&basename(privateDirectory).startsWith('midnight-reviewlab-devnet-'))await rm(privateDirectory,{recursive:true,force:true}).catch(()=>{});
}
