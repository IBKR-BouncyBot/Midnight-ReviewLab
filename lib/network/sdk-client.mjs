/** Real Midnight.js 4.1.1 client. Provider/witness scoping adapted from
 * Midnight BallotLab by IBKR-BouncyBot (PolyForm Noncommercial 1.0.0).
 * No connection or transaction occurs on import. Indexer observations are not
 * independently authenticated chain-inclusion proofs.
 */
import {deployContract,findDeployedContract} from '@midnight-ntwrk/midnight-js-contracts';
import {CompiledContract} from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {getNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import * as Native from '../../contracts/managed/reviewlab/contract/index.js';
import {PROFESSIONS,nativeWitnesses,sha256Text} from '../native-engine.mjs';
import {requireDevelopmentNetwork} from './config.mjs';
export {sha256Text};

const PRIVATE_STATE_ID='reviewLabTransientWitnessStateV1';
const HEX=/^[0-9a-f]{64}$/;
const statuses=['submitted','approved','claimed'];
const hex=value=>Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
export function randomHex32(){return hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));}
function bytes(value,name='value'){
  if(typeof value!=='string'||!HEX.test(value)||/^0+$/.test(value))throw new TypeError(`${name} must be a nonzero 32-byte lowercase hexadecimal value`);
  return Uint8Array.from(value.match(/../g),part=>parseInt(part,16));
}
function integer(value,name,min=0,max=Number.MAX_SAFE_INTEGER){
  if(!Number.isSafeInteger(value)||value<min||value>max)throw new TypeError(`${name} is out of range`);
  return BigInt(value);
}
function skill(profession){
  if(!Object.hasOwn(PROFESSIONS,profession))throw new TypeError('Unsupported profession');
  return BigInt(PROFESSIONS[profession]);
}
function ratings(values){
  if(!Array.isArray(values)||values.length!==3)throw new TypeError('Three scores are required');
  return values.map(value=>integer(value,'Score',1,5));
}
export function issuerIdentityFor(secret){return hex(Native.pureCircuits.issuerIdentity(bytes(secret,'Issuer secret')));}
export function createCredential({marketplaceId,profession,expiresAt}){
  bytes(marketplaceId,'Marketplace id');skill(profession);integer(expiresAt,'Credential expiry',1);
  return {version:1,marketplaceId,secret:randomHex32(),profession,expiresAt};
}
export function credentialCommitment(credential){
  if(!credential||credential.version!==1)throw new TypeError('Unsupported credential');
  return hex(Native.pureCircuits.memberIdentity(bytes(credential.marketplaceId,'Marketplace id'),bytes(credential.secret,'Expert secret'),skill(credential.profession),integer(credential.expiresAt,'Credential expiry',1)));
}
const txDTO=tx=>({txId:tx.public.txId,blockHeight:String(tx.public.blockHeight),confirmationSource:'configured-indexer',ledgerInclusionIndependentlyVerified:false});
const safeNumber=(value,name)=>{const number=Number(value);integer(number,name);return number;};
function taskDTO(id,task){
  return {id:hex(id),profession:Object.keys(PROFESSIONS).find(name=>BigInt(PROFESSIONS[name])===task.profession),deadline:safeNumber(task.deadline,'Deadline'),capacity:safeNumber(task.capacity,'Capacity'),reward:safeNumber(task.reward,'Reward'),contentDigest:hex(task.contentDigest),accepted:safeNumber(task.accepted,'Accepted reviews'),closed:task.closed};
}
function receiptDTO(marketplaceId,id,review,context){
  return {version:1,mode:'network',...context,marketplaceId,taskId:hex(review.taskId),taskContentDigest:hex(review.taskContentDigest),receiptId:hex(id),nullifier:hex(review.nullifier),feedbackCommitment:hex(review.feedbackCommitment),scores:review.scores.map(Number),status:statuses[Number(review.status)]};
}
function requireReceiptDigest(state,id){
  if(!state.reviews.member(id))throw new Error('Receipt not found in indexed contract state');
  const review=state.reviews.lookup(id);
  if(!state.tasks.member(review.taskId))throw new Error('Indexed receipt has no matching task');
  const task=state.tasks.lookup(review.taskId);
  if(hex(task.contentDigest)!==hex(review.taskContentDigest))throw new Error('Indexed receipt task content does not match');
  const expected=Native.pureCircuits.receiptDigest(state.marketplaceId,review.taskId,review.taskContentDigest,review.nullifier,review.feedbackCommitment,review.scores);
  if(hex(expected)!==hex(id)||!state.spent.member(review.nullifier))throw new Error('Indexed receipt is inconsistent');
  if(!statuses[Number(review.status)])throw new Error('Invalid indexed review status');
  return review;
}

export function createNetworkClient(providers,{compiledAssetsPath,networkId,assertSession=async()=>{}}){
  requireDevelopmentNetwork(networkId);
  if(typeof compiledAssetsPath!=='string'||!compiledAssetsPath)throw new TypeError('Compiled assets path required');
  if(typeof assertSession!=='function')throw new TypeError('Session validator required');
  for(const name of ['privateStateProvider','publicDataProvider','zkConfigProvider','proofProvider','walletProvider','midnightProvider'])if(!providers?.[name])throw new TypeError(`Missing provider: ${name}`);
  const requireNetwork=()=>{if(getNetworkId()!==networkId)throw new Error('Network changed; reconnect before continuing');};
  requireNetwork();
  let handle=null,address=null,identity=null,activeInputs=null,busy=false,pending=null,submissionAttempted=false,lastTransaction=null;
  const routedProviders={...providers,midnightProvider:{
    async submitTx(...args){submissionAttempted=true;return providers.midnightProvider.submitTx(...args);},
  }};
  const openings=new Map();
  const scopedWitnesses=Object.fromEntries(Object.entries(nativeWitnesses).map(([name,read])=>[name,context=>{
    if(!activeInputs)throw new Error('No active private witness scope');
    const [,value]=read({...context,privateState:activeInputs});
    return [context.privateState,value];
  }]));
  const compiled=CompiledContract.make('reviewlab',Native.Contract).pipe(CompiledContract.withWitnesses(scopedWitnesses),CompiledContract.withCompiledFileAssets(compiledAssetsPath));
  async function exclusive(operation){
    if(busy)throw new Error('A network operation is already in progress');busy=true;
    try{requireNetwork();await assertSession();return await operation();}
    finally{activeInputs=null;busy=false;}
  }
  async function ledger(){
    if(!handle||!address||!identity)throw new Error('Deploy or join a marketplace first');
    const state=await providers.publicDataProvider.queryContractState(address);
    if(state===null)throw new Error('The indexer did not return contract state');
    const result=Native.ledger(state.data);
    if(hex(result.marketplaceId)!==identity.marketplaceId||hex(result.issuer)!==identity.issuerIdentity)throw new Error('Indexed marketplace identity does not match the pinned deployment');
    return result;
  }
  async function invoke(name,args,inputs={}){
    submissionAttempted=false;requireNetwork();await assertSession();activeInputs=inputs;
    const transaction=txDTO(await handle.callTx[name](...args));
    lastTransaction={operation:name,...transaction,...context()};return transaction;
  }
  const context=()=>({networkId,contractAddress:address});
  function project(state){
    return {version:1,kind:'reviewlab-network-record',mode:'network',...context(),...identity,confirmationSource:'configured-indexer',ledgerInclusionIndependentlyVerified:false,
      expertsEnrolled:safeNumber(state.enrolled.size(),'Credential count'),tasks:Array.from(state.tasks,([id,task])=>taskDTO(id,task)),
      reviews:Array.from(state.reviews,([id])=>receiptDTO(identity.marketplaceId,id,requireReceiptDigest(state,id),context())),claims:safeNumber(state.totalClaims,'Claim count')};
  }
  function credentialInputs(credential,state){
    if(!credential||credential.marketplaceId!==identity.marketplaceId)throw new Error('Credential belongs to another marketplace');
    const commitment=bytes(credentialCommitment(credential));
    const eligibilityPath=state.members.findPathForLeaf(commitment);
    if(!eligibilityPath)throw new Error('Credential is not enrolled in the indexed registry');
    return {expertSecret:bytes(credential.secret),profession:skill(credential.profession),validUntil:integer(credential.expiresAt,'Credential expiry',1),eligibilityPath};
  }
  async function recover(){
    if(!pending)throw new Error('There is no pending review');
    const state=await ledger(),id=bytes(pending.receiptId);
    const review=requireReceiptDigest(state,id);
    const result={...receiptDTO(identity.marketplaceId,id,review,context()),...pending.transaction,
      receiptMatchesIndexedState:true,recoveredFromIndexedState:true,submissionOutcomeKnown:Boolean(pending.transaction.txId),transactionReferenceVerified:false};
    pending=null;return result;
  }
  return Object.freeze({
    networkId,
    get contractAddress(){return address;},get marketplaceId(){return identity?.marketplaceId??null;},get issuerIdentity(){return identity?.issuerIdentity??null;},
    get pendingReview(){return pending?{...pending,transaction:{...pending.transaction},expectedReceipt:{...pending.expectedReceipt,scores:[...pending.expectedReceipt.scores]}}:null;},
    get lastConfirmedTransaction(){return lastTransaction?{...lastTransaction}:null;},
    get lastAcceptedTransaction(){return lastTransaction?{...lastTransaction}:null;},
    readPublicLedger:()=>exclusive(ledger),readState:()=>exclusive(async()=>project(await ledger())),
    async deploy({marketplaceId,issuerIdentity}){return exclusive(async()=>{
      if(handle)throw new Error('Client already has a marketplace');
      const market=bytes(marketplaceId,'Marketplace id'),issuer=bytes(issuerIdentity,'Issuer identity');
      submissionAttempted=false;
      const deployed=await deployContract(routedProviders,{compiledContract:compiled,privateStateId:PRIVATE_STATE_ID,initialPrivateState:{},args:[market,issuer]});
      handle=deployed;address=deployed.deployTxData.public.contractAddress;bytes(address,'Contract address');identity={marketplaceId,issuerIdentity};
      const result={...txDTO(deployed.deployTxData),...context(),...identity};lastTransaction={operation:'deploy',...result};return result;
    });},
    async join({contractAddress,marketplaceId,issuerIdentity}){return exclusive(async()=>{
      if(handle)throw new Error('Client already has a marketplace');
      bytes(contractAddress,'Contract address');bytes(marketplaceId,'Marketplace id');bytes(issuerIdentity,'Issuer identity');
      await providers.privateStateProvider.setContractAddress(contractAddress);
      const stored=await providers.privateStateProvider.get(PRIVATE_STATE_ID);
      try{
        handle=await findDeployedContract(routedProviders,{contractAddress,compiledContract:compiled,privateStateId:PRIVATE_STATE_ID,...(stored===null?{initialPrivateState:{}}:{})});
        address=contractAddress;identity={marketplaceId,issuerIdentity};await ledger();return {...context(),...identity};
      }catch(error){handle=null;address=null;identity=null;throw error;}
    });},
    async enrollExpert({credential,issuerSecret}){return exclusive(async()=>{
      const state=await ledger();if(credential?.marketplaceId!==identity.marketplaceId)throw new Error('Credential belongs to another marketplace');
      const member=bytes(credentialCommitment(credential));
      if(state.enrolled.member(member))throw new Error('Credential is already enrolled');
      if(issuerIdentityFor(issuerSecret)!==identity.issuerIdentity)throw new Error('Credential issuer required');
      return invoke('enroll',[member],{issuerSecret:bytes(issuerSecret)});
    });},
    async createTask({id=randomHex32(),profession,deadline,capacity,reward,contentDigest,ownerSecret}){return exclusive(async()=>{
      await ledger();const taskId=bytes(id,'Task id');
      const tx=await invoke('createTask',[taskId,skill(profession),integer(deadline,'Deadline',1),integer(capacity,'Capacity',1,1024),integer(reward,'Reward',1),bytes(contentDigest,'Content digest')],{ownerSecret:bytes(ownerSecret,'Owner secret')});
      // The successful SDK transaction confirms the constrained creation. A second
      // indexer read must not discard that outcome if its connection fails.
      return {...tx,task:{id,profession,deadline,capacity,reward,contentDigest,accepted:0,closed:false}};
    });},
    async submitReview({taskId,credential,feedback,scores}){return exclusive(async()=>{
      if(pending)throw new Error('Resolve the pending review before submitting another; its outcome may be uncertain');
      if(typeof feedback!=='string'||feedback.trim().length<1||feedback.length>20000)throw new TypeError('Feedback must contain 1 to 20,000 characters');
      const state=await ledger(),id=bytes(taskId,'Task id'),values=ratings(scores);
      if(!state.tasks.member(id))throw new Error('Unknown task');
      const task=state.tasks.lookup(id),inputs=credentialInputs(credential,state);
      if(inputs.profession!==task.profession)throw new Error('Credential profession does not match task');
      if(inputs.validUntil<task.deadline)throw new Error('Credential expires before task deadline');
      if(task.closed||task.accepted>=task.capacity)throw new Error('Task is closed or full');
      const nul=Native.pureCircuits.expertNullifier(state.marketplaceId,id,inputs.expertSecret);
      if(state.spent.member(nul))throw new Error('Credential already reviewed this task');
      const digest=bytes(await sha256Text(feedback)),salt=bytes(randomHex32());
      const commitment=Native.pureCircuits.feedbackCommitmentFor(digest,salt);
      const receiptId=hex(Native.pureCircuits.receiptDigest(state.marketplaceId,id,task.contentDigest,nul,commitment,values));
      pending={...context(),marketplaceId:identity.marketplaceId,taskId,receiptId,nullifier:hex(nul),transaction:{},
        expectedReceipt:{version:1,mode:'network-pending',...context(),marketplaceId:identity.marketplaceId,taskId,taskContentDigest:hex(task.contentDigest),receiptId,nullifier:hex(nul),feedbackCommitment:hex(commitment),scores:[...scores],status:'unconfirmed'}};
      openings.set(receiptId,{feedback,digest:hex(digest),salt:hex(salt)});
      try{pending.transaction=await invoke('submitReview',[id,values],{...inputs,feedbackDigest:digest,feedbackSalt:salt});}
      catch(error){
        // Only the SDK submission provider marks this boundary. Wallet/prover
        // rejection before it is reached permits a fresh attempt. A transport
        // failure after it is reached leaves the public pending identity intact.
        if(!submissionAttempted){pending=null;openings.delete(receiptId);}
        throw error;
      }
      return recover();
    });},
    recoverPendingReview:()=>exclusive(recover),
    async approveReview({receiptId,ownerSecret}){return exclusive(async()=>{
      const state=await ledger(),id=bytes(receiptId,'Receipt id');requireReceiptDigest(state,id);
      const tx=await invoke('approveReview',[id],{ownerSecret:bytes(ownerSecret,'Owner secret')});
      return {...receiptDTO(identity.marketplaceId,id,{...state.reviews.lookup(id),status:1n},context()),...tx};
    });},
    async claimReward({receiptId,credential}){return exclusive(async()=>{
      const state=await ledger(),id=bytes(receiptId,'Receipt id');requireReceiptDigest(state,id);
      if(credential?.marketplaceId!==identity.marketplaceId)throw new Error('Credential belongs to another marketplace');
      const tx=await invoke('claimReward',[id],{expertSecret:bytes(credential.secret,'Expert secret')});
      return {...receiptDTO(identity.marketplaceId,id,{...state.reviews.lookup(id),status:2n},context()),...tx};
    });},
    async closeTask({taskId,ownerSecret}){return exclusive(async()=>{
      const state=await ledger(),id=bytes(taskId,'Task id');const task=state.tasks.lookup(id);
      const tx=await invoke('closeTask',[id],{ownerSecret:bytes(ownerSecret,'Owner secret')});
      return {...tx,task:taskDTO(id,{...task,closed:true})};
    });},
    async checkReceipt(receipt){return exclusive(async()=>{
      const receiptId=typeof receipt==='string'?receipt:receipt?.receiptId;
      if(typeof receipt==='object'&&(receipt.networkId!==networkId||receipt.contractAddress!==address||receipt.marketplaceId!==identity?.marketplaceId))throw new Error('Receipt belongs to another marketplace or network');
      const state=await ledger(),id=bytes(receiptId,'Receipt id'),review=requireReceiptDigest(state,id);
      if(typeof receipt==='object'){
        const actual=receiptDTO(identity.marketplaceId,id,review,context());
        for(const key of ['taskId','taskContentDigest','nullifier','feedbackCommitment'])if(receipt[key]!==actual[key])throw new Error('Receipt contents do not match indexed state');
        if(JSON.stringify(receipt.scores)!==JSON.stringify(actual.scores))throw new Error('Receipt scores do not match indexed state');
      }
      return {receiptId,receiptMatchesIndexedState:true,currentStatus:statuses[Number(review.status)],...context(),confirmationSource:'configured-indexer',ledgerInclusionIndependentlyVerified:false,transactionReferenceVerified:false};
    });},
    getFeedbackOpening(receiptId){const opening=openings.get(receiptId);if(!opening)throw new Error('Private feedback opening unavailable in this session');return {...opening};},
  });
}
