/** Actual Chromium → API-4 test connector → funded local wallet → Midnight chain.
 * The connector is the official testkit adapter, not Lace. This script never
 * accepts external seeds, exposes an HTTP signing endpoint, or logs witnesses.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createStaticServer} from '../scripts/serve.mjs';

const root=resolve(import.meta.dirname,'..');
const artifacts=join(root,'artifacts/local-devnet-browser');
const env={networkId:'undeployed',walletNetworkId:'undeployed',node:'http://127.0.0.1:29944',nodeWS:'ws://127.0.0.1:29944',indexer:'http://127.0.0.1:28088/api/v4/graphql',indexerWS:'ws://127.0.0.1:28088/api/v4/graphql/ws',proofServer:'http://127.0.0.1:26300',faucet:undefined};
const report={executedAt:new Date().toISOString(),status:'running',networkId:'undeployed',browser:'Chromium',wallet:'official-testkit-DAppConnectorWalletAdapter',realLaceWalletTested:false,publicPreviewTransactionsTested:false,independentChainInclusionVerified:false,acceptedTransactions:[],proofRequests:0,checkRequests:0,balanceRequests:0,submittedTransactions:0,assetFiles:[],pageErrors:0};
let stage='prerequisites',browser,context,page,server,walletProvider;
const output=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
const save=async()=>{await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'browser-network-evidence.json'),JSON.stringify(report,null,2)+'\n');};
const step=async(name,fn)=>{stage=name;report.currentStage=name;output({stage:name,status:'started'});await save();return fn();};
let publicDataProvider;
try{
  if(process.argv.length!==3||process.argv[2]!=='--isolated-local-devnet')throw new Error('Explicit local devnet flag required');
  if(process.env.MN_TEST_WALLET_SEED||process.env.TEST_WALLET_SEED)throw new Error('External credentials refused');
  report.sourceHashes={};
  for(const file of ['dist/network.html','dist/network-bundle.mjs','dist/network.css','dist/midnight.css','contracts/reviewlab.compact','lib/network/sdk-client.mjs','lib/network/browser-providers.mjs','lib/network/config.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(join(root,file))).digest('hex');
  const [testkit,{default:pino},ledger,network,Rx,{default:WebSocket},{indexerPublicDataProvider},{validatePassword}]=await Promise.all([
    import('@midnight-ntwrk/testkit-js'),import('pino'),import('@midnight-ntwrk/midnight-js-protocol/ledger'),import('@midnight-ntwrk/midnight-js-network-id'),import('rxjs'),import('ws'),import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),import('@midnight-ntwrk/midnight-js-utils')]);
  testkit.logger.level='silent';const silent=pino({level:'silent'});
  for(const method of ['log','debug','info','warn','error','trace','dir'])console[method]=()=>{};
  network.setNetworkId('undeployed');globalThis.WebSocket=WebSocket;
  const fixture=new testkit.LocalTestEnvironment(silent);
  const built=await step('build-test-wallet',()=>testkit.FluentWalletBuilder.forEnvironment(env).withSeed(fixture.genesisMintWalletSeed[0]).buildWithoutStarting());
  walletProvider=await testkit.MidnightWalletProvider.withWallet(silent,env,built.wallet,ledger.ZswapSecretKeys.fromSeed(built.seeds.shielded),ledger.DustSecretKey.fromSeed(built.seeds.dust),built.keystore);
  await walletProvider.start(false);
  await step('synchronize-test-wallet',()=>Rx.firstValueFrom(built.wallet.state().pipe(Rx.filter(value=>value.shielded.state.progress.isStrictlyComplete()&&value.dust.state.progress.isStrictlyComplete()&&value.unshielded.progress.isStrictlyComplete()&&value.dust.availableCoins.length>0),Rx.take(1),Rx.timeout(300000))));
  const api=new testkit.DAppConnectorWalletAdapter(walletProvider,env);
  publicDataProvider=indexerPublicDataProvider(env.indexer,env.indexerWS,WebSocket);
  server=createStaticServer({directory:join(root,'dist'),port:0,prefix:'/Midnight-ReviewLab'});
  await new Promise(resolve=>server.once('listening',resolve));
  const url=`http://127.0.0.1:${server.address().port}/Midnight-ReviewLab/network.html`;
  browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});page=await context.newPage();page.setDefaultTimeout(20000);
  const assetFiles=new Set();
  page.on('pageerror',()=>{report.pageErrors++;});
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.includes('/network-contract/'))assetFiles.add(path.replace('/Midnight-ReviewLab/',''));});
  const allowed=new Set(['getConfiguration','getConnectionStatus','getShieldedAddresses','getUnshieldedAddress','balanceUnsealedTransaction','submitTransaction','check','prove']);
  await page.exposeBinding('__reviewlabTestWallet',async(source,method,payload)=>{
    if(source.frame!==page.mainFrame()||!source.frame.url().startsWith(url)||!allowed.has(method))throw new Error('Test connector request rejected');
    try{
      if(method==='check'||method==='prove'){
        const material=payload.material;
        const keyProvider={
          async getZKIR(){if(!material)throw new Error('Use default key');return new Uint8Array(Buffer.from(material.ir,'base64'));},
          async getProverKey(){if(!material)throw new Error('Use default key');return new Uint8Array(Buffer.from(material.prover,'base64'));},
          async getVerifierKey(){if(!material)throw new Error('Use default key');return new Uint8Array(Buffer.from(material.verifier,'base64'));},
        };
        const provider=await api.getProvingProvider(keyProvider);
        const preimage=new Uint8Array(Buffer.from(payload.preimage,'base64'));
        if(method==='check'){report.checkRequests++;return (await provider.check(preimage,payload.key)).map(value=>value===undefined?null:String(value));}
        report.proofRequests++;const proof=await provider.prove(preimage,payload.key,payload.binding===null?undefined:BigInt(payload.binding));return Buffer.from(proof).toString('base64');
      }
      if(method==='balanceUnsealedTransaction'){report.balanceRequests++;return api.balanceUnsealedTransaction(payload);}
      if(method==='submitTransaction'){
        const transaction=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(payload,'hex'));
        const txId=transaction.identifiers()[0];await api.submitTransaction(payload);report.submittedTransactions++;
        const confirmation=await publicDataProvider.watchForTxData(txId);assert.equal(confirmation.status,'SucceedEntirely');
        report.acceptedTransactions.push({operation:stage,txId,blockHeight:String(confirmation.blockHeight),status:confirmation.status});await save();return null;
      }
      return api[method]();
    }catch(error){
      report.failedConnectorMethod=method;
      const text=String(error?.message??'');
      report.connectorFailureCategory=/proof|prover|verif/i.test(text)?'proof-or-verification':/dust|fund|balance/i.test(text)?'wallet-funding-or-balancing':/connect|fetch|network/i.test(text)?'service-connection':'request-failed-details-withheld';
      await save();throw new Error('Synthetic local test wallet request failed');
    }
  });
  await page.addInitScript(()=>{
    function encode(bytes){let value='';for(let index=0;index<bytes.length;index+=32768)value+=String.fromCharCode(...bytes.subarray(index,index+32768));return btoa(value);}
    function decode(value){return Uint8Array.from(atob(value),char=>char.charCodeAt(0));}
    const bridge=(method,payload)=>window.__reviewlabTestWallet(method,payload);
    const api={};
    for(const method of ['getConfiguration','getConnectionStatus','getShieldedAddresses','getUnshieldedAddress','balanceUnsealedTransaction','submitTransaction'])api[method]=payload=>bridge(method,payload);
    api.getProvingProvider=async keys=>{
      const cache=new Map();
      async function material(key){
        if(!cache.has(key))cache.set(key,Promise.all([keys.getZKIR(key),keys.getProverKey(key),keys.getVerifierKey(key)]).then(([ir,prover,verifier])=>({ir:encode(ir),prover:encode(prover),verifier:encode(verifier)})).catch(()=>null));
        return cache.get(key);
      }
      return {
        check:async(preimage,key)=>(await bridge('check',{preimage:encode(preimage),key,material:await material(key)})).map(value=>value===null?undefined:BigInt(value)),
        prove:async(preimage,key,binding)=>decode(await bridge('prove',{preimage:encode(preimage),key,binding:binding===undefined?null:String(binding),material:await material(key)})),
      };
    };
    window.midnight={reviewlabFixture:{name:'ReviewLab synthetic local test wallet',rdns:'org.midnight.reviewlab.testkit',apiVersion:'4.0.1',connect:async network=>{if(network!=='undeployed')throw new Error('Only isolated local development network supported');return api;}}};
  });
  await step('load-browser-app',()=>page.goto(url));
  await page.waitForFunction(()=>document.getElementById('boot-status').textContent.includes('Real Midnight contract'));
  await page.selectOption('#network-select','undeployed');
  let password;for(;;){password=`Browser-${randomBytes(30).toString('base64url')}-V7!`;try{validatePassword(password);break;}catch{}}
  await page.fill('#storage-password',password);
  await step('connect-test-connector',()=>page.locator('#connect-form button.primary').click());
  await page.waitForFunction(()=>document.getElementById('connection-badge').textContent.includes('Wallet connected'),{timeout:30000});
  const navigate=name=>page.locator(`[data-view="${name}"]`).click();
  async function transaction(name,button,count){
    await step(name,()=>page.locator(button).click());
    await page.waitForFunction(expected=>document.querySelectorAll('#transaction-log li').length>=expected,count,{timeout:300000});
    await page.waitForFunction(()=>!document.getElementById('disconnect').disabled,undefined,{timeout:30000});
    assert.equal(report.acceptedTransactions.length,count);output({stage:name,status:'browser-transaction-accepted',count});
  }
  await navigate('marketplace');await page.locator('#generate-issuer').click();
  await transaction('browser-deploy','#deploy',1);
  await page.locator('#generate-owner').click();
  await transaction('browser-create-task','#task-form button.primary',2);
  await navigate('review');
  await transaction('browser-enroll','#enroll',3);
  await page.fill('#feedback','The Map check happens before await. Two concurrent callers can both miss the cache and fetch twice. Cache the pending promise before awaiting it.');
  await page.selectOption('#accuracy','2');await page.selectOption('#reasoning','2');await page.selectOption('#safety','4');
  await transaction('browser-submit-review','#review-form button.primary',4);
  await transaction('browser-approve','#approve',5);
  await transaction('browser-claim','#claim',6);
  await transaction('browser-close-task','#close-task',7);
  await page.locator('#check-receipt').click();
  await page.waitForFunction(()=>document.getElementById('receipt-check').textContent.includes('Receipt found'));
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-record').click();const download=await downloadPromise;
  const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const record=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(record.kind,'reviewlab-network-record');assert.equal(record.reviews.length,1);assert.equal(record.claims,1);assert.equal(record.tasks[0].closed,true);
  const serialized=JSON.stringify(record);for(const key of ['expertSecret','issuerSecret','ownerSecret','feedbackSalt','proofData'])assert.equal(serialized.includes(key),false);
  await writeFile(join(artifacts,'public-record.json'),JSON.stringify(record,null,2)+'\n');
  await page.screenshot({path:join(artifacts,'accepted-browser-receipts.png'),fullPage:true});
  report.assetFiles=[...assetFiles].sort();assert.ok(report.assetFiles.some(path=>path.includes('submitReview.prover')));
  report.finalState={credentials:record.expertsEnrolled,tasks:record.tasks.length,reviews:record.reviews.length,claims:record.claims,closed:record.tasks[0].closed};
  report.contractAddress=record.contractAddress;report.status='passed';report.completedAt=new Date().toISOString();delete report.currentStage;
  assert.equal(report.pageErrors,0);await save();output({status:'passed',browserTransactions:report.acceptedTransactions.length,evidence:'artifacts/local-devnet-browser/browser-network-evidence.json'});
}catch(error){report.status='failed';report.failedStage=stage;report.failureCategory=error?.name==='TimeoutError'?'browser-timeout':'browser-or-network-assertion';await save();output({status:'failed',stage,category:report.failureCategory,acceptedTransactions:report.acceptedTransactions.length,connectorMethod:report.failedConnectorMethod??null});process.exitCode=1;}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));if(walletProvider)await Promise.race([walletProvider.stop(),new Promise(resolve=>setTimeout(resolve,20000))]).catch(()=>{});}
