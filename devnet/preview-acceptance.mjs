/** Real PUBLIC PREVIEW test-wallet funding, DUST registration and contract calls.
 * Only the dedicated DPAPI-encrypted test seed is accepted. No genesis fixture,
 * mainnet, external seed, remote prover or plaintext private-state export.
 * Official reference: https://docs.midnight.network/guides/acquire-tokens
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadPreviewSeed,readPreviewSecret,writePreviewSecret} from './preview-wallet.mjs';
import {stageRuntime} from './stage-runtime.mjs';
import {loadPreviewCheckpoint,savePreviewCheckpoint,restorePreviewWallet,previewSyncProgress,requirePreviewEndpoints} from './preview-state.mjs';
import {previewTransactionPreflight} from './preview-preflight.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=join(root,'artifacts/public-preview');
const evidencePath=join(directory,'network-evidence.json');
export const PREVIEW_ENVIRONMENT=Object.freeze({networkId:'preview',walletNetworkId:'preview',node:'https://rpc.preview.midnight.network',nodeWS:'wss://rpc.preview.midnight.network',indexer:'https://indexer.preview.midnight.network/api/v4/graphql',indexerWS:'wss://indexer.preview.midnight.network/api/v4/graphql/ws',proofServer:'http://127.0.0.1:26300',faucet:undefined});
const output=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms=600000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Operation deadline exceeded')),ms);})]);}finally{clearTimeout(timer);}}
async function protectedValue(name,create){try{return await readPreviewSecret(name);}catch(error){if(error.code!=='ENOENT')throw error;const value=await create();await writePreviewSecret(name,value);return value;}}
async function optionalSecret(name){try{return await readPreviewSecret(name);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function queryPublicTransaction(identifier){
  const query='query($offset: TransactionOffset!) { transactions(offset: $offset) { hash ... on RegularTransaction { identifiers transactionResult { status } } block { height } } }';
  const response=await fetch(PREVIEW_ENVIRONMENT.indexer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables:{offset:{identifier}}}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Public indexer connection unavailable');
  const result=await response.json();if(result.errors||!Array.isArray(result.data?.transactions))throw new Error('Public indexer transaction query unavailable');
  return result.data.transactions.find(transaction=>transaction.identifiers?.includes(identifier))??null;
}
function safeErrorFacts(error){
  const tags=new Set(),codes=new Set(),signals=new Set(),seen=new Set();
  const allowedTags=new Set(['SubmissionError','ConnectionError','TransactionProgressError','TransactionInvalidError','TransactionDroppedError','TransactionUsurpedError','RpcError','Error','TimeoutException','Fail','Sequential','Parallel']);
  const patterns={invalid:/invalid transaction|transaction is invalid/i,payment:/payment|insufficient funds/i,proof:/bad.?proof|invalid proof|proof verification/i,expired:/expired|expiration|time.?to.?dismiss|outside.*validity/i,stale:/\bstale\b/i,future:/\bfuture\b/i,resources:/exhaust.*resources|out.of.gas/i,connection:/disconnect|connection|socket|fetch/i,rejected:/rejected|validation failed/i};
  function visit(value,depth=0){if(!value||typeof value!=='object'||seen.has(value)||depth>8)return;seen.add(value);for(const tag of [value._tag,value.name,value.constructor?.name])if(allowedTags.has(tag))tags.add(tag);if(Number.isSafeInteger(value.code))codes.add(value.code);for(const text of [value.message,typeof value.data==='string'?value.data:'']){if(typeof text!=='string')continue;for(const [name,pattern] of Object.entries(patterns))if(pattern.test(text))signals.add(name);const match=text.match(/custom error:\s*(\d+)/i);if(match)signals.add(`custom-code-${Number(match[1])}`);}for(const name of ['cause','error','left','right'])visit(value[name],depth+1);visit(value[Symbol.for('effect/Runtime/FiberFailure/Cause')],depth+1);}
  visit(error);return {tags:[...tags],codes:[...codes],signals:[...signals]};
}

/** Starts only the dedicated Preview wallet; no faucet or transaction action. */
export async function startPreviewWallet({onState=()=>{}}={}){
  requirePreviewEndpoints(PREVIEW_ENVIRONMENT);
  const [testkit,walletSdk,{default:pino},ledger,network,Rx,{default:WebSocket}]=await Promise.all([import('@midnight-ntwrk/testkit-js'),import('@midnight-ntwrk/wallet-sdk'),import('pino'),import('@midnight-ntwrk/midnight-js-protocol/ledger'),import('@midnight-ntwrk/midnight-js-network-id'),import('rxjs'),import('ws')]);
  testkit.logger.level='silent';
  const silent=pino({level:'silent'});
  network.setNetworkId('preview');globalThis.WebSocket=WebSocket;
  const seed=await loadPreviewSeed();
  const seeds=testkit.WalletSeeds.fromMasterSeed(Buffer.from(seed,'hex'));
  const keystore=walletSdk.createKeystore(seeds.unshielded,'preview');
  const address=keystore.getBech32Address().asString();
  if(!address.startsWith('mn_addr_preview1'))throw new Error('Dedicated wallet has the wrong network');
  const checkpoint=await loadPreviewCheckpoint(address);
  const built=checkpoint?await restorePreviewWallet({sdk:walletSdk,ledger,environment:PREVIEW_ENVIRONMENT,seeds,keystore,checkpoint}):await testkit.FluentWalletBuilder.forEnvironment(PREVIEW_ENVIRONMENT).withSeed(seed).withDustOptions({...testkit.DEFAULT_DUST_OPTIONS,additionalFeeOverhead:1000n}).buildWithoutStarting();
  const walletProvider=await testkit.MidnightWalletProvider.withWallet(silent,PREVIEW_ENVIRONMENT,built.wallet,ledger.ZswapSecretKeys.fromSeed(built.seeds.shielded),ledger.DustSecretKey.fromSeed(built.seeds.dust),built.keystore);
  await walletProvider.start(false);
  let latest=null,streamFailed=false;
  const subscription=built.wallet.state().subscribe({next:state=>{latest=state;onState({synced:state.isSynced===true,nightStar:String(state.unshielded.balances[ledger.unshieldedToken().raw]??0n),dustSpeck:String(state.dust.balance(new Date())),progress:previewSyncProgress(state)});},error:()=>{streamFailed=true;}});
  return {address,built,walletProvider,ledger,network,Rx,WebSocket,restoredCheckpointAt:checkpoint?.createdAt??null,
    checkpoint:()=>savePreviewCheckpoint(built.wallet,address),
    latest:()=>latest,
    async waitFor(test,timeoutMs=3600000){const end=Date.now()+timeoutMs;for(;;){if(streamFailed)throw new Error('Wallet state stream unavailable');if(latest&&test(latest))return latest;if(Date.now()>end)throw new Error('Wallet synchronization deadline exceeded');await delay(1000);}},
    async close(){subscription.unsubscribe();await bounded(walletProvider.stop(),20000).catch(()=>{});},
  };
}

export async function runPreviewAcceptance(command){
  if(!['--status','--wait-for-funding','--run'].includes(command))throw new Error('Use an explicit Preview operation');
  if(process.env.MN_TEST_WALLET_SEED||process.env.TEST_WALLET_SEED||process.env.WALLET_SEED)throw new Error('External wallet credentials are refused');
  const savedConsole=Object.fromEntries(['log','info','debug','warn','error','trace','dir'].map(name=>[name,console[name]]));
  for(const name of Object.keys(savedConsole))console[name]=()=>{};
  let context,db,timer,checkpointTimer,client,stage='prerequisites';
  let report;
  try{report=JSON.parse(await readFile(evidencePath,'utf8'));if(report.networkId!=='preview'||report.schema!=='reviewlab-public-preview-evidence/v1')throw new Error('Unexpected report scope');}
  catch(error){if(error.code!=='ENOENT')throw error;report={schema:'reviewlab-public-preview-evidence/v1',networkId:'preview',environment:'public-preview',createdAt:new Date().toISOString(),acceptedTransactions:[],networkSubmission:false,realLaceWalletTested:false,independentlyVerifiedChainInclusion:false,confirmationSource:'configured-public-preview-indexer'};}
  if(report.failedAt){report.previousFailures??=[];report.previousFailures.push({at:report.failedAt,stage:report.failedStage,category:report.failureCategory,facts:report.failureFacts});for(const key of ['failedAt','failedStage','failureCategory','failureFacts'])delete report[key];}
  report.status='running';report.lastStartedAt=new Date().toISOString();report.walletDustFeeOverheadSpeck='1000';
  const runSources={};for(const name of ['preview-acceptance.mjs','preview-state.mjs','preview-wallet.mjs','preview-preflight.mjs'])runSources[name]=createHash('sha256').update(await readFile(join(import.meta.dirname,name))).digest('hex');
  report.runs??=[];report.runs.push({startedAt:report.lastStartedAt,sourceHashes:runSources});
  let saveQueue=Promise.resolve();
  const save=()=>{const snapshot=JSON.stringify(report,null,2)+'\n';const operation=saveQueue.then(async()=>{await mkdir(directory,{recursive:true});const temporary=`${evidencePath}.${randomBytes(6).toString('hex')}.tmp`;await writeFile(temporary,snapshot,{flag:'wx'});await rename(temporary,evidencePath);});saveQueue=operation.catch(()=>{});return operation;};
  const checkpoint=async()=>{const saved=await context.checkpoint();report.walletCheckpoint=saved;await save();output({status:'encrypted-wallet-checkpoint-saved',...saved});};
  const step=async(name,fn,ms)=>{stage=name;report.currentStage=name;output({stage:name,status:'started'});await save();return bounded(Promise.resolve().then(fn),ms);};
  const accepted=async(name,txId,publicDataProvider)=>{
    const confirmation=await bounded(publicDataProvider.watchForTxData(txId),180000);
    assert.equal(confirmation.status,'SucceedEntirely');
    const identifiers=confirmation.identifiers??[txId];
    if(name==='deploy-marketplace'&&!report.contractAddress){const deployments=[...confirmation.tx.intents.values()].flatMap(intent=>intent.actions).filter(action=>action instanceof context.ledger.ContractDeploy);assert.equal(deployments.length,1);report.contractAddress=deployments[0].address;}
    const entry={operation:name,txId:identifiers.at(-1)??txId,identifiers,blockHeight:String(confirmation.blockHeight),status:confirmation.status};
    if(!report.acceptedTransactions.some(value=>identifiers.includes(value.txId)))report.acceptedTransactions.push(entry);
    report.networkSubmission=true;
    delete report.pendingSubmission;await save();output({...entry,status:'accepted-on-public-preview'});return entry;
  };
  try{
    const chain=await fetch(PREVIEW_ENVIRONMENT.node,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'system_chain',params:[]}),signal:AbortSignal.timeout(15000)}).then(response=>response.json());
    if(chain.result!=='Midnight Preview')throw new Error('Node is not public Preview');
    const [{indexerPublicDataProvider},{NodeZkConfigProvider},{httpClientProofProvider},{levelPrivateStateProvider},{Level},{validatePassword}]=await Promise.all([import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),import('@midnight-ntwrk/midnight-js-http-client-proof-provider'),import('@midnight-ntwrk/midnight-js-level-private-state-provider'),import('level'),import('@midnight-ntwrk/midnight-js-utils')]);
    context=await step('start-dedicated-preview-wallet',()=>startPreviewWallet({onState:state=>{report.walletState=state;}}));
    report.unshieldedAddress=context.address;
    report.restoredCheckpointAt=context.restoredCheckpointAt;
    checkpointTimer=setInterval(()=>checkpoint().catch(()=>{output({status:'wallet-checkpoint-unavailable',category:'private-details-withheld'});}),90000);
    timer=setInterval(()=>{output({stage,status:'waiting',walletState:report.walletState});save().catch(()=>{});},30000);
    const publicDataProvider=indexerPublicDataProvider(PREVIEW_ENVIRONMENT.indexer,PREVIEW_ENVIRONMENT.indexerWS,context.WebSocket);
    output({status:'dedicated-preview-wallet-started',unshieldedAddress:context.address});
    if(command==='--status'){
      await step('read-wallet-state',()=>context.waitFor(()=>true,60000));report.status='status-read';await save();return report;
    }
    await step('wait-for-faucet-night',()=>context.waitFor(state=>(state.unshielded.balances[context.ledger.unshieldedToken().raw]??0n)>0n),1200000);
    report.faucetFundsObserved=true;output({status:'faucet-night-observed',walletState:report.walletState});
    if(command==='--wait-for-funding'){report.status='funded';await save();return report;}
    await step('synchronize-preview-wallet',()=>context.built.wallet.waitForSyncedState(),3600000);
    await checkpoint();
    let missingLegacyTask=null,invalidTask=null;
    if(report.pendingSubmission){
      const pending={...report.pendingSubmission};
      if(pending.operation==='create-task'&&!pending.transactionSecret&&!report.createTaskReplacement){
        const checks=[];
        for(let attempt=0;attempt<3;attempt++){const found=await queryPublicTransaction(pending.txId);checks.push({checkedAt:new Date().toISOString(),found:Boolean(found)});if(found){await accepted(pending.operation,pending.txId,publicDataProvider);break;}if(attempt<2)await delay(5000);}
        if(report.pendingSubmission)missingLegacyTask={...pending,absenceChecks:checks};
      }else if(pending.transactionSecret){
        await step('recover-identical-submission',async()=>{
          if(!await queryPublicTransaction(pending.txId)){
            const saved=await readPreviewSecret(pending.transactionSecret);
            assert.equal(saved.networkId,'preview');assert.equal(saved.address,context.address);assert.deepEqual(saved.identifiers,pending.identifiers);
            const transaction=context.ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(saved.transaction,'hex'));
            assert.deepEqual(transaction.identifiers(),pending.identifiers);
            try{await previewTransactionPreflight(transaction,report);}
            catch(error){if(pending.operation==='create-task'&&error.message==='transaction is not in normal form'){invalidTask={...pending,localValidation:'NotNormalized',diagnosedAt:new Date().toISOString()};return;}throw error;}
            const intents=[...transaction.intents.values()];assert.ok(intents.length>0);assert.ok(intents.every(intent=>intent.ttl.getTime()>Date.now()),'Saved transaction expired; outcome must be reconciled');
            report.pendingSubmission.identicalResubmissions=(pending.identicalResubmissions??0)+1;await save();
            await context.walletProvider.submitTx(transaction);
          }
          await accepted(pending.operation,pending.txId,publicDataProvider);
        });
      }else await step('recover-previous-submission',()=>accepted(pending.operation,pending.txId,publicDataProvider));
    }
    const unregistered=context.latest().unshielded.availableCoins.filter(coin=>coin.utxo.type===context.ledger.unshieldedToken().raw&&coin.meta?.registeredForDustGeneration!==true);
    if(unregistered.length){
      const {fee}=await step('estimate-dust-registration',()=>context.built.wallet.estimateRegistration(unregistered));
      report.registrationFeeSpeck=String(fee);
      await step('wait-for-registration-fee-generation',()=>context.built.wallet.waitForGeneratedDust(unregistered,fee,{timeoutMs:1200000}),1260000);
      await step('register-test-night-for-dust',async()=>{
        const recipe=await context.built.wallet.registerNightUtxosForDustGeneration(unregistered,context.built.keystore.getPublicKey(),payload=>context.built.keystore.signData(payload));
        const transaction=await context.built.wallet.finalizeRecipe(recipe);
        const identifiers=transaction.identifiers(),txId=identifiers.at(-1);assert.ok(txId);
        report.pendingSubmission={operation:'register-test-night-for-dust',txId,identifiers,preparedAt:new Date().toISOString()};await save();
        await context.built.wallet.submitTransaction(transaction);report.networkSubmission=true;
        await accepted('register-test-night-for-dust',txId,publicDataProvider);
      });
    }
    await step('wait-for-usable-test-dust',()=>context.waitFor(state=>state.isSynced&&state.dust.balance(new Date())>1_000_000_000_000_000n),3600000);
    report.dustRegistrationObserved=true;
    const proverVersion=await fetch(`${PREVIEW_ENVIRONMENT.proofServer}/version`,{signal:AbortSignal.timeout(5000)}).then(response=>response.text());
    if(proverVersion.trim()!=='8.1.3')throw new Error('Local proof server version mismatch');
    const staged=await stageRuntime();report.sourceHashes=staged.hashes;
    report.runnerSourceSha256=runSources['preview-acceptance.mjs'];
    const sdk=await import(pathToFileURL(join(staged.runtime,'lib/network/sdk-client.mjs')).href);
    const plan=await protectedValue('reviewlab-plan-v1',async()=>{
      const marketplaceId=sdk.randomHex32(),now=Math.floor(Date.now()/1000);
      const title='Find the flaw in an AI code review';
      const prompt='Review this cache for concurrent duplicate requests: if (!cache.has(key)) cache.set(key, await fetchValue(key)); return cache.get(key);';
      const answer='This cache guarantees each key is fetched only once because the Map stores the result.';
      return {version:1,networkId:'preview',marketplaceId,issuerSecret:sdk.randomHex32(),ownerSecret:sdk.randomHex32(),credential:sdk.createCredential({marketplaceId,profession:'software',expiresAt:now+7*86400}),task:{id:sdk.randomHex32(),title,prompt,answer,profession:'software',deadline:now+2*86400,capacity:3,reward:100,contentDigest:await sdk.sha256Text(JSON.stringify({title,prompt,answer}))},feedback:'The Map check happens before await. Concurrent callers can miss the cache and fetch twice. Cache the pending promise before awaiting it.',scores:[2,2,4]};
    });
    if(plan.networkId!=='preview')throw new Error('Private plan has a different network scope');
    const password=await protectedValue('state-password',async()=>{for(;;){const value=`Review-${randomBytes(32).toString('base64url')}-P7!`;try{validatePassword(value);return value;}catch{}}});
    const privateStateProvider=levelPrivateStateProvider({midnightDbName:join(root,'.local/preview-private-state'),accountId:`preview:${context.address}`,privateStoragePasswordProvider:()=>password,levelFactory:name=>{db=new Level(name,{valueEncoding:'utf8'});return db;}});
    const compiledAssetsPath=join(root,'contracts/managed/reviewlab'),zkConfigProvider=new NodeZkConfigProvider(compiledAssetsPath);
    const underlyingProof=httpClientProofProvider(PREVIEW_ENVIRONMENT.proofServer,zkConfigProvider,{timeout:300000});
    const providers={privateStateProvider,publicDataProvider,zkConfigProvider,walletProvider:context.walletProvider,
      proofProvider:{async proveTx(transaction,options){const proven=await underlyingProof.proveTx(transaction,options);report.proofProviderCompletions=(report.proofProviderCompletions??0)+1;return proven;}},
      midnightProvider:{async submitTx(transaction){
        const identifiers=transaction.identifiers(),txId=identifiers.at(-1);assert.ok(txId);
        const preflight=await previewTransactionPreflight(transaction,report);report.localPreflights??=[];report.localPreflights.push({operation:stage,txId,...preflight});await save();
        if(client?.pendingReview){await protectedValue('review-pending-v1',async()=>({expectedReceipt:client.pendingReview.expectedReceipt,opening:client.getFeedbackOpening(client.pendingReview.receiptId)}));}
        const transactionSecret=`transaction-${Date.now()}-${randomBytes(4).toString('hex')}`;
        await writePreviewSecret(transactionSecret,{networkId:'preview',address:context.address,identifiers,transaction:Buffer.from(transaction.serialize()).toString('hex')});
        const deployments=[...transaction.intents.values()].flatMap(intent=>intent.actions).filter(action=>action instanceof context.ledger.ContractDeploy);
        report.pendingSubmission={operation:stage,txId,identifiers,transactionSecret,preparedAt:new Date().toISOString(),...(deployments.length===1?{contractAddress:deployments[0].address}:{})};await save();
        const result=await context.walletProvider.submitTx(transaction);report.networkSubmission=true;return result;
      }},
    };
    client=sdk.createNetworkClient(providers,{compiledAssetsPath,networkId:'preview'});
    const issuerIdentity=sdk.issuerIdentityFor(plan.issuerSecret);
    async function transact(name,fn){const result=await step(name,fn);await accepted(name,result.txId,publicDataProvider);return result;}
    if(report.contractAddress){await client.join({contractAddress:report.contractAddress,marketplaceId:plan.marketplaceId,issuerIdentity});}
    else{const deployment=await transact('deploy-marketplace',()=>client.deploy({marketplaceId:plan.marketplaceId,issuerIdentity}));report.contractAddress=deployment.contractAddress;report.marketplaceId=plan.marketplaceId;report.issuerIdentity=issuerIdentity;await save();}
    let state=await client.readState();
    if(invalidTask){
      assert.equal(state.tasks.some(task=>task.id===plan.task.id),false,'Planned task is already present');
      assert.equal(await queryPublicTransaction(invalidTask.txId),null,'Previous submission is now indexed');
      report.submissionAttempts??=[];report.submissionAttempts.push({...invalidTask,outcome:'locally-invalid-not-normalized-not-indexed'});
      report.normalFormCorrection={taskId:plan.task.id,previousTxId:invalidTask.txId,walletDustFeeOverheadSpeck:'1000',supportedConfiguration:true,upstreamIssue:'https://github.com/midnightntwrk/midnight-wallet/issues/700'};
      delete report.pendingSubmission;await save();
    }
    if(missingLegacyTask){
      await context.built.wallet.waitForSyncedState();state=await client.readState();
      const found=await queryPublicTransaction(missingLegacyTask.txId),existing=state.tasks.find(task=>task.id===plan.task.id);
      if(found)await accepted('create-task',missingLegacyTask.txId,publicDataProvider);
      else if(existing)throw new Error('Planned task exists but original submission outcome is uncertain');
      else{
        // Compact createTask asserts !tasks.member(taskId) and inserts that ID.
        // Competing attempts cannot both create a task. The dedicated test run
        // authorizes one replacement with the exact same encrypted task plan.
        report.submissionAttempts??=[];report.submissionAttempts.push({...missingLegacyTask,outcome:'unknown-not-indexed',lastCheckedAt:new Date().toISOString()});
        report.createTaskReplacement={originalTxId:missingLegacyTask.txId,taskId:plan.task.id,authorizedPolicy:'one-identical-task-replacement-contract-rejects-duplicate-id',preparedAt:new Date().toISOString()};
        delete report.pendingSubmission;await save();
      }
    }
    if(state.expertsEnrolled===0)await transact('enroll-expert',()=>client.enrollExpert({credential:plan.credential,issuerSecret:plan.issuerSecret}));
    state=await client.readState();
    if(!state.tasks.some(task=>task.id===plan.task.id))await transact('create-task',()=>client.createTask({...plan.task,ownerSecret:plan.ownerSecret}));
    const savedReview=await optionalSecret('review-pending-v1');
    state=await client.readState();let review=savedReview?state.reviews.find(item=>item.taskId===plan.task.id&&item.receiptId===savedReview.expectedReceipt.receiptId):null;
    if(!review){review=await transact('submit-review',()=>client.submitReview({taskId:plan.task.id,credential:plan.credential,feedback:plan.feedback,scores:plan.scores}));await protectedValue('feedback-opening-v1',async()=>client.getFeedbackOpening(review.receiptId));}
    state=await client.readState();review=state.reviews.find(item=>item.receiptId===review.receiptId);
    if(review.status==='submitted')await transact('approve-review',()=>client.approveReview({receiptId:review.receiptId,ownerSecret:plan.ownerSecret}));
    state=await client.readState();review=state.reviews.find(item=>item.receiptId===review.receiptId);
    if(review.status==='approved')await transact('claim-entitlement',()=>client.claimReward({receiptId:review.receiptId,credential:plan.credential}));
    state=await client.readState();
    if(!state.tasks.find(task=>task.id===plan.task.id).closed)await transact('close-task',()=>client.closeTask({taskId:plan.task.id,ownerSecret:plan.ownerSecret}));
    const final=await client.readState();
    const finalReview=final.reviews.find(item=>item.receiptId===review.receiptId&&item.taskId===plan.task.id),finalTask=final.tasks.find(item=>item.id===plan.task.id);
    assert.ok(final.claims>=1);assert.equal(finalReview.status,'claimed');assert.equal(finalTask.closed,true);
    report.receiptCheck=await client.checkReceipt(review.receiptId);report.finalState={credentials:final.expertsEnrolled,tasks:final.tasks.length,reviews:final.reviews.length,claims:final.claims,closed:finalTask.closed,taskId:plan.task.id,receiptId:review.receiptId};
    const publicTask=Object.fromEntries(['id','title','prompt','answer','contentDigest'].map(key=>[key,plan.task[key]]));
    const joinFile={version:1,kind:'reviewlab-network-marketplace',networkId:'preview',contractAddress:report.contractAddress,marketplaceId:plan.marketplaceId,issuerIdentity,tasks:[publicTask]};
    await writeFile(join(directory,'marketplace.json'),JSON.stringify(joinFile,null,2)+'\n');
    await writeFile(join(directory,'public-record.json'),JSON.stringify(final,null,2)+'\n');
    report.status='passed';report.completedAt=new Date().toISOString();report.rewardPaymentExecuted=false;report.sponsorServiceUsed=false;delete report.currentStage;await save();
    output({status:'passed',networkId:'preview',contractAddress:report.contractAddress,acceptedTransactions:report.acceptedTransactions.length,evidence:'artifacts/public-preview/network-evidence.json'});return report;
  }catch(error){report.status='failed';report.failedStage=stage;const message=String(error?.message??'');report.failureCategory=/timeout|deadline/i.test(message)?'timeout-outcome-uncertain':/proof|prover|verif/i.test(message)?'proof-or-verification':/dust|fund|balance/i.test(message)?'wallet-funding-or-balancing':/connect|fetch|socket|ECONN/i.test(message)?'service-connection':'operation-failed-details-withheld';report.failureFacts=safeErrorFacts(error);report.failedAt=new Date().toISOString();await save();output({status:'failed',stage,category:report.failureCategory,facts:report.failureFacts});throw new Error('Public Preview run did not complete; see sanitized evidence');}
  finally{clearInterval(timer);clearInterval(checkpointTimer);if(context){await checkpoint().catch(()=>{output({status:'wallet-checkpoint-unavailable',category:'private-details-withheld'});});await context.close();}if(db)await bounded(db.close(),20000).catch(()=>{});await saveQueue;Object.assign(console,savedConsole);}
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  try{if(process.argv.length!==3)throw new Error('Explicit command required');await runPreviewAcceptance(process.argv[2]);}
  catch{process.stderr.write('Public Preview operation ended without completion; private details withheld.\n');process.exitCode=1;}
}
