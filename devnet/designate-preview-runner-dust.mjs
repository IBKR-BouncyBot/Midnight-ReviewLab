/** Optional SDK-assisted DUST funding for a LIVE isolated Lace Preview runner.
 * This is not evidence that Lace's DUST-registration UI works. Only the sponsor
 * wallet is opened; the recipient's public DUST address is sufficient. NIGHT
 * stays sponsor-owned. Registered NIGHT may be re-designated using only the
 * sponsor's DUST for fees. No contract call, coin split, external seed, remote
 * prover, or automatic submission retry is permitted.
 *
 * Review the request's origin in this repository's live CI artifact first.
 * Usage: node devnet/designate-preview-runner-dust.mjs --request <public.json>
 */
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {MidnightBech32m,DustAddress,UnshieldedAddress} from '@midnight-ntwrk/wallet-sdk-address-format';
import {toTxStatus} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {startPreviewWallet,PREVIEW_ENVIRONMENT} from './preview-acceptance.mjs';
import {writePreviewSecret} from './preview-wallet.mjs';
import {createLocalWasmProving} from './wasm-proving.mjs';

const root=resolve(import.meta.dirname,'..');
const reportDirectory=join(root,'artifacts/lace-ci-dust-designation');
const operationLock=join(root,'.local','preview-dust-designation.lock');
const MAX_NIGHT_STAR=3_000_000_000n; // 3,000 test NIGHT, never mainnet assets.
const LACE_PACKAGE_SHA256='bff973f7c741ccdbf91c4a1125d4d6da8e9a0b2384b6b1f51c6898b24c87e055';
const ID=/^[0-9a-f]{66}$/,HASH=/^[0-9a-f]{64}$/;
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
class FundingFailure extends Error {constructor(code){super(code);this.code=code;}}
function requireValue(condition,code){if(!condition)throw new FundingFailure(code);}
async function bounded(promise,ms,code){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new FundingFailure(code)),ms);})]);}finally{clearTimeout(timer);}}

async function boundedJson(response,expectedUrl,maximumBytes=262144){
  requireValue(response.ok&&!response.redirected&&response.url===expectedUrl&&response.body,'PUBLIC_ENDPOINT_UNAVAILABLE');
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maximumBytes){await reader.cancel();throw new FundingFailure('PUBLIC_RESPONSE_TOO_LARGE');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}catch{throw new FundingFailure('INVALID_PUBLIC_RESPONSE');}
}

async function requireLiveWorkflow(request){
  const url=`https://api.github.com/repos/IBKR-BouncyBot/Midnight-ReviewLab/actions/runs/${request.workflowRunId}`;
  const response=await fetch(url,{method:'GET',headers:{accept:'application/vnd.github+json','user-agent':'Midnight-ReviewLab-Preview-funding'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});
  const run=await boundedJson(response,url);
  requireValue(String(run.id)===request.workflowRunId&&run.repository?.full_name==='IBKR-BouncyBot/Midnight-ReviewLab'
    &&run.path==='.github/workflows/lace-preview.yml'&&run.head_branch==='main'&&run.event==='workflow_dispatch'
    &&run.status==='in_progress'&&run.conclusion===null,'LIVE_OWN_WORKFLOW_REQUIRED');
  requireValue(typeof run.head_sha==='string'&&/^[0-9a-f]{40}$/.test(run.head_sha)
    &&run.head_sha===request.sourceCommit,'INVALID_WORKFLOW_SOURCE');
  if(request.workflowRunAttempt!==undefined)requireValue(String(run.run_attempt)===request.workflowRunAttempt,'WORKFLOW_ATTEMPT_MISMATCH');
  return {checkedAt:new Date().toISOString(),sourceCommit:run.head_sha,runAttempt:String(run.run_attempt),status:'in_progress'};
}

function coinKey(coin){return `${coin.intentHash}:${coin.outputNo}`;}
function coinOwnedBy(value,owner){
  // Live SyncSchema preserves the indexer's Bech32m UnshieldedAddress, whereas
  // simulator/ledger UTXOs contain raw address hex. Accept only the same public
  // owner in either representation, with Preview checksum/network validation.
  if(value===owner)return true;
  if(typeof value!=='string'||!value.startsWith('mn_addr_preview1'))return false;
  try{
    const encoded=MidnightBech32m.parse(value);
    return encoded.network==='preview'&&encoded.asString()===value
      &&Buffer.from(encoded.decode(UnshieldedAddress,'preview').data).toString('hex')===owner;
  }catch{return false;}
}
function selectCoins(state,ledger,owner){
  requireValue(state?.isSynced===true&&Array.isArray(state.unshielded?.availableCoins),'SYNCED_WALLET_REQUIRED');
  const native=ledger.unshieldedToken().raw;
  const eligible=state.unshielded.availableCoins.filter(coin=>coinOwnedBy(coin.utxo?.owner,owner)&&coin.utxo.type===native
    &&typeof coin.meta?.registeredForDustGeneration==='boolean'&&typeof coin.utxo.value==='bigint'
    &&coin.utxo.value>0n&&coin.utxo.value<=MAX_NIGHT_STAR&&coin.meta.ctime instanceof Date&&Number.isFinite(coin.meta.ctime.getTime()));
  // Older outputs have had more time to generate the registration fee. Whole
  // coins only: an oversized output never triggers a transfer or split.
  eligible.sort((a,b)=>a.meta.ctime.getTime()-b.meta.ctime.getTime()||coinKey(a.utxo).localeCompare(coinKey(b.utxo)));
  // Keep the fee paths separate. Prefer first registration when possible;
  // otherwise use an explicitly reported, registered-only re-designation.
  const registered=!eligible.some(coin=>coin.meta.registeredForDustGeneration===false);
  const candidates=eligible.filter(coin=>coin.meta.registeredForDustGeneration===registered);
  const selected=[];let total=0n;
  for(const coin of candidates)if(selected.length<128&&total+coin.utxo.value<=MAX_NIGHT_STAR){selected.push(coin);total+=coin.utxo.value;}
  requireValue(selected.length>0&&total>0n&&total<=MAX_NIGHT_STAR,'NO_ELIGIBLE_OWN_NIGHT_WITHIN_CAP');
  requireValue(new Set(selected.map(coin=>coinKey(coin.utxo))).size===selected.length,'DUPLICATE_WALLET_COIN');
  return {selected,total,registrationMode:registered?'redesignation':'first-registration'};
}

function requireCoinsStillAvailable(state,selected,owner,native){
  requireValue(state?.isSynced===true,'SYNCED_WALLET_REQUIRED');
  const available=new Map(state.unshielded.availableCoins.map(coin=>[coinKey(coin.utxo),coin]));
  for(const coin of selected){
    const current=available.get(coinKey(coin.utxo));
    requireValue(current?.meta?.registeredForDustGeneration===coin.meta.registeredForDustGeneration&&coinOwnedBy(current.utxo.owner,owner)
      &&current.utxo.type===native&&current.utxo.value===coin.utxo.value,'SELECTED_NIGHT_NO_LONGER_AVAILABLE');
  }
}

function inspectDesignation(transaction,{selected,total,owner,nightKey,receiver,native,registrationMode},
  {sponsorFeeBalanced=false,requireProvenFees=false}={}){
  requireValue(transaction.rewards===undefined&&transaction.guaranteedOffer===undefined
    &&(transaction.fallibleOffer===undefined||transaction.fallibleOffer.size===0),'UNEXPECTED_SHIELDED_OR_REWARD_ACTION');
  requireValue(!sponsorFeeBalanced||registrationMode==='redesignation','UNEXPECTED_FEE_BALANCING');
  requireValue(transaction.intents instanceof Map&&transaction.intents.size===(sponsorFeeBalanced?2:1),'UNEXPECTED_INTENT_COUNT');
  const expected=new Map(selected.map(coin=>[coinKey(coin.utxo),coin.utxo]));
  let inputTotal=0n,outputTotal=0n,inputCount=0,outputCount=0,registrationCount=0,feeIntentCount=0,dustSpendCount=0,dustFeeSpeck=0n;
  const dustProofBytes=[];
  for(const intent of transaction.intents.values()){
    requireValue(intent.actions.length===0,'CONTRACT_ACTION_REFUSED');
    requireValue(intent.dustActions,'MISSING_DUST_ACTION');
    const registrations=intent.dustActions.registrations,spends=intent.dustActions.spends;
    if(registrations.length){
      requireValue(registrations.length===1&&spends.length===0,'UNEXPECTED_REGISTRATION_ACTION');
    }else{
      // The supported dust-only balancer creates exactly one extra intent,
      // without NIGHT/shielded/contract actions or another registration.
      requireValue(sponsorFeeBalanced&&spends.length>0&&intent.guaranteedUnshieldedOffer===undefined
        &&intent.fallibleUnshieldedOffer===undefined,'UNEXPECTED_FEE_INTENT');
      feeIntentCount++;
      for(const spend of spends){
        requireValue(typeof spend.vFee==='bigint'&&spend.vFee>0n,'INVALID_SPONSOR_DUST_FEE');
        dustSpendCount++;dustFeeSpeck+=spend.vFee;
        if(requireProvenFees){
          requireValue(spend.proof?.instance==='proof','MISSING_SPONSOR_DUST_PROOF');
          const bytes=spend.proof.serialize().byteLength;requireValue(bytes>0,'MISSING_SPONSOR_DUST_PROOF');dustProofBytes.push(bytes);
        }
      }
    }
    for(const registration of intent.dustActions.registrations){
      requireValue(registration.nightKey===nightKey&&registration.dustAddress===receiver.data
        &&typeof registration.allowFeePayment==='bigint'&&registration.allowFeePayment>=0n,'DUST_RECIPIENT_MISMATCH');
      if(registrationMode==='redesignation')requireValue(registration.allowFeePayment===0n,'REDESIGNATION_MUST_USE_SPONSOR_DUST');
      registrationCount++;
    }
    for(const offer of [intent.guaranteedUnshieldedOffer,intent.fallibleUnshieldedOffer]){
      if(!offer)continue;
      for(const input of offer.inputs){
        const coin=expected.get(coinKey(input));
        requireValue(coin&&input.owner===nightKey&&input.type===native&&input.value===coin.value,'UNEXPECTED_NIGHT_INPUT');
        expected.delete(coinKey(input));inputTotal+=input.value;inputCount++;
      }
      for(const value of offer.outputs){
        requireValue(value.owner===owner&&value.type===native&&typeof value.value==='bigint'&&value.value>0n,'NIGHT_TRANSFER_REFUSED');
        outputTotal+=value.value;outputCount++;
      }
    }
  }
  requireValue(registrationCount===1&&expected.size===0&&inputTotal===total&&outputTotal===total
    &&total<=MAX_NIGHT_STAR&&outputCount>0&&feeIntentCount===(sponsorFeeBalanced?1:0),'DESIGNATION_SCOPE_MISMATCH');
  return {nightInputCount:inputCount,nightOutputCount:outputCount,registrationCount,
    selectedNightStar:String(total),maximumNightStar:String(MAX_NIGHT_STAR),allNightReturnedToSponsor:true,
    contractCallCount:0,dustSpendCount,dustProofBytes,dustFeeSpeck:String(dustFeeSpeck),nightTransferredStar:'0'};
}

async function waitForIndexedSuccess(identifier,transactionHash){
  const query='query($offset: TransactionOffset!) { transactions(offset: $offset) { hash block { height hash } ... on RegularTransaction { identifiers transactionResult { status } } } }';
  const deadline=Date.now()+900000;
  while(Date.now()<deadline){
    const response=await fetch(PREVIEW_ENVIRONMENT.indexer,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({query,variables:{offset:{identifier}}}),redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000)});
    const result=await boundedJson(response,PREVIEW_ENVIRONMENT.indexer);
    requireValue(!result.errors?.length&&Array.isArray(result.data?.transactions)&&result.data.transactions.length<=10,'INVALID_INDEXER_RESPONSE');
    const matches=result.data.transactions.filter(tx=>tx.identifiers?.includes(identifier));
    requireValue(matches.length<=1,'INDEXED_TRANSACTION_IDENTITY_MISMATCH');
    if(matches.length){
      const tx=matches[0];requireValue(tx.hash===transactionHash,'INDEXED_TRANSACTION_IDENTITY_MISMATCH');
      requireValue(toTxStatus(tx.transactionResult)==='SucceedEntirely','INDEXED_TRANSACTION_NOT_SUCCESSFUL');
      requireValue(HASH.test(tx.block?.hash)&&/^[1-9][0-9]*$/.test(String(tx.block?.height)),'INVALID_INDEXER_BLOCK');
      return {indexerStatus:'SucceedEntirely',blockHeight:String(tx.block.height),blockHash:tx.block.hash,transactionHash:tx.hash};
    }
    await pause(2000);
  }
  throw new FundingFailure('SUBMISSION_OUTCOME_UNKNOWN');
}

async function main(args){
  let context,report,reportPath,feeDustKey,reportOwned=false,lockOwned=false,saveQueue=Promise.resolve(),exitCode=1;
  const originalConsole=new Map();
  for(const method of ['log','info','debug','warn','error','trace','dir','table']){originalConsole.set(method,console[method]);console[method]=()=>{};}
  const save=()=>{
    const serialized=JSON.stringify(report,null,2)+'\n';
    const operation=saveQueue.then(async()=>{
      const temporary=`${reportPath}.${randomBytes(6).toString('hex')}.tmp`;
      await writeFile(temporary,serialized,{flag:'wx'});await rename(temporary,reportPath);
    });saveQueue=operation.catch(()=>{});return operation;
  };
  try{
    requireValue(process.platform==='win32'&&args.length===2&&args[0]==='--request','INVALID_LOCAL_PREVIEW_OPERATION');
    requireValue(!['MN_TEST_WALLET_SEED','TEST_WALLET_SEED','WALLET_SEED'].some(name=>process.env[name]),'EXTERNAL_WALLET_CREDENTIALS_REFUSED');
    const bytes=await readFile(resolve(args[1]));requireValue(bytes.length>0&&bytes.length<32768,'INVALID_PUBLIC_REQUEST');
    const request=JSON.parse(bytes);
    requireValue(request?.networkId==='preview'&&request.laceVersion==='2.5.1'
      &&request.fundingMode==='sdk-dust-designation'&&request.requestedTestNight==='0'&&typeof request.workflowRunId==='string'
      &&/^[0-9]{1,24}$/.test(request.workflowRunId),'INVALID_PUBLIC_REQUEST');
    requireValue(typeof request.sourceCommit==='string'&&/^[0-9a-f]{40}$/.test(request.sourceCommit)
      &&request.packageSha256===LACE_PACKAGE_SHA256&&request.internalWasmSelectedAndSavedInUi===true,'INVALID_CI_PACKAGE_OR_MODE_PROVENANCE');
    if(request.workflowRunAttempt!==undefined)requireValue(typeof request.workflowRunAttempt==='string'&&/^[1-9][0-9]{0,8}$/.test(request.workflowRunAttempt),'INVALID_PUBLIC_REQUEST');
    requireValue(typeof request.dustAddress==='string'&&request.dustAddress.length<256&&request.dustAddress.startsWith('mn_dust_preview1'),'INVALID_PREVIEW_DUST_ADDRESS');
    const address=MidnightBech32m.parse(request.dustAddress);requireValue(address.network==='preview','INVALID_PREVIEW_DUST_ADDRESS');
    const receiver=address.decode(DustAddress,'preview'),recipient=address.asString();
    requireValue(typeof receiver.data==='bigint','INVALID_PREVIEW_DUST_ADDRESS');
    requireValue(recipient===request.dustAddress,'NONCANONICAL_DUST_ADDRESS');
    const workflow=await requireLiveWorkflow(request);
    await mkdir(reportDirectory,{recursive:true});
    const recipientHash=createHash('sha256').update(recipient).digest('hex');
    reportPath=join(reportDirectory,`${recipientHash}.json`);
    report={version:1,purpose:'SDK-assisted DUST generation designation only',networkId:'preview',laceVersion:'2.5.1',
      fundingMode:'sdk-dust-designation',requestedTestNight:'0',
      requestSourceCommit:request.sourceCommit,packageSha256:request.packageSha256,internalWasmSelectedAndSavedInUi:true,
      workflowRunId:request.workflowRunId,workflow,recipientDustAddress:recipient,requestSha256:createHash('sha256').update(bytes).digest('hex'),
      sourceSha256:createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
      status:'preparing',stage:'reserve-recipient',startedAt:new Date().toISOString(),maximumTestNight:3000,
      provingMode:'official local WASM',provingMetrics:{},nightTransfer:false,laceSeedAccess:false,
      laceRegistrationUiTested:false,marketplaceTransactionTested:false,submitAttempts:0,automaticRetry:false};
    // A report is a permanent per-recipient reservation, including failures.
    // In particular, an uncertain result cannot be retried by rerunning this CLI.
    try{await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});reportOwned=true;}
    catch(error){if(error?.code==='EEXIST')throw new FundingFailure('RECIPIENT_ALREADY_RESERVED');throw error;}
    await mkdir(join(root,'.local'),{recursive:true});
    try{await writeFile(operationLock,JSON.stringify({pid:process.pid,startedAt:report.startedAt})+'\n',{flag:'wx',mode:0o600});lockOwned=true;}
    catch(error){if(error?.code==='EEXIST')throw new FundingFailure('DESIGNATION_HELPER_ALREADY_ACTIVE');throw error;}
    report.stage='open-dedicated-sponsor';await save();
    const wasm=await createLocalWasmProving({zkConfigProvider:{get(){throw new FundingFailure('CONTRACT_PROOF_REFUSED');}},metrics:report.provingMetrics});
    context=await startPreviewWallet({localWasmProvingService:wasm.walletProvingService});
    const {wallet,keystore}=context.built,ledger=context.ledger;
    report.stage='synchronize-sponsor';await save();
    await context.waitFor(state=>state.isSynced===true,1200000);
    const state=await bounded(wallet.waitForSyncedState(),120000,'SPONSOR_SYNC_TIMEOUT');
    const owner=keystore.getAddress(),nightKey=keystore.getPublicKey(),native=ledger.unshieldedToken().raw;
    requireValue(owner===ledger.addressFromKey(nightKey),'SPONSOR_IDENTITY_MISMATCH');
    const sponsorDustAddress=await wallet.dust.getAddress();
    requireValue(sponsorDustAddress.data!==receiver.data,'SPONSOR_IS_NOT_LACE_RECIPIENT');
    const {selected,total,registrationMode}=selectCoins(state,ledger,owner);
    report.registrationMode=registrationMode;report.selectedNightStar=String(total);report.selectedCoinCount=selected.length;
    report.feeSource=registrationMode==='redesignation'?'dedicated-sponsor-existing-DUST':'selected-unregistered-NIGHT-generation';
    report.stage='wait-for-registration-fee';await save();
    const estimate=await bounded(wallet.estimateRegistration(selected),120000,'REGISTRATION_ESTIMATE_TIMEOUT');
    requireValue(typeof estimate.fee==='bigint'&&estimate.fee>=0n,'INVALID_REGISTRATION_FEE_ESTIMATE');
    report.estimatedFeeSpeck=String(estimate.fee);await save();
    if(registrationMode==='first-registration'){
      await wallet.waitForGeneratedDust(selected,estimate.fee,{timeoutMs:300000});
    }else{
      // Registered NIGHT does not provide an allowance for this operation.
      // Wait only for the sponsor's own usable DUST; no recipient secret enters
      // this process. The full balancing fee is checked below before balancing.
      await context.waitFor(value=>value.isSynced===true&&value.dust.balance(new Date())>=estimate.fee,300000);
    }
    const current=await bounded(wallet.waitForSyncedState(),120000,'SPONSOR_SYNC_TIMEOUT');
    requireCoinsStillAvailable(current,selected,owner,native);
    report.workflowBeforeBuild=await requireLiveWorkflow(request);
    report.stage='build-registration';await save();
    let recipe=await wallet.registerNightUtxosForDustGeneration(selected,nightKey,payload=>keystore.signData(payload),receiver);
    requireValue(recipe.type==='UNPROVEN_TRANSACTION','UNEXPECTED_REGISTRATION_RECIPE');
    const scope={selected,total,owner,nightKey,receiver,native,registrationMode};
    inspectDesignation(recipe.transaction,scope);
    const sponsorFeeBalanced=registrationMode==='redesignation';
    if(sponsorFeeBalanced){
      report.stage='balance-sponsor-dust-fee';await save();
      feeDustKey=ledger.DustSecretKey.fromSeed(context.built.seeds.dust);
      requireValue(feeDustKey.publicKey===sponsorDustAddress.data,'SPONSOR_DUST_KEY_MISMATCH');
      const shieldedSecretKeys=ledger.ZswapSecretKeys.fromSeed(context.built.seeds.shielded);
      const ttl=[...recipe.transaction.intents.values()][0].ttl;
      const fullFee=await bounded(wallet.estimateTransactionFee(recipe.transaction,feeDustKey,{ttl}),120000,'SPONSOR_FEE_ESTIMATE_TIMEOUT');
      requireValue(typeof fullFee==='bigint'&&fullFee>=0n,'INVALID_SPONSOR_FEE_ESTIMATE');
      report.estimatedTotalFeeSpeck=String(fullFee);await save();
      await context.waitFor(value=>value.isSynced===true&&value.dust.balance(new Date())>=fullFee,300000);
      // Official facade API: never enable unshielded or shielded balancing.
      recipe=await wallet.balanceUnprovenTransaction(recipe.transaction,{shieldedSecretKeys,dustSecretKey:feeDustKey},
        {ttl,tokenKindsToBalance:['dust']});
      requireValue(recipe.type==='UNPROVEN_TRANSACTION','UNEXPECTED_REGISTRATION_RECIPE');
      inspectDesignation(recipe.transaction,scope,{sponsorFeeBalanced:true});
      recipe=await wallet.signRecipe(recipe,payload=>keystore.signData(payload));
      requireValue(recipe.type==='UNPROVEN_TRANSACTION','UNEXPECTED_REGISTRATION_RECIPE');
    }
    const transaction=await wallet.finalizeRecipe(recipe);
    report.transactionScope=inspectDesignation(transaction,scope,{sponsorFeeBalanced,requireProvenFees:sponsorFeeBalanced});
    if(sponsorFeeBalanced){
      const requiredFee=await bounded(wallet.calculateTransactionFee(transaction),120000,'FINAL_FEE_CHECK_TIMEOUT');
      requireValue(typeof requiredFee==='bigint'&&requiredFee>=0n
        &&BigInt(report.transactionScope.dustFeeSpeck)>=requiredFee,'SPONSOR_FEE_COVERAGE_MISMATCH');
      report.finalRequiredFeeSpeck=String(requiredFee);report.sponsorDustKeyMatchedWallet=true;
    }
    const identifiers=transaction.identifiers();
    requireValue(Array.isArray(identifiers)&&identifiers.length>0&&identifiers.every(value=>ID.test(value)),'INVALID_TRANSACTION_IDENTIFIERS');
    const transactionHash=transaction.transactionHash();requireValue(HASH.test(transactionHash),'INVALID_TRANSACTION_HASH');
    report.txId=identifiers.at(-1);report.identifiers=identifiers;report.transactionHash=transactionHash;
    const encryptedRecord=`dust-designation-${Date.now()}-${randomBytes(4).toString('hex')}`;
    await writePreviewSecret(encryptedRecord,{networkId:'preview',purpose:'SDK-assisted DUST designation',sponsorAddress:context.address,
      recipientDustAddress:recipient,workflowRunId:request.workflowRunId,identifiers,transactionHash,
      transaction:Buffer.from(transaction.serialize()).toString('hex')});
    report.encryptedRecord=encryptedRecord;
    report.walletCheckpoint=await context.checkpoint();
    report.workflowBeforeSubmit=await requireLiveWorkflow(request);
    report.status='submission-outcome-pending';report.stage='submit-once';report.submitAttempts=1;report.submissionStartedAt=new Date().toISOString();
    await save(); // Durable intent + encrypted finalized bytes precede the only call.
    output({status:'submitting-preview-dust-designation',workflowRunId:request.workflowRunId,recipientDustAddress:recipient,selectedNightStar:String(total),txId:report.txId});
    try{
      const submittedId=await bounded(wallet.submitTransaction(transaction),300000,'SUBMISSION_RESPONSE_TIMEOUT');
      requireValue(identifiers.includes(submittedId),'SUBMISSION_IDENTIFIER_MISMATCH');report.submissionResponse='returned-known-identifier';
    }catch{report.submissionResponse='unavailable-or-rejected';}
    // A submission exception is not a reason to try again. Read-only indexing
    // may still confirm the single saved transaction after a lost response.
    report.stage='confirm-indexed-transaction';await save();
    Object.assign(report,await waitForIndexedSuccess(report.txId,transactionHash));
    report.status='accepted';report.stage='completed';report.completedAt=new Date().toISOString();await save();exitCode=0;
    output({status:'accepted-preview-dust-designation',txId:report.txId,blockHeight:report.blockHeight,recipientDustAddress:recipient,
      selectedNightStar:String(total),nightTransferredStar:'0',laceRegistrationUiTested:false});
  }catch(error){
    const code=error instanceof FundingFailure?error.code:'PREVIEW_DESIGNATION_NOT_COMPLETED';
    if(reportOwned){report.failureCode=code;report.failureAt=new Date().toISOString();if(report.submitAttempts===0)report.status='not-submitted';await save().catch(()=>{});}
    output({status:'preview-dust-designation-not-completed',code,automaticRetry:false,details:'Reconcile existing evidence before any further action; private diagnostics withheld.'});
  }finally{
    feeDustKey?.clear();
    if(context){
      try{const checkpoint=await context.checkpoint();if(reportOwned){report.walletCheckpoint=checkpoint;await save();}}
      catch{if(reportOwned){report.checkpointFailure=true;await save().catch(()=>{});}}
      await context.close().catch(()=>{});
    }
    await saveQueue;
    if(lockOwned)await unlink(operationLock).catch(()=>{});
    for(const [method,implementation] of originalConsole)console[method]=implementation;
  }
  return exitCode;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  process.exit(await main(process.argv.slice(2)));
}
