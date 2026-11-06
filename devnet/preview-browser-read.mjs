/** Read-only production-browser verification against the existing public Preview
 * contract and dedicated test wallet. The official testkit connector supplies
 * public account data. This is not a real Lace extension test. Proof, balancing
 * and submission requests are explicitly rejected by this verification bridge.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {startPreviewWallet,PREVIEW_ENVIRONMENT} from './preview-acceptance.mjs';

const root=resolve(import.meta.dirname,'..');
const directory=join(root,'artifacts/public-preview-browser');
const url='https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html';
const report={schema:'reviewlab-public-preview-browser-read/v1',startedAt:new Date().toISOString(),status:'running',networkId:'preview',url,browser:'Chromium',wallet:'official-testkit-DAppConnectorWalletAdapter',realLaceWalletTested:false,networkSubmission:false,proofRequests:0,balanceRequests:0,submissionRequests:0,pageErrors:0,confirmationSource:'configured-public-preview-indexer',independentlyVerifiedChainInclusion:false};
const output=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
let context,browser,page,stage='prerequisites';
const originalConsole=Object.fromEntries(['log','info','debug','warn','error','trace','dir'].map(name=>[name,console[name]]));
for(const name of Object.keys(originalConsole))console[name]=()=>{};
try{
  assert.deepEqual(process.argv.slice(2),['--read-only-public-preview']);
  const acceptance=JSON.parse(await readFile(join(root,'artifacts/public-preview/network-evidence.json'),'utf8'));
  assert.equal(acceptance.status,'passed');assert.equal(acceptance.networkId,'preview');
  const marketplace=await readFile(join(root,'artifacts/public-preview/marketplace.json'));
  report.contractAddress=acceptance.contractAddress;report.receiptId=acceptance.finalState.receiptId;
  report.sourceHashes={};
  for(const name of ['network.html','network-bundle.mjs','network.css','midnight.css']){
    const response=await fetch(new URL(name,url),{signal:AbortSignal.timeout(30000)});assert.equal(response.ok,true);
    report.sourceHashes[name]=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
  }
  report.runnerSourceSha256=createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  const [{DAppConnectorWalletAdapter},{validatePassword}]=await Promise.all([import('@midnight-ntwrk/testkit-js'),import('@midnight-ntwrk/midnight-js-utils')]);
  stage='restore-dedicated-preview-wallet';output({stage});
  context=await startPreviewWallet();
  assert.equal(context.address,acceptance.unshieldedAddress);
  report.restoredEncryptedCheckpoint=Boolean(context.restoredCheckpointAt);
  const api=new DAppConnectorWalletAdapter(context.walletProvider,PREVIEW_ENVIRONMENT);
  browser=await chromium.launch({headless:true});
  const browserContext=await browser.newContext({viewport:{width:1440,height:1100},acceptDownloads:true});
  page=await browserContext.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',()=>{report.pageErrors++;});
  const allowed=new Set(['getConfiguration','getConnectionStatus','getShieldedAddresses','getUnshieldedAddress']);
  await page.exposeBinding('__reviewlabPreviewRead',async(source,method)=>{
    if(method==='check'||method==='prove')report.proofRequests++;
    if(method==='balanceUnsealedTransaction')report.balanceRequests++;
    if(method==='submitTransaction')report.submissionRequests++;
    const frameUrl=new URL(source.frame.url());frameUrl.hash='';
    if(source.frame!==page.mainFrame()||frameUrl.href!==url||!allowed.has(method))throw new Error('Read-only Preview connector rejected this request');
    return api[method]();
  });
  await page.addInitScript(()=>{
    const api={};
    for(const method of ['getConfiguration','getConnectionStatus','getShieldedAddresses','getUnshieldedAddress'])api[method]=()=>window.__reviewlabPreviewRead(method);
    for(const method of ['balanceUnsealedTransaction','submitTransaction'])api[method]=()=>window.__reviewlabPreviewRead(method);
    api.getProvingProvider=async()=>({check:()=>window.__reviewlabPreviewRead('check'),prove:()=>window.__reviewlabPreviewRead('prove')});
    window.midnight={reviewlabPreviewRead:{name:'ReviewLab dedicated Preview test wallet',rdns:'org.midnight.reviewlab.previewtest',apiVersion:'4.0.1',connect:async network=>{if(network!=='preview')throw new Error('Only public Preview is supported');return api;}}};
  });
  stage='connect-production-browser';output({stage});
  await page.goto(url);
  await page.waitForFunction(()=>document.getElementById('boot-status').textContent.includes('Real Midnight contract'));
  await page.selectOption('#network-select','preview');
  let password;for(;;){password=`Browser-${randomBytes(30).toString('base64url')}-V7!`;try{validatePassword(password);break;}catch{}}
  await page.fill('#storage-password',password);
  await page.locator('#connect-form button.primary').click();
  await page.waitForFunction(()=>document.getElementById('connection-badge').textContent.includes('Wallet connected'));
  stage='join-existing-public-contract';output({stage});
  await page.locator('[data-view="marketplace"]').click();
  await page.locator('#join-file').setInputFiles({name:'reviewlab-preview-marketplace.json',mimeType:'application/json',buffer:marketplace});
  await page.waitForFunction(address=>document.getElementById('contract-address').value===address,acceptance.contractAddress);
  await page.locator('#join').click();
  await page.waitForFunction(id=>document.getElementById('receipt-list').textContent.includes(id),report.receiptId);
  await page.locator('[data-view="receipts"]').click();
  await page.fill('#receipt-id',report.receiptId);
  await page.locator('#check-receipt').click();
  await page.waitForFunction(()=>document.getElementById('receipt-check').textContent.includes('Receipt found'));
  stage='export-public-record';output({stage});
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-record').click();
  const download=await downloadPromise,stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const record=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(record.networkId,'preview');assert.equal(record.contractAddress,acceptance.contractAddress);
  const receipt=record.reviews.find(value=>value.receiptId===report.receiptId);assert.equal(receipt.status,'claimed');
  const task=record.tasks.find(value=>value.id===receipt.taskId);assert.equal(task.closed,true);
  const serialized=JSON.stringify(record);for(const key of ['expertSecret','issuerSecret','ownerSecret','feedbackSalt','proofData','feedbackOpening'])assert.equal(serialized.includes(key),false);
  assert.equal(await page.locator('#transaction-log li').count(),0);assert.equal(report.pageErrors,0);
  assert.equal(report.proofRequests,0);assert.equal(report.balanceRequests,0);assert.equal(report.submissionRequests,0);
  report.receiptStatus=receipt.status;report.taskClosed=task.closed;report.publicExportChecked=true;report.status='passed';report.completedAt=new Date().toISOString();
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'public-record.json'),JSON.stringify(record,null,2)+'\n');
  await page.screenshot({path:join(directory,'public-preview-receipt.png'),fullPage:true});
  output({status:'passed',contractAddress:report.contractAddress,receiptStatus:report.receiptStatus,evidence:'artifacts/public-preview-browser/browser-read-evidence.json'});
}catch{report.status='failed';report.failedStage=stage;output({status:'failed',stage,category:'private-details-withheld'});process.exitCode=1;}
finally{
  await mkdir(directory,{recursive:true});await writeFile(join(directory,'browser-read-evidence.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close().catch(()=>{});if(context){await context.checkpoint().catch(()=>{});await context.close();}
  Object.assign(console,originalConsole);
}
