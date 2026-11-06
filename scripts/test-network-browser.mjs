import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

// This suite exercises the actual bundled SDK, contract and WASM in Chromium.
// The sole connector fixture always REJECTS. It cannot prove, sign, submit or
// return successful network state. Network acceptance is tested separately.
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'artifacts/network-browser');
await mkdir(output, { recursive: true });
const server = createStaticServer({ port: 0, prefix: '/Midnight-ReviewLab' });
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/Midnight-ReviewLab/`;
const url = `${base}network.html`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], externalRequests = [], wasmResponses = new Set(), cases = [];
const unsafeMarker = 'fixture-private-wallet-payload-never-render';
const consoleMessages = [];

async function attachSafetyChecks(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => consoleMessages.push(message.text()));
  target.on('response', response => {
    if (response.url().includes('/network-assets/') && response.url().endsWith('.wasm') && response.status() === 200) wasmResponses.add(new URL(response.url()).pathname);
  });
  await target.route('**/*', route => {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith(base) || requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return route.continue();
    externalRequests.push(new URL(requestUrl).origin);
    return route.abort('blockedbyclient');
  });
}
await attachSafetyChecks(page);
async function ready(target = page) {
  await target.locator('#boot-status').filter({ hasText: /Real Midnight contract/ }).waitFor();
  await target.waitForFunction(() => !document.getElementById('refresh-wallets').disabled);
}
async function tab(name, target = page) {
  await target.locator(`[data-view="${name}"]`).click();
  assert.equal(await target.locator('[data-panel]:visible').count(), 1);
  assert.equal(await target.locator(`[data-panel="${name}"]`).isVisible(), true);
}
async function statusMatches(pattern, target = page) {
  try { await target.locator('#action-status').filter({ hasText: pattern }).waitFor(); }
  catch(error) {
    const status = await target.locator('#action-status').innerText();
    const invalidFields = await target.locator('#connect-form').evaluate(form=>Array.from(form.elements).filter(el=>el.willValidate&&!el.validity.valid).map(el=>el.id));
    console.error(JSON.stringify({expectedStatus:String(pattern),actualStatus:status.includes(unsafeMarker)?'[private fixture error leaked]':status,invalidFields}));
    throw error;
  }
}
async function upload(selector, value, raw = false) {
  await page.locator(selector).setInputFiles({ name: 'synthetic-boundary-input.json', mimeType: 'application/json', buffer: Buffer.from(raw ? value : JSON.stringify(value)) });
}
async function transactionButtonsDisabled(target = page) {
  assert.equal(await target.locator('[data-connected]:enabled,[data-contract]:enabled').count(), 0, 'No transaction or contract action may be enabled without a wallet/contract');
  assert.equal(await target.locator('#disconnect').isEnabled(), false);
  assert.equal(await target.locator('#transaction-log li').count(), 0);
}
const contexts = [context];
try {
  await page.goto(url);
  await ready();
  assert.equal(await page.locator('#connection-badge').innerText(), 'Wallet disconnected');
  assert.equal(await page.locator('#network-select').inputValue(), 'preview');
  assert.equal(await page.locator('#network-select option[value="mainnet"]').count(), 0);
  assert.equal(await page.locator('#indexer-url').inputValue(), 'https://indexer.preview.midnight.network/api/v4/graphql');
  assert.equal(await page.locator('#indexer-ws').inputValue(), 'wss://indexer.preview.midnight.network/api/v4/graphql/ws');
  assert.equal(await page.locator('#indexer-url').evaluate(el => el.readOnly), true);
  assert.equal(await page.getByRole('button', { name: 'Connect wallet →', exact: true }).isEnabled(), false);
  assert.equal(await page.locator('#internal-prover-confirmed').isChecked(), false);
  await transactionButtonsDisabled();
  assert.match(await page.locator('#service-status').innerText(), /No service check has run/);
  assert(wasmResponses.size >= 2, 'Actual ledger and on-chain WASM must load from the same-origin bundle');
  const build = JSON.parse(await readFile(resolve(root, 'dist/network-build.json'), 'utf8'));
  assert.equal(build.enabled, true);
  assert.equal(build.circuitAssets.length, 18);
  assert(build.circuitAssets.every(asset => asset.bytes > 0 && /^[a-f0-9]{64}$/.test(asset.sha256)));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(output, 'connect-desktop.png'), fullPage: true });
  cases.push('Real SDK/contract bundle, two native WASM assets, 18 generated proof assets, no automatic remote calls or enabled transactions');

  await page.locator('#network-select').selectOption('undeployed');
  assert.equal(await page.locator('#indexer-url').inputValue(), 'http://127.0.0.1:28088/api/v4/graphql');
  assert.equal(await page.locator('#indexer-ws').inputValue(), 'ws://127.0.0.1:28088/api/v4/graphql/ws');
  assert.equal(await page.locator('#indexer-url').evaluate(el => el.readOnly), false);
  await page.locator('#network-select').selectOption('preview');
  assert.equal(await page.locator('#indexer-url').evaluate(el => el.readOnly), true);
  await transactionButtonsDisabled();
  cases.push('Preview defaults and explicit loopback development endpoints; switching networks sends no request');

  const downloads = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await tab('marketplace');
  await page.locator('#load-published-marketplace').click();
  await statusMatches(/Public marketplace details loaded/);
  const publishedMarketplace=JSON.parse(await readFile(resolve(root,'docs/public-preview-marketplace.json'),'utf8'));
  assert.equal(await page.locator('#contract-address').inputValue(),publishedMarketplace.contractAddress);
  assert.equal(await page.locator('#join').isEnabled(),false,'Loading public details never connects a wallet or joins a contract');
  await page.locator('#generate-issuer').click();
  await statusMatches(/issuer key generated locally/);
  const issuerSecret = await page.locator('#issuer-secret').inputValue();
  assert.match(issuerSecret, /^[0-9a-f]{64}$/);
  assert.equal(await page.locator('#issuer-secret').getAttribute('type'), 'password');
  assert.equal(downloads.length, 0, 'Generating a key never starts an implicit download');
  await page.locator('#task-title').fill('A synthetic boundary-check campaign');
  await page.locator('#generate-owner').click();
  await statusMatches(/task owner key generated locally/);
  const ownerSecret = await page.locator('#owner-secret').inputValue();
  const downloadPending = page.waitForEvent('download');
  await page.locator('#download-issuer').click();
  const downloaded = await downloadPending;
  const keyFile = JSON.parse(await readFile(await downloaded.path(), 'utf8'));
  assert.equal(downloaded.suggestedFilename(), 'reviewlab-issuer.private.json');
  assert.deepEqual(Object.keys(keyFile).sort(), ['kind', 'secret', 'version']);
  assert.equal(keyFile.secret, issuerSecret);
  assert.equal(keyFile.kind, 'reviewlab-issuer-key');
  await tab('review');
  await page.locator('#feedback').fill('Private synthetic feedback retained only while this browser session remains open.');
  await tab('receipts');
  await page.locator('#receipt-id').fill('a'.repeat(64));
  await tab('marketplace');
  assert.equal(await page.locator('#issuer-secret').inputValue(), issuerSecret);
  assert.equal(await page.locator('#owner-secret').inputValue(), ownerSecret);
  assert.equal(await page.locator('#task-title').inputValue(), 'A synthetic boundary-check campaign');
  await tab('review');
  assert.match(await page.locator('#feedback').inputValue(), /Private synthetic feedback/);
  const visibleText = await page.locator('body').innerText();
  const persisted = await page.evaluate(() => JSON.stringify({ local: localStorage, session: sessionStorage }));
  assert(!visibleText.includes(issuerSecret) && !visibleText.includes(ownerSecret));
  assert(!persisted.includes(issuerSecret) && !persisted.includes(ownerSecret));
  assert.equal(downloads.length, 1, 'Only the explicit issuer download occurred');
  await transactionButtonsDisabled();
  cases.push('Tabs preserve private inputs and forms; issuer key stays masked/in memory and downloads only on explicit request');

  await tab('marketplace');
  await upload('#join-file', '{bad JSON', true);
  await statusMatches(/not valid JSON/);
  assert.equal(await page.locator('#contract-address').inputValue(), publishedMarketplace.contractAddress);
  const task = { id: '4'.repeat(64), title: '<img src=x onerror="window.__reviewlabXss=true">', prompt: 'Evaluate this synthetic answer.', answer: '<script>window.__reviewlabXss=true</script>' };
  task.contentDigest = createHash('sha256').update(JSON.stringify({title:task.title,prompt:task.prompt,answer:task.answer})).digest('hex');
  const marketplace = { version:1, kind:'reviewlab-network-marketplace', networkId:'preview', contractAddress:'1'.repeat(64), marketplaceId:'2'.repeat(64), issuerIdentity:'3'.repeat(64), tasks:[task] };
  await upload('#join-file', marketplace);
  await statusMatches(/Public marketplace details loaded/);
  assert.equal(await page.locator('#contract-address').inputValue(), marketplace.contractAddress);
  assert.equal(await page.locator('#join').isEnabled(), false, 'File parsing cannot authorize joining or impersonate network verification');
  assert.equal(await page.evaluate(() => window.__reviewlabXss), undefined);
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  const tampered = structuredClone(marketplace);tampered.tasks[0].answer += ' altered';
  await upload('#join-file', tampered);
  await statusMatches(/does not match its commitment/);
  const duplicates = structuredClone(marketplace);duplicates.tasks.push(duplicates.tasks[0]);
  await upload('#join-file', duplicates);
  await statusMatches(/duplicate tasks/);
  await upload('#join-file', {...marketplace, networkId:'undeployed'});
  await statusMatches(/different network/);
  await upload('#join-file', {...marketplace, secret:unsafeMarker});
  await statusMatches(/not a supported/);
  assert.equal(await page.locator('#contract-address').inputValue(), marketplace.contractAddress, 'Rejected files never replace the prior validated input');
  assert(!await page.locator('body').innerText().then(text=>text.includes(unsafeMarker)));
  await transactionButtonsDisabled();
  cases.push('Marketplace JSON parsing, content commitments, duplicate/foreign-network/extra-field rejection and inert HTML payloads');

  await tab('review');
  const expired = { version:1, marketplaceId:marketplace.marketplaceId, secret:'5'.repeat(64), profession:'software', expiresAt:Math.floor(Date.now()/1000)-60 };
  await upload('#credential-file', expired);
  await statusMatches(/malformed or expired/);
  await upload('#credential-file', {...expired, expiresAt:Math.floor(Date.now()/1000)+86400, profession:'constructor'});
  await statusMatches(/malformed or expired/);
  await upload('#credential-file', {...expired, expiresAt:Math.floor(Date.now()/1000)+86400, secret:'0'.repeat(64)});
  await statusMatches(/cannot be zero/);
  assert.equal(await page.locator('#credential-status').innerText(), 'No private credential loaded.');
  assert.equal(await page.locator('#download-credential').isEnabled(), false);
  cases.push('Expired, malformed and zero-secret credentials rejected before any wallet or network interaction');

  const rejectingContext = await browser.newContext({ viewport:{width:1440,height:1050} });contexts.push(rejectingContext);
  // Explicit negative-only API 4 fixture. No successful wallet methods exist.
  await rejectingContext.addInitScript(marker => {
    window.__reviewlabConnectCalls = [];
    window.midnight = { rejectingBoundaryFixture: {
      // Metadata is deliberately claimed by a rejecting fixture. It does not
      // impersonate a successful Lace connection or authenticate the extension.
      name:'Rejecting API4 boundary fixture',rdns:'io.lace.wallet',apiVersion:'4.0.1',
      connect:async networkId=>{window.__reviewlabConnectCalls.push(networkId);throw {type:'DAppConnectorAPIError',code:'PermissionRejected',message:marker,reason:marker};},
    }};
  }, unsafeMarker);
  const rejectedPage = await rejectingContext.newPage();rejectedPage.setDefaultTimeout(15000);await attachSafetyChecks(rejectedPage);
  await rejectedPage.goto(url);await ready(rejectedPage);
  assert.match(await rejectedPage.locator('#wallet-select').innerText(), /Rejecting API4 boundary fixture/);
  await rejectedPage.locator('#storage-password').fill('J7!qL9@vT2#rN6$x');
  assert.equal(await rejectedPage.getByRole('button', {name:'Connect wallet →',exact:true}).isEnabled(),false);
  assert.equal(await rejectedPage.evaluate(()=>window.__reviewlabConnectCalls.length),0,'Unconfirmed internal mode cannot request wallet access');
  await rejectedPage.locator('#internal-prover-confirmed').check();
  await rejectedPage.locator('#storage-password').fill('weakpasswordonly');
  await rejectedPage.getByRole('button', {name:'Connect wallet →',exact:true}).click();
  await statusMatches(/Choose a stronger password/,rejectedPage);
  assert.equal(await rejectedPage.evaluate(()=>window.__reviewlabConnectCalls.length),0,'Weak password fails before asking the wallet');
  await rejectedPage.locator('#storage-password').fill('J7!qL9@vT2#rN6$x');
  await rejectedPage.getByRole('button', {name:'Connect wallet →',exact:true}).click();
  await statusMatches(/denied permission/,rejectedPage);
  assert.deepEqual(await rejectedPage.evaluate(()=>window.__reviewlabConnectCalls),['preview']);
  assert.equal(await rejectedPage.locator('#connection-badge').innerText(),'Wallet disconnected');
  assert(!await rejectedPage.locator('body').innerText().then(text=>text.includes(unsafeMarker)));
  assert(!consoleMessages.some(text=>text.includes(unsafeMarker)));
  await transactionButtonsDisabled(rejectedPage);
  cases.push('Rejecting-only API4 fixture: internal-mode confirmation and strong storage password required before wallet access; denial stays disconnected without raw errors');

  const serverContext = await browser.newContext();contexts.push(serverContext);
  await serverContext.addInitScript(marker => {
    window.__reviewlabForbiddenCalls = 0;
    const forbidden = async()=>{window.__reviewlabForbiddenCalls++;throw new Error(marker);};
    window.midnight = { negativeServerFixture: {
      name:'Negative proof-server boundary fixture',rdns:'io.lace.wallet',apiVersion:'4.0.1',
      connect:async()=>({
        getConnectionStatus:async()=>({status:'connected',networkId:'preview'}),
        getConfiguration:async()=>({networkId:'preview',proverServerUri:'http://localhost:6300'}),
        getShieldedAddresses:async()=>({shieldedCoinPublicKey:'1'.repeat(64),shieldedEncryptionPublicKey:'2'.repeat(64)}),
        getUnshieldedAddress:async()=>({unshieldedAddress:'synthetic-negative-boundary-only'}),
        getProvingProvider:forbidden,balanceUnsealedTransaction:forbidden,submitTransaction:forbidden,
      }),
    }};
  },unsafeMarker);
  const serverPage=await serverContext.newPage();await attachSafetyChecks(serverPage);
  await serverPage.goto(url);await ready(serverPage);
  await serverPage.locator('#storage-password').fill('J7!qL9@vT2#rN6$x');
  await serverPage.locator('#internal-prover-confirmed').check();
  await serverPage.getByRole('button',{name:'Connect wallet →',exact:true}).click();
  await statusMatches(/Any reported proof-server URL is refused/,serverPage);
  assert.equal(await serverPage.evaluate(()=>window.__reviewlabForbiddenCalls),0,'Reject local HTTP prover before proof provider, balance or submit');
  await transactionButtonsDisabled(serverPage);
  await serverPage.reload();await ready(serverPage);
  assert.equal(await serverPage.locator('#internal-prover-confirmed').isChecked(),false,'Prover selection confirmation must not persist');
  cases.push('Negative-only server fixture: even loopback HTTP proving is rejected before provider creation or transactions; internal selection does not persist');

  await page.setViewportSize({width:390,height:844});
  for(const name of ['connect','marketplace','review','receipts']){
    await tab(name);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`${name} must fit 390px`);
    if(name==='connect'||name==='review')await page.screenshot({path:resolve(output,`${name}-mobile.png`),fullPage:true});
  }
  cases.push('All four testnet screens fit 390px and preserve navigation without starting a transaction');

  assert.deepEqual(errors,[],'No browser runtime errors');
  assert.deepEqual(externalRequests,[],'No request may leave this origin in the boundary suite');
  const evidence={status:'passed',testedAt:new Date().toISOString(),browser:await browser.version(),cases,errors:0,remoteRequests:0,nativeWasmAssetsLoaded:wasmResponses.size,
    fixture:'Negative-only API4 connector always rejects; no success mocks',walletConnected:false,proofGenerated:false,transactionSubmitted:false,networkAcceptance:false,
    limitations:['Joined-marketplace credential identity checks require real state and are covered by SDK/native tests, not a fabricated browser connection.']};
  await writeFile(resolve(output,'results.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
}catch(error){
  await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});
  console.error(error);process.exitCode=1;
}finally{for(const item of contexts)await item.close().catch(()=>{});await browser.close();server.close();}
