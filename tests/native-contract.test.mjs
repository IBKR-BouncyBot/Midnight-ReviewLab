import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketplace,createNativeHarness,verifyPublicRecord,verifyPublicReceipt} from '../lib/native-engine.mjs';

const NOW=1_800_000_000;
const secret = value => new Uint8Array(32).fill(value);
const hex = value => Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g),pair=>parseInt(pair,16));
async function fixture({capacity=3}={}) {
  const market=await createMarketplace({now:NOW});
  const expert=market.enrollExpert({profession:'accounting',expiresAt:NOW+100000});
  const task=await market.createTask({profession:'accounting',deadline:NOW+1000,capacity,reward:25,content:'Assess the sample bookkeeping answer.'});
  const submit=(credential=expert,taskId=task.id)=>market.submitReview({taskId,credential,feedback:'The answer omits the adjustment and should explain it.',scores:[3,2,5]});
  return {market,expert,task,submit};
}

test('generated Compact executes enrollment, review, approval and one claim entitlement', async()=>{
  const {market,expert,submit}=await fixture();
  const receipt=await submit();
  assert.equal(receipt.status,'submitted');
  assert.equal(market.approveReview(receipt.receiptId).status,'approved');
  assert.equal(market.claimReward({receiptId:receipt.receiptId,credential:expert}).status,'claimed');
  const state=market.getState();
  assert.equal(state.expertsEnrolled,1); assert.equal(state.tasks[0].accepted,1); assert.equal(state.claims,1);
  assert.equal(market.verifyReceipt(receipt).included,true);
  assert.equal((await verifyPublicRecord(state)).valid,true);
  assert.throws(()=>market.claimReward({receiptId:receipt.receiptId,credential:expert}),/not approved or already claimed/);
});

test('task-scoped nullifier rejects repeat submission, but allows another task', async()=>{
  const {market,expert,submit}=await fixture();
  const first=await submit();
  await assert.rejects(submit(),/already reviewed/);
  const next=await market.createTask({profession:'accounting',deadline:NOW+2000,reward:5,capacity:2,content:'Another task'});
  const second=await submit(expert,next.id);
  assert.notEqual(first.nullifier,second.nullifier);
  assert.equal(market.getState().reviews.length,2);
});

test('issuer enrollment is authenticated inside the contract',async()=>{
  const native=await createNativeHarness({now:NOW});
  assert.throws(()=>native.call('enroll',[secret(3)],{issuerSecret:secret(2)}),/credential issuer required/);
  assert.equal(native.state().enrolled.size(),0n);
  native.call('enroll',[secret(3)],{issuerSecret:native.issuerSecret});
  assert.throws(()=>native.call('enroll',[secret(3)],{issuerSecret:native.issuerSecret}),/already enrolled/);
});

test('credential secrets, professions and expiries are bound to trusted membership',async()=>{
  const {market,expert,submit}=await fixture();
  for(const change of [{secret:hex(secret(5))},{profession:'software'},{expiresAt:expert.expiresAt+1}]) {
    await assert.rejects(submit({...expert,...change}),/not enrolled/);
    assert.throws(()=>market.validateCredential({...expert,...change}),/not enrolled/);
  }
  assert.equal(market.validateCredential(expert).valid,true);
  const different=market.enrollExpert({profession:'software',expiresAt:NOW+10000});
  await assert.rejects(submit(different),/profession does not match/);
  const expiresEarly=market.enrollExpert({profession:'accounting',expiresAt:NOW+999});
  await assert.rejects(submit(expiresEarly),/expires before task deadline/);
  assert.equal(market.getState().reviews.length,0);
});

test('Merkle membership cannot be bypassed with a real path for another secret',async()=>{
  const native=await createNativeHarness({now:NOW});
  const realSecret=secret(3), id=secret(4), owner=secret(5);
  const leaf=native.pure.memberIdentity(native.marketplaceId,realSecret,1n,BigInt(NOW+2000));
  native.call('enroll',[leaf],{issuerSecret:native.issuerSecret});
  native.call('createTask',[id,1n,BigInt(NOW+1000),3n,25n,secret(6)],{ownerSecret:owner});
  const inputs={expertSecret:secret(8),profession:1n,validUntil:BigInt(NOW+2000),eligibilityPath:native.state().members.findPathForLeaf(leaf),feedbackDigest:secret(9),feedbackSalt:secret(10)};
  assert.throws(()=>native.call('submitReview',[id,[3n,3n,3n]],inputs),/attributes or secret/);
  assert.equal(native.state().totalReviews,0n);
});

test('unknown Merkle roots are rejected by the circuit',async()=>{
  const trusted=await createNativeHarness({now:NOW}), forged=await createNativeHarness({now:NOW,marketplaceId:trusted.marketplaceId});
  const secretKey=secret(3), id=secret(4);
  const leaf=trusted.pure.memberIdentity(trusted.marketplaceId,secretKey,1n,BigInt(NOW+2000));
  forged.call('enroll',[leaf],{issuerSecret:forged.issuerSecret});
  trusted.call('createTask',[id,1n,BigInt(NOW+1000),3n,25n,secret(6)],{ownerSecret:secret(5)});
  assert.throws(()=>trusted.call('submitReview',[id,[3n,3n,3n]],{
    expertSecret:secretKey,profession:1n,validUntil:BigInt(NOW+2000),eligibilityPath:forged.state().members.findPathForLeaf(leaf),feedbackDigest:secret(9),feedbackSalt:secret(10),
  }),/not in the trusted registry/);
});

test('credentials from other marketplace instances cannot be replayed',async()=>{
  const first=await fixture(), second=await fixture();
  await assert.rejects(second.submit(first.expert),/another marketplace/);
  const a=await first.submit(),b=await second.submit();
  assert.notEqual(a.nullifier,b.nullifier);
});

test('capacity and explicit closure are enforced',async()=>{
  const {market,submit}=await fixture({capacity:1});
  await submit();
  const other=market.enrollExpert({profession:'accounting',expiresAt:NOW+10000});
  await assert.rejects(submit(other),/task is full/);
  const another=await fixture();
  another.market.closeTask(another.task.id);
  await assert.rejects(another.submit(),/task is closed/);
});

test('contract block-time predicates reject submissions at deadline',async()=>{
  const native=await createNativeHarness({now:NOW}),id=secret(4),expert=secret(3),expiry=BigInt(NOW+2000);
  const leaf=native.pure.memberIdentity(native.marketplaceId,expert,1n,expiry);
  native.call('enroll',[leaf],{issuerSecret:native.issuerSecret});
  native.call('createTask',[id,1n,BigInt(NOW+1000),2n,25n,secret(6)],{ownerSecret:secret(5)});
  native.setTime(NOW+1000);
  assert.throws(()=>native.call('submitReview',[id,[3n,3n,3n]],{expertSecret:expert,profession:1n,validUntil:expiry,eligibilityPath:native.state().members.findPathForLeaf(leaf),feedbackDigest:secret(9),feedbackSalt:secret(10)}),/task deadline passed/);
});

test('task owner authorization protects approval and closure',async()=>{
  const events=[];
  const market=await createMarketplace({now:NOW,onCircuit:event=>events.push(event)});
  const expert=market.enrollExpert({profession:'accounting',expiresAt:NOW+10000});
  const task=await market.createTask({profession:'accounting',deadline:NOW+1000,capacity:2,reward:20,content:'Private test task'});
  const receipt=await market.submitReview({taskId:task.id,credential:expert,feedback:'Review',scores:[3,3,3]});
  // Use the actual generated class to attack the same state with a foreign owner secret.
  const {Contract}=await import('../contracts/managed/reviewlab/contract/index.js');
  const {nativeWitnesses}=await import('../lib/native-engine.mjs');
  const contract=new Contract(nativeWitnesses);
  const current=events.at(-1).result.context;
  const attack={...current,currentPrivateState:{ownerSecret:secret(99)}};
  assert.throws(()=>contract.impureCircuits.approveReview(attack,bytes(receipt.receiptId)),/task owner required/);
  assert.throws(()=>contract.impureCircuits.closeTask(attack,bytes(task.id)),/task owner required/);
});

test('claims require buyer approval and the submitting credential secret',async()=>{
  const {market,expert,submit}=await fixture();
  const receipt=await submit();
  assert.throws(()=>market.claimReward({receiptId:receipt.receiptId,credential:expert}),/not approved/);
  market.approveReview(receipt.receiptId);
  const other=market.enrollExpert({profession:'accounting',expiresAt:NOW+10000});
  assert.throws(()=>market.claimReward({receiptId:receipt.receiptId,credential:other}),/review author required/);
  assert.equal(market.getState().claims,0);
});

test('receipt binds task, salted feedback commitment and all three scores',async()=>{
  const {market,submit}=await fixture();
  const receipt=await submit();
  for(const changes of [{taskId:hex(secret(2))},{taskContentDigest:hex(secret(9))},{feedbackCommitment:hex(secret(3))},{nullifier:hex(secret(4))},{scores:[4,2,5]}]) {
    assert.equal(market.verifyReceipt({...receipt,...changes}).valid,false);
  }
  assert.equal((await verifyPublicReceipt(receipt,market.exportPublicRecord())).included,true);
  const opening=market.getFeedbackOpening(receipt.receiptId);
  const {pureCircuits}=await import('../contracts/managed/reviewlab/contract/index.js');
  assert.equal(hex(pureCircuits.feedbackCommitmentFor(bytes(opening.digest),bytes(opening.salt))),receipt.feedbackCommitment);
});

test('public exports exclude private credentials, feedback openings and proof witnesses',async()=>{
  const {market,expert,submit}=await fixture();
  const receipt=await submit();
  const publicRecord=JSON.stringify(market.exportPublicRecord());
  const opening=market.getFeedbackOpening(receipt.receiptId);
  for(const privateValue of [expert.secret,opening.salt,opening.feedback,opening.digest,'proofData','eligibilityPath','issuerSecret','ownerSecret']) assert.equal(publicRecord.includes(privateValue),false);
});

test('public import detects duplicate receipts, invalid counts and unexpected private fields',async()=>{
  const {market,submit}=await fixture();await submit();
  const original=market.exportPublicRecord();
  const duplicate=structuredClone(original); duplicate.reviews.push(duplicate.reviews[0]);
  assert.equal((await verifyPublicRecord(duplicate)).valid,false);
  const count=structuredClone(original);count.tasks[0].accepted=2;
  assert.equal((await verifyPublicRecord(count)).valid,false);
  const taskContent=structuredClone(original);taskContent.tasks[0].contentDigest=hex(secret(13));
  assert.equal((await verifyPublicRecord(taskContent)).valid,false);
  const secretField=structuredClone(original);secretField.expertSecret='private';
  assert.equal((await verifyPublicRecord(secretField)).valid,false);
});

test('out of range scores and unsafe numeric inputs fail without changing state',async()=>{
  const {market,expert,task}=await fixture();
  await assert.rejects(market.submitReview({taskId:task.id,credential:expert,feedback:'Review',scores:[0,3,3]}),/Score/);
  await assert.rejects(market.submitReview({taskId:task.id,credential:expert,feedback:'Review',scores:[3,3,6]}),/Score/);
  await assert.rejects(market.createTask({profession:'accounting',deadline:NOW+1000,reward:Number.MAX_SAFE_INTEGER+1,content:'Task'}),/Reward/);
  assert.equal(market.getState().reviews.length,0);
});
