/** Real released-Lace browser journey; called only by the isolated CI runner.
 * No connector replacement, private downloads, screenshots or raw error logs.
 */
import assert from 'node:assert/strict';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';

const APP='https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html';
const INDEXER='https://indexer.preview.midnight.network/api/v4/graphql';
const ID=/^[0-9a-f]{66}$/,HASH=/^[0-9a-f]{64}$/;
const query=`query($offset: TransactionOffset!) { transactions(offset: $offset) { raw hash block { height hash } ... on RegularTransaction { identifiers transactionResult { status } } } }`;

export async function verifyIndexedTransaction(txId,contractAddress,entryPoint){
  assert.match(txId,ID);assert.match(contractAddress,HASH);
  const response=await fetch(INDEXER,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables:{offset:{identifier:txId}}}),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok&&response.body);let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=32*1024*1024);chunks.push(chunk);}
  const result=JSON.parse(Buffer.concat(chunks,size));assert.equal(result.errors,undefined);assert.ok(Array.isArray(result.data?.transactions));
  const matching=result.data.transactions.filter(tx=>tx.identifiers?.includes(txId));assert.equal(matching.length,1);
  const indexed=matching[0];assert.equal(indexed.transactionResult?.status,'SUCCESS');assert.match(indexed.hash,HASH);assert.match(indexed.raw,/^(?:[0-9a-f]{2})+$/);
  const transaction=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(indexed.raw,'hex'));
  assert.equal(transaction.transactionHash(),indexed.hash);assert.ok(transaction.identifiers().includes(txId));
  const calls=[],deployments=[],dustProofBytes=[];
  for(const intent of transaction.intents.values()){
    for(const action of intent.actions){
      if(action instanceof ledger.ContractDeploy)deployments.push(action.address);
      if(action instanceof ledger.ContractCall){
        assert.equal(action.address,contractAddress);assert.equal(action.proof.instance,'proof');
        calls.push({entryPoint:typeof action.entryPoint==='string'?action.entryPoint:Buffer.from(action.entryPoint).toString('utf8'),proofBytes:action.proof.serialize().byteLength});
      }
    }
    for(const spend of intent.dustActions?.spends??[]){assert.equal(spend.proof.instance,'proof');dustProofBytes.push(spend.proof.serialize().byteLength);}
  }
  assert.ok(dustProofBytes.length>=1&&dustProofBytes.every(size=>size>0));
  if(entryPoint===null){assert.deepEqual(deployments,[contractAddress]);assert.equal(calls.length,0);}
  else{assert.equal(calls.length,1);assert.equal(calls[0].entryPoint,entryPoint);assert.ok(calls[0].proofBytes>0);}
  return {txId,transactionHash:indexed.hash,blockHeight:String(indexed.block.height),status:'SucceedEntirely',contractAddress,contractCalls:calls,dustProofBytes,confirmationSource:'public-Preview-indexer',independentCryptographicOrChainVerification:false};
}

export async function runLaceMarketplace({context,appPage,approveWallet,assertInternalWasm,evidence,save}){
  assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(new URL(appPage.url()).origin,new URL(APP).origin);assert.equal(new URL(appPage.url()).pathname,new URL(APP).pathname);
  assert.equal(await appPage.locator('#network-select').inputValue(),'preview');
  assert.match(await appPage.locator('#connection-badge').innerText(),/Wallet connected/);
  evidence.acceptedTransactions??=[];assert.equal(evidence.acceptedTransactions.length,0);
  evidence.marketplaceNegativeChecks=[];evidence.rewardPaymentExecuted=false;evidence.sponsorServiceUsed=false;
  const navigate=name=>appPage.locator(`[data-view="${name}"]`).click();
  async function transaction(operation,selector,entryPoint){
    await assertInternalWasm();evidence.stage=operation;await save();
    const before=await appPage.locator('#transaction-log li').count();
    assert.equal(before,evidence.acceptedTransactions.length);
    await appPage.locator(selector).click();
    await approveWallet({kind:operation,timeoutMs:900000,until:async()=>
      await appPage.locator('#transaction-log li').count()>before || await appPage.locator('#disconnect').isEnabled()});
    await appPage.waitForFunction(count=>document.querySelectorAll('#transaction-log li').length>count,before,{timeout:30000});
    await appPage.waitForFunction(()=>!document.getElementById('disconnect').disabled,undefined,{timeout:30000});
    const count=await appPage.locator('#transaction-log li').count();assert.equal(count,before+1);
    const row=await appPage.locator('#transaction-log li').first().innerText();
    const match=row.match(/transaction ([0-9a-f]{66})$/);assert.ok(match);
    const address=await appPage.locator('#contract-address').inputValue();
    if(evidence.contractAddress)assert.equal(address,evidence.contractAddress);else evidence.contractAddress=address;
    const checked=await verifyIndexedTransaction(match[1],address,entryPoint);
    evidence.acceptedTransactions.push({operation,...checked});await save();
  }
  async function rejected(operation,selector){
    evidence.stage=operation;await save();const before=await appPage.locator('#transaction-log li').count();
    await appPage.locator(selector).click();
    await appPage.waitForFunction(()=>!document.getElementById('disconnect').disabled,undefined,{timeout:30000});
    assert.equal(await appPage.locator('#transaction-log li').count(),before);
    const status=await appPage.locator('#action-status').innerText();assert.ok(!/accepted\. Block/.test(status));
    evidence.marketplaceNegativeChecks.push({operation,acceptedTransactionAdded:false});await save();
  }
  await navigate('marketplace');await appPage.locator('#generate-issuer').click();
  await transaction('deploy','#deploy',null);
  await appPage.locator('#generate-owner').click();
  await transaction('create-task','#task-form button.primary','createTask');
  await navigate('review');await transaction('enroll-expert','#enroll','enroll');
  const feedback='The Map check happens before await. Concurrent callers can miss the cache and fetch twice. Cache the pending promise before awaiting it.';
  await appPage.fill('#feedback',feedback);await appPage.selectOption('#accuracy','2');await appPage.selectOption('#reasoning','2');await appPage.selectOption('#safety','4');
  await transaction('submit-review','#review-form button.primary','submitReview');
  await navigate('review');await appPage.fill('#feedback','Synthetic duplicate submission must be rejected.');
  await rejected('duplicate-review','#review-form button.primary');
  await navigate('receipts');await transaction('approve-review','#approve','approveReview');
  await transaction('claim-entitlement','#claim','claimReward');
  await rejected('duplicate-claim','#claim');
  await transaction('close-task','#close-task','closeTask');
  await appPage.locator('#check-receipt').click();
  await appPage.waitForFunction(()=>document.getElementById('receipt-check').textContent.includes('Receipt found'),undefined,{timeout:30000});
  const pending=appPage.waitForEvent('download');await appPage.locator('#export-record').click();const download=await pending;
  const stream=await download.createReadStream();assert.ok(stream);const chunks=[];let length=0;
  for await(const chunk of stream){length+=chunk.length;assert.ok(length<=2*1024*1024);chunks.push(chunk);}
  const record=JSON.parse(Buffer.concat(chunks));assert.equal(record.kind,'reviewlab-network-record');assert.equal(record.networkId,'preview');
  assert.equal(record.contractAddress,evidence.contractAddress);assert.equal(record.expertsEnrolled,1);assert.equal(record.tasks.length,1);assert.equal(record.tasks[0].closed,true);assert.equal(record.reviews.length,1);assert.equal(record.claims,1);
  const serialized=JSON.stringify(record);
  for(const forbidden of ['expertSecret','issuerSecret','ownerSecret','feedbackSalt','proofData',feedback])assert.equal(serialized.includes(forbidden),false);
  await download.delete();
  evidence.finalState={experts:1,tasks:1,reviews:1,claims:1,taskClosed:true};
  evidence.publicExportContainsPrivateFields=false;evidence.receiptFoundInConfiguredIndexer=true;
  await assertInternalWasm();await save();return record;
}
