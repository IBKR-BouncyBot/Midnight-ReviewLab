import { createNetworkClient, randomHex32, issuerIdentityFor, createCredential, sha256Text } from '../lib/network/sdk-client.mjs';
import { connectNativeBrowserProviders, nativeStoragePasswordMessage, nativeConnectionErrorMessage } from '../lib/network/browser-providers.mjs';
import { findNativeWallets, NETWORK_DEFAULTS, nativeNetworkErrorMessage } from '../lib/network/config.mjs';

const $ = id => document.getElementById(id);
const HEX = /^[0-9a-f]{64}$/;
const skills = ['software','accounting','science','legal','healthcare'];
const ownErrors = new WeakSet();
function invalid(message) { const error = new Error(message); ownErrors.add(error); throw error; }
function hex(value, label) { if (typeof value !== 'string' || !HEX.test(value) || /^0+$/.test(value)) invalid(`${label} must contain 64 lowercase hexadecimal characters and cannot be zero.`); return value; }
function exact(value, fields) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value,field)); }
const session = { ready:false, busy:false, connection:null, client:null, record:null, credential:null, opening:null, wallets:[], metadata:new Map(), pendingCredential:null };
const text = (id, value) => { $(id).textContent = value; };
function status(value) { text('action-status', value); }
function download(name, data) { const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})); const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function localDate(days) { const time=new Date(Date.now()+days*86400000);return new Date(time.getTime()-time.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function seconds(id) { const result=Math.floor(new Date($(id).value).getTime()/1000);if(!Number.isSafeInteger(result)||result<=Date.now()/1000)invalid('Choose a date and time in the future.');return result; }
function noteTransaction(label, result) {
  if (!result?.txId || result.blockHeight === undefined) invalid('The SDK did not return accepted transaction evidence. Refresh the contract state before retrying.');
  const row=document.createElement('li');row.textContent=`${label} · accepted by the configured indexer at block ${result.blockHeight} · transaction ${result.txId}`;$('transaction-log').prepend(row);
  status(`${label} accepted. Block ${result.blockHeight}.`);
}
function syncControls() {
  document.querySelectorAll('[data-ready]').forEach(el=>{el.disabled=!session.ready||session.busy;});
  document.querySelectorAll('[data-connected]').forEach(el=>{el.disabled=!session.connection||session.busy;});
  document.querySelectorAll('[data-contract]').forEach(el=>{el.disabled=!session.record||session.busy;});
  $('disconnect').disabled=!session.connection||session.busy;
  ['network-select','wallet-select','storage-password','indexer-url','indexer-ws','refresh-wallets'].forEach(id=>{if(session.connection)$(id).disabled=true;});
  $('connect-form').querySelector('button[type=submit],button:not([type])').disabled=!session.ready||session.busy||Boolean(session.connection)||session.wallets.length===0;
  $('download-credential').disabled=!session.credential||session.busy;
  $('download-opening').disabled=!session.opening||session.busy;
  $('recover-review').disabled=!session.client?.pendingReview||session.busy;
  $('refresh-state').disabled=!session.client?.contractAddress||session.busy;
  if(session.client?.contractAddress){$('deploy').disabled=true;$('join').disabled=true;}
}
async function action(label, fn) {
  if(session.busy)return;
  session.busy=true;syncControls();status(label);const previousTx=session.client?.lastAcceptedTransaction?.txId;
  try { await fn(); }
  catch(error) {
    const pending=session.client?.pendingReview;
    if(pending){$('receipt-id').value=pending.receiptId;session.opening=session.client.getFeedbackOpening(pending.receiptId);}
    const accepted=session.client?.lastAcceptedTransaction;
    if(accepted?.txId&&accepted.txId!==previousTx){
      if(!$('transaction-log').textContent.includes(accepted.txId))noteTransaction('Transaction',accepted);
      status('The transaction was accepted, but the follow-up state read failed. Use Refresh contract state before taking another action.');
    }else status(ownErrors.has(error)?error.message:nativeStoragePasswordMessage(error)??nativeConnectionErrorMessage(error)??nativeNetworkErrorMessage(error));
  } finally {session.busy=false;syncControls();}
}
const on = (id, fn, event='click') => $(id).addEventListener(event, ev=>{ev.preventDefault();action('Working…',()=>fn(ev));});
function view(name, focus=true) {
  const allowed=['connect','marketplace','review','receipts'];if(!allowed.includes(name))name='connect';
  document.querySelectorAll('[data-panel]').forEach(el=>{el.hidden=el.dataset.panel!==name;});
  document.querySelectorAll('[data-view]').forEach(el=>{if(el.dataset.view===name)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  history.replaceState(null,'',`#${name}`); // No network operation on navigation.
  if(focus)document.querySelector(`[data-panel="${name}"] h2`).focus({preventScroll:true});
}
document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>view(el.dataset.view)));
window.addEventListener('hashchange',()=>view(location.hash.slice(1),false));
function refreshWallets() {
  session.wallets=findNativeWallets();$('wallet-select').replaceChildren();
  for(const entry of session.wallets){const option=document.createElement('option');option.value=entry.id;option.textContent=`${entry.name} · API ${entry.apiVersion}`;$('wallet-select').append(option);}
  if(!session.wallets.length){const option=document.createElement('option');option.value='';option.textContent='No compatible Midnight wallet found';$('wallet-select').append(option);}
  text('wallet-note',session.wallets.length?'Select the wallet you want to use. Connecting does not submit a transaction.':'Install Midnight-enabled Lace in this browser, select Preview, then reload this page. Requires DApp Connector API 4.');syncControls();
}
function configuration() {return {networkId:$('network-select').value,indexerUri:$('indexer-url').value,indexerWsUri:$('indexer-ws').value,compiledAssetsUrl:'./network-contract'};}
function networkChanged() {
  const local=$('network-select').value==='undeployed';
    const defaults=NETWORK_DEFAULTS[$('network-select').value];
  $('indexer-url').value=defaults?.indexerUri??(local?'http://127.0.0.1:8089/api/v4/graphql':'https://indexer.preview.midnight.network/api/v4/graphql');
  $('indexer-ws').value=defaults?.indexerWsUri??(local?'ws://127.0.0.1:8089/api/v4/graphql/ws':'wss://indexer.preview.midnight.network/api/v4/graphql/ws');
  $('indexer-url').readOnly=!local;$('indexer-ws').readOnly=!local;
  $('endpoint-settings').open=local;
}
const STAGES={
  'connection-settings':'Checking the selected network settings…','connection-permission':'Approve the connection in your wallet…','connection-account':'Reading the wallet’s public account…','connection-network':'Checking the wallet network…','connection-local-prover':'Checking the wallet’s local proving service…','connection-providers':'Preparing Midnight providers…','connection-proving-provider':'Preparing the local proof provider…','connection-storage':'Opening the encrypted app key store…','wallet-connected':'Wallet connected. No transaction sent.','proving-provider-started':'Preparing proofs with the wallet’s local prover…','proving-provider-completed':'Proof provider completed. Waiting for wallet approval…','wallet-approval-requested':'Approve this testnet transaction in your wallet…','wallet-balanced':'Wallet balanced the transaction with test DUST…','submission-returned':'Transaction submitted. Waiting for indexer acceptance…',
};
async function connect() {
  const entry=session.wallets.find(value=>value.id===$('wallet-select').value);if(!entry)invalid('Select an installed Midnight wallet first.');
  const password=$('storage-password').value;
  const connection=await connectNativeBrowserProviders({wallet:entry.wallet,configuration:configuration(),passwordProvider:async()=>password,onStage:stage=>{if(STAGES[stage])status(STAGES[stage]);}});
  try {session.client=await createNetworkClient(connection.providers,{networkId:connection.networkId,compiledAssetsPath:connection.compiledAssetsPath,assertSession:connection.assertSession});}
  catch(error){connection.close();throw error;}
  session.connection=connection;$('storage-password').value='';text('connection-badge',`Wallet connected · ${connection.networkId}`);status('Wallet connected. Choose Set up marketplace to deploy or join a contract.');
}
function credentialStatus(){text('credential-status',session.credential?`Private ${session.credential.profession} credential loaded · expires ${new Date(session.credential.expiresAt*1000).toLocaleDateString()}.${session.pendingCredential?' Enrollment has not been confirmed. Save this credential before retrying.':''}`:'No private credential loaded.');}
function resetContract(){session.record=null;session.metadata.clear();session.credential=null;session.opening=null;session.pendingCredential=null;credentialStatus();text('contract-badge','No contract selected');text('state-summary','No contract state loaded.');$('receipt-list').replaceChildren();renderTasks();}
function renderTasks(){
  const current=$('review-task').value;$('review-task').replaceChildren();
  for(const task of session.record?.tasks??[]){const option=document.createElement('option');option.value=task.id;option.textContent=`${session.metadata.get(task.id)?.title??task.id.slice(0,12)} · ${task.profession}${task.closed?' · closed':''}`;$('review-task').append(option);}
  if([...(session.record?.tasks??[])].some(task=>task.id===current))$('review-task').value=current;
  if(!session.record?.tasks.length){const option=document.createElement('option');option.value='';option.textContent='No tasks in this contract';$('review-task').append(option);}
  renderTaskContent();
}
function addText(parent,tag,value){const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;}
function renderTaskContent(){
  const area=$('task-content');area.replaceChildren();const task=session.record?.tasks.find(item=>item.id===$('review-task').value);if(!task){addText(area,'p','Create a task or load public marketplace details to see an AI evaluation.');return;}
  $('close-task-id').value=task.id;const details=session.metadata.get(task.id);
  addText(area,'p',`${task.accepted}/${task.capacity} reviews · ${task.reward} entitlement units · closes ${new Date(task.deadline*1000).toLocaleString()}`);
  if(!details){addText(area,'p','Task text is not loaded. Import the owner’s public marketplace file in step 2 before submitting a review.');return;}
  addText(area,'h4','Prompt');addText(area,'p',details.prompt);addText(area,'h4','AI answer');addText(area,'p',details.answer);
}
async function refreshState(){
  const record=await session.client.readState();session.record=record;
  for(const [id,meta] of session.metadata){if(!record.tasks.some(task=>task.id===id&&task.contentDigest===meta.contentDigest))session.metadata.delete(id);}
  $('contract-address').value=record.contractAddress;$('marketplace-id').value=record.marketplaceId;$('issuer-identity').value=record.issuerIdentity;
  text('contract-badge',`Contract · ${record.contractAddress.slice(0,10)}…`);text('state-summary',`${record.expertsEnrolled} enrolled credentials · ${record.tasks.length} tasks · ${record.reviews.length} review receipts · ${record.claims} claimed entitlements. Network: ${record.networkId}.`);
  $('receipt-list').replaceChildren();
  for(const receipt of record.reviews){const card=document.createElement('article');card.className='receipt-card';addText(card,'strong',`${receipt.status.toUpperCase()} · ${receipt.scores.join(' / ')} scores`);addText(card,'p',session.metadata.get(receipt.taskId)?.title??`Task ${receipt.taskId.slice(0,12)}…`);addText(card,'code',receipt.receiptId);const button=addText(card,'button','Select receipt');button.className='button secondary';button.type='button';button.addEventListener('click',()=>{$('receipt-id').value=receipt.receiptId;status('Receipt selected. Choose a check or action below.');});$('receipt-list').append(card);}
  if(!record.reviews.length)addText($('receipt-list'),'p','No review receipts recorded yet.');renderTasks();return record;
}
function currentReceipt(){const receipt=session.record?.reviews.find(value=>value.receiptId===$('receipt-id').value);if(!receipt)invalid('Select a receipt present in the refreshed contract state.');return receipt;}
async function readFile(input){const file=input.files?.[0];if(!file)invalid('Choose a JSON file first.');if(file.size>2_000_000)invalid('This file is too large; the maximum is 2 MB.');try{return JSON.parse(await file.text());}catch{invalid('The file is not valid JSON.');}}
async function contentDigest(value){return sha256Text(JSON.stringify({title:value.title,prompt:value.prompt,answer:value.answer}));}
async function importMarketplace(){
  const value=await readFile($('join-file'));
  if(!exact(value,['version','kind','networkId','contractAddress','marketplaceId','issuerIdentity','tasks'])||value.version!==1||value.kind!=='reviewlab-network-marketplace'||!['preview','undeployed'].includes(value.networkId)||!Array.isArray(value.tasks)||value.tasks.length>1024)invalid('This is not a supported ReviewLab network marketplace file.');
  ['contractAddress','marketplaceId','issuerIdentity'].forEach(key=>hex(value[key],key));
  if(value.networkId!==$('network-select').value)invalid('This file belongs to a different network. Disconnect, choose its network in step 1 and reconnect.');
  const metadata=new Map();
  for(const task of value.tasks){
    if(!exact(task,['id','title','prompt','answer','contentDigest'])||typeof task.title!=='string'||!task.title.trim()||task.title.length>120||typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>12000||typeof task.answer!=='string'||!task.answer.trim()||task.answer.length>24000)invalid('The marketplace file contains invalid task text.');
    hex(task.id,'Task ID');hex(task.contentDigest,'Task digest');if(metadata.has(task.id)||await contentDigest(task)!==task.contentDigest)invalid('The marketplace file contains duplicate tasks or text that does not match its commitment.');metadata.set(task.id,{...task});
  }
  if(session.record&&(session.record.contractAddress!==value.contractAddress||session.record.marketplaceId!==value.marketplaceId||session.record.issuerIdentity!==value.issuerIdentity))invalid('A different marketplace is already selected. Disconnect before importing this file.');
  $('contract-address').value=value.contractAddress;$('marketplace-id').value=value.marketplaceId;$('issuer-identity').value=value.issuerIdentity;session.metadata=metadata;
  if(session.record)await refreshState();status('Public marketplace details loaded. Join to check them against the configured indexer.');
}
function validateCredential(value){
  if(!exact(value,['version','marketplaceId','secret','profession','expiresAt'])||value.version!==1||!skills.includes(value.profession)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()/1000)invalid('The private credential is malformed or expired.');hex(value.marketplaceId,'Marketplace ID');hex(value.secret,'Expert secret');
  if(session.record&&value.marketplaceId!==session.record.marketplaceId)invalid('This credential belongs to a different marketplace.');return {...value};
}

on('refresh-wallets',()=>{refreshWallets();status('Wallet discovery refreshed.');});
$('network-select').addEventListener('change',networkChanged);
on('connect-form',connect,'submit');
on('disconnect',()=>{session.connection?.close();session.connection=null;session.client=null;resetContract();['issuer-secret','owner-secret','feedback','contract-address','marketplace-id','issuer-identity','receipt-id','close-task-id','credential-file','join-file'].forEach(id=>$(id).value='');text('connection-badge','Wallet disconnected');status('App session disconnected and in-memory private inputs cleared. Wallet permissions and encrypted browser storage are unchanged.');});
on('check-services',async()=>{
  text('service-status','Checking the public Preview node and indexer…');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const requests=[['https://rpc.preview.midnight.network',{jsonrpc:'2.0',id:1,method:'system_chain',params:[]}],['https://indexer.preview.midnight.network/api/v4/graphql',{query:'{ block { height } }'}]];
    const [node,indexer]=await Promise.all(requests.map(async([url,body])=>{const response=await fetch(url,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'},credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)invalid('The public Preview services did not return a usable response. Try again later.');return response.json();}));
    if(node.result!=='Midnight Preview'||node.error||indexer.errors?.length||!Number.isSafeInteger(indexer.data?.block?.height)||indexer.data.block.height<0)invalid('The public services did not return the expected Preview identity and block height.');
    text('service-status',`Public Preview services responded · block ${indexer.data.block.height}. No wallet connection or transaction.`);status('Read-only public service check completed.');
  }catch(error){text('service-status','Public service check unavailable. Check your internet connection, browser restrictions or service availability. No wallet connection or transaction.');throw error;}finally{clearTimeout(timer);controller.abort();}
});
on('generate-issuer',()=>{$('issuer-secret').value=randomHex32();status('Private issuer key generated locally. Save it before deploying.');});
on('download-issuer',()=>{download('reviewlab-issuer.private.json',{version:1,kind:'reviewlab-issuer-key',secret:hex($('issuer-secret').value,'Issuer key')});status('Private issuer key downloaded. Keep this file private.');});
on('generate-owner',()=>{$('owner-secret').value=randomHex32();status('Private task owner key generated locally. Save it before creating a task.');});
on('download-owner',()=>{download('reviewlab-owner.private.json',{version:1,kind:'reviewlab-owner-key',secret:hex($('owner-secret').value,'Owner key')});status('Private owner key downloaded. Keep this file private.');});
on('deploy',async()=>{const issuerSecret=hex($('issuer-secret').value,'Issuer key');const marketplaceId=randomHex32();const issuerIdentity=issuerIdentityFor(issuerSecret);const result=await session.client.deploy({marketplaceId,issuerIdentity});resetContract();noteTransaction('Marketplace deployment',result);await refreshState();});
on('join-file',importMarketplace,'change');
on('join',async()=>{await session.client.join({contractAddress:hex($('contract-address').value,'Contract address'),marketplaceId:hex($('marketplace-id').value,'Marketplace ID'),issuerIdentity:hex($('issuer-identity').value,'Issuer identity')});await refreshState();status('Marketplace identity and verifier keys matched the configured indexer. No transaction sent.');});
on('download-marketplace',()=>{const r=session.record;download('reviewlab-marketplace.json',{version:1,kind:'reviewlab-network-marketplace',networkId:r.networkId,contractAddress:r.contractAddress,marketplaceId:r.marketplaceId,issuerIdentity:r.issuerIdentity,tasks:[...session.metadata.values()]});status('Public marketplace details saved. No private credentials, keys or feedback included.');});
on('task-form',async()=>{const metadata={id:randomHex32(),title:$('task-title').value.trim(),prompt:$('task-prompt').value.trim(),answer:$('task-answer').value.trim()};if(!metadata.title||!metadata.prompt||!metadata.answer)invalid('Add a title, prompt and AI answer.');metadata.contentDigest=await contentDigest(metadata);const result=await session.client.createTask({id:metadata.id,profession:$('task-profession').value,deadline:seconds('task-deadline'),capacity:Number($('task-capacity').value),reward:Number($('task-reward').value),contentDigest:metadata.contentDigest,ownerSecret:hex($('owner-secret').value,'Task owner key')});session.metadata.set(metadata.id,metadata);noteTransaction('AI evaluation created',result);await refreshState();$('review-task').value=metadata.id;renderTaskContent();},'submit');
on('enroll',async()=>{const issuerSecret=hex($('issuer-secret').value,'Issuer key');const credential=session.pendingCredential??createCredential({marketplaceId:session.record.marketplaceId,profession:$('credential-profession').value,expiresAt:seconds('credential-expiry')});session.pendingCredential=credential;session.credential=credential;credentialStatus();const result=await session.client.enrollExpert({credential,issuerSecret});session.pendingCredential=null;credentialStatus();noteTransaction('Expert credential enrolled',result);await refreshState();});
on('credential-file',async()=>{session.credential=validateCredential(await readFile($('credential-file')));credentialStatus();status('Private credential loaded. Eligibility is checked by the contract when you submit.');},'change');
on('download-credential',()=>{if(!session.credential)invalid('Load or enroll a credential first.');download('reviewlab-expert.private.json',session.credential);status('Private expert credential downloaded. Keep it separate from public marketplace files.');});
$('review-task').addEventListener('change',renderTaskContent);
on('review-form',async()=>{
  if(!session.credential)invalid('Load or enroll your private expert credential first.');const taskId=$('review-task').value;if(!session.metadata.has(taskId))invalid('Load the public marketplace file with the task’s AI prompt and answer before reviewing.');validateCredential(session.credential);
  const result=await session.client.submitReview({taskId,credential:session.credential,feedback:$('feedback').value,scores:['accuracy','reasoning','safety'].map(id=>Number($(id).value))});
  session.opening=session.client.getFeedbackOpening?.(result.receiptId)??result.feedbackOpening??null;
  $('receipt-id').value=result.receiptId;noteTransaction('Expert review',result);await refreshState();view('receipts');
},'submit');
on('download-opening',()=>{if(!session.opening)invalid('No private feedback opening is available in this session.');download('reviewlab-feedback.private.json',session.opening);status('Private feedback opening downloaded. It is not a public receipt.');});
on('recover-review',async()=>{const result=await session.client.recoverPendingReview();$('receipt-id').value=result.receiptId;session.opening=session.client.getFeedbackOpening(result.receiptId);await refreshState();status('Pending review found in the configured indexer. Your receipt and private feedback opening are available. No new transaction was sent.');view('receipts');});
on('refresh-state',async()=>{await refreshState();status('Public contract state refreshed from the configured indexer.');});
on('export-record',async()=>{const record=await refreshState();download('reviewlab-network-record.json',record);status('Public network record saved without private witness data.');});
on('check-receipt',async()=>{const result=await session.client.checkReceipt(hex($('receipt-id').value,'Receipt ID'));text('receipt-check',result.valid===false?'Receipt did not match the configured indexer.':'Receipt found and checked against the configured indexer. This is not independent chain verification.');status('Receipt lookup completed.');});
on('download-receipt',async()=>{await refreshState();download('reviewlab-network-receipt.json',currentReceipt());status('Public review receipt downloaded.');});
on('approve',async()=>{const result=await session.client.approveReview({receiptId:hex($('receipt-id').value,'Receipt ID'),ownerSecret:hex($('owner-secret').value,'Task owner key')});noteTransaction('Review approval',result);await refreshState();});
on('claim',async()=>{if(!session.credential)invalid('Load the author’s private credential in step 3.');const result=await session.client.claimReward({receiptId:hex($('receipt-id').value,'Receipt ID'),credential:session.credential});noteTransaction('Entitlement claim (no token transfer)',result);await refreshState();});
on('close-task',async()=>{const result=await session.client.closeTask({taskId:hex($('close-task-id').value,'Task ID'),ownerSecret:hex($('owner-secret').value,'Task owner key')});noteTransaction('Task closed',result);await refreshState();});

$('task-deadline').value=localDate(7);$('credential-expiry').value=localDate(30);
networkChanged();view(location.hash.slice(1),false);session.ready=true;refreshWallets();
text('boot-status','Real Midnight contract and wallet client loaded. Proving assets are packaged for wallet transactions. No transaction runs automatically.');
