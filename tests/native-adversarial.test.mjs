import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketplace, createNativeHarness, verifyPublicRecord, verifyPublicReceipt} from '../lib/native-engine.mjs';

// These are deterministic, synthetic local inputs. The tests execute generated
// Compact circuits; they do not generate proofs or submit network transactions.
const NOW = 1_800_000_000;
const zero = () => new Uint8Array(32);
const key = value => {
  const result = zero();
  result[0] = 17;
  new DataView(result.buffer).setUint32(28, value);
  return result;
};
const hex = value => Buffer.from(value).toString('hex');
const bytes = value => Uint8Array.from(Buffer.from(value, 'hex'));

function snapshot(native) {
  const state = native.state();
  return JSON.stringify({
    marketplaceId: state.marketplaceId, issuer: state.issuer,
    root: state.members.root(), firstFree: state.members.firstFree(), full: state.members.isFull(),
    enrolled: [...state.enrolled], tasks: [...state.tasks], reviews: [...state.reviews], spent: [...state.spent],
    totalReviews: state.totalReviews, totalClaims: state.totalClaims,
  }, (_, value) => typeof value === 'bigint' ? `${value}n` : value instanceof Uint8Array ? hex(value) : value);
}

function rejectedWithoutMutation(native, operation, pattern) {
  const before = snapshot(native);
  assert.throws(operation, pattern);
  assert.equal(snapshot(native), before, 'Rejected call must leave the entire accepted ledger unchanged');
}

function enroll(native, expertSecret = key(3), expiry = NOW + 2000, profession = 1n) {
  const validUntil = BigInt(expiry);
  const leaf = native.pure.memberIdentity(native.marketplaceId, expertSecret, profession, validUntil);
  native.call('enroll', [leaf], {issuerSecret: native.issuerSecret});
  return {expertSecret, profession, validUntil, leaf};
}

function reviewInputs(native, credential, changes = {}) {
  const {leaf, ...attributes} = credential;
  return {...attributes, eligibilityPath: native.state().members.findPathForLeaf(leaf),
    feedbackDigest: key(9), feedbackSalt: key(10), ...changes};
}

function createTask(native, {id = key(4), owner = key(5), deadline = NOW + 1000, capacity = 3n,
  reward = 25n, skill = 1n, content = key(6)} = {}) {
  native.call('createTask', [id, skill, BigInt(deadline), capacity, reward, content], {ownerSecret: owner});
  return {id, owner};
}

async function fixture() {
  const native = await createNativeHarness({now: NOW, marketplaceId: key(1), issuerSecret: key(2)});
  const credential = enroll(native);
  const task = createTask(native);
  const submit = (changes = {}, scores = [3n, 3n, 3n]) =>
    native.call('submitReview', [task.id, scores], reviewInputs(native, credential, changes));
  return {native, credential, task, submit};
}

test('raw constructor and enrollment reject empty identities before creating accepted state', async () => {
  await assert.rejects(createNativeHarness({now: NOW, marketplaceId: zero()}), /empty marketplace id/);
  const native = await createNativeHarness({now: NOW});
  const runtime = await import('@midnight-ntwrk/compact-runtime');
  assert.throws(() => native.contract.initialState(runtime.createConstructorContext({}, '0'.repeat(64)), key(1), zero()), /empty issuer identity/);
  rejectedWithoutMutation(native,
    () => native.call('enroll', [zero()], {issuerSecret: native.issuerSecret}), /empty credential commitment/);
});

test('raw task constraints reject boundary violations and preserve exact Uint64 rewards', async () => {
  const native = await createNativeHarness({now: NOW});
  const invalid = [
    [{id: zero()}, /empty task id/],
    [{skill: 0n}, /unsupported profession/],
    [{skill: 6n}, /unsupported profession/],
    [{capacity: 0n}, /capacity/],
    [{capacity: 1025n}, /capacity/],
    [{reward: 0n}, /reward must be positive/],
    [{content: zero()}, /empty task content digest/],
    [{deadline: NOW}, /task deadline passed/],
  ];
  for (const [options, pattern] of invalid) {
    rejectedWithoutMutation(native, () => createTask(native, options), pattern);
  }
  const reward = (1n << 64n) - 1n;
  const {id} = createTask(native, {skill: 5n, capacity: 1024n, reward});
  assert.equal(native.state().tasks.lookup(id).reward, reward);
  assert.equal(native.state().tasks.lookup(id).capacity, 1024n);
  rejectedWithoutMutation(native, () => createTask(native, {id, owner: key(99), content: key(88)}), /task id already exists/);
});

test('deadline-minus-one and expiry-equals-deadline permit a review; the deadline itself rejects another', async () => {
  const native = await createNativeHarness({now: NOW});
  const deadline = NOW + 10;
  const first = enroll(native, key(11), deadline);
  const second = enroll(native, key(12), deadline);
  const task = createTask(native, {deadline, capacity: 2n});
  native.setTime(deadline - 1);
  native.call('submitReview', [task.id, [1n, 5n, 1n]], reviewInputs(native, first));
  assert.equal(native.state().tasks.lookup(task.id).accepted, 1n);
  native.setTime(deadline);
  rejectedWithoutMutation(native,
    () => native.call('submitReview', [task.id, [5n, 1n, 5n]], reviewInputs(native, second)), /task deadline passed/);
});

test('late review validation failures never consume a nullifier or leave a partial review', async () => {
  const {native, credential, task, submit} = await fixture();
  for (const [changes, pattern] of [
    [{expertSecret: zero()}, /empty expert secret/],
    [{feedbackSalt: zero()}, /empty feedback salt/],
    [{feedbackDigest: zero()}, /empty feedback digest/],
  ]) rejectedWithoutMutation(native, () => submit(changes), pattern);
  for (const scores of [[0n, 3n, 3n], [3n, 6n, 3n], [3n, 3n, 0n]]) {
    rejectedWithoutMutation(native, () => submit({}, scores), /scores must be one to five/);
  }
  const nullifier = native.pure.expertNullifier(native.marketplaceId, task.id, credential.expertSecret);
  assert.equal(native.state().spent.member(nullifier), false);
  const receipt = submit({}, [5n, 1n, 5n]);
  assert.equal(native.state().spent.member(nullifier), true);
  assert.equal(native.state().reviews.member(receipt), true);
  assert.equal(native.state().totalReviews, 1n);
});

test('corrupt Merkle siblings and direction bits fail against the genuine registry', async () => {
  const {native, credential, submit} = await fixture();
  const original = reviewInputs(native, credential).eligibilityPath;
  for (const index of [0, original.path.length - 1]) {
    const changedSibling = structuredClone(original);
    changedSibling.path[index].sibling.field += 1n;
    rejectedWithoutMutation(native, () => submit({eligibilityPath: changedSibling}), /not in the trusted registry/);
    const changedDirection = structuredClone(original);
    changedDirection.path[index].goes_left = !changedDirection.path[index].goes_left;
    rejectedWithoutMutation(native, () => submit({eligibilityPath: changedDirection}), /not in the trusted registry/);
  }
  assert.doesNotThrow(() => submit());
});

test('same secret, issuer and task ID cannot replay native credential membership across marketplaces', async () => {
  const first = await createNativeHarness({now: NOW, marketplaceId: key(21), issuerSecret: key(22)});
  const second = await createNativeHarness({now: NOW, marketplaceId: key(23), issuerSecret: key(22)});
  const credentialA = enroll(first, key(24));
  const credentialB = enroll(second, key(24));
  const taskA = createTask(first), taskB = createTask(second);
  const receiptA = first.call('submitReview', [taskA.id, [3n, 3n, 3n]], reviewInputs(first, credentialA));
  rejectedWithoutMutation(second, () => second.call('submitReview', [taskB.id, [3n, 3n, 3n]],
    reviewInputs(first, credentialA)), /attributes or secret/);
  const receiptB = second.call('submitReview', [taskB.id, [3n, 3n, 3n]], reviewInputs(second, credentialB));
  assert.notEqual(hex(receiptA), hex(receiptB));
  assert.notEqual(hex(first.state().reviews.lookup(receiptA).nullifier), hex(second.state().reviews.lookup(receiptB).nullifier));
});

test('owning a different task grants no approval or closure authority over this task', async () => {
  const {native, task, submit} = await fixture();
  const foreign = createTask(native, {id: key(31), owner: key(32)});
  const receipt = submit();
  rejectedWithoutMutation(native,
    () => native.call('approveReview', [receipt], {ownerSecret: foreign.owner}), /task owner required/);
  rejectedWithoutMutation(native,
    () => native.call('closeTask', [task.id], {ownerSecret: foreign.owner}), /task owner required/);
  native.call('approveReview', [receipt], {ownerSecret: task.owner});
  assert.equal(native.state().reviews.lookup(receipt).status, 1n);
  assert.equal(native.state().tasks.lookup(foreign.id).closed, false);
});

test('closure and expiry preserve earned approval/claim rights and immutable receipt fields', async () => {
  const {native, credential, task, submit} = await fixture();
  const receipt = submit();
  const {status: _status, ...immutable} = native.state().reviews.lookup(receipt);
  native.call('closeTask', [task.id], {ownerSecret: task.owner});
  native.setTime(Number(credential.validUntil) + 1);
  native.call('approveReview', [receipt], {ownerSecret: task.owner});
  rejectedWithoutMutation(native,
    () => native.call('approveReview', [receipt], {ownerSecret: task.owner}), /already approved or claimed/);
  native.call('claimReward', [receipt], {expertSecret: credential.expertSecret});
  const {status, ...after} = native.state().reviews.lookup(receipt);
  assert.equal(status, 2n);
  assert.deepEqual(after, immutable);
  assert.equal(native.state().totalReviews, 1n);
  assert.equal(native.state().totalClaims, 1n);
  assert.equal(native.state().tasks.lookup(task.id).accepted, 1n);
  rejectedWithoutMutation(native,
    () => native.call('closeTask', [task.id], {ownerSecret: task.owner}), /already closed/);
  rejectedWithoutMutation(native,
    () => native.call('claimReward', [receipt], {expertSecret: credential.expertSecret}), /not approved or already claimed/);
  rejectedWithoutMutation(native,
    () => native.call('approveReview', [receipt], {ownerSecret: task.owner}), /already approved or claimed/);
});

test('unknown references cannot mutate counters, maps or registry state in any consuming circuit', async () => {
  const {native} = await fixture();
  for (const name of ['approveReview', 'claimReward', 'closeTask']) {
    rejectedWithoutMutation(native, () => native.call(name, [key(999)]), /unknown (review|task)/);
  }
  rejectedWithoutMutation(native,
    () => native.call('submitReview', [key(999), [3n, 3n, 3n]]), /unknown task/);
});

test('the actual Merkle registry accepts exactly 1024 enrollments and still supports its last member', async () => {
  const native = await createNativeHarness({now: NOW});
  for (let i = 1; i <= 1023; i++) {
    native.call('enroll', [key(i)], {issuerSecret: native.issuerSecret});
  }
  assert.equal(native.state().enrolled.size(), 1023n);
  assert.equal(native.state().members.firstFree(), 1023n);
  assert.equal(native.state().members.isFull(), false);
  const credential = enroll(native, key(2000));
  assert.equal(native.state().enrolled.size(), 1024n);
  assert.equal(native.state().members.isFull(), true);
  rejectedWithoutMutation(native,
    () => native.call('enroll', [key(2001)], {issuerSecret: native.issuerSecret}), /credential registry is full/);
  const task = createTask(native);
  const receipt = native.call('submitReview', [task.id, [3n, 3n, 3n]], reviewInputs(native, credential));
  assert.equal(native.state().reviews.member(receipt), true);
});

test('individually consistent receipt digests cannot hide duplicate nullifiers in a public import', async () => {
  const market = await createMarketplace({now: NOW});
  const credential = market.enrollExpert({profession: 'accounting', expiresAt: NOW + 2000});
  const task = await market.createTask({profession: 'accounting', deadline: NOW + 1000, capacity: 2, reward: 1, content: 'Synthetic import test'});
  await market.submitReview({taskId: task.id, credential, feedback: 'Synthetic review', scores: [3, 3, 3]});
  const record = market.exportPublicRecord();
  const forged = structuredClone(record.reviews[0]);
  forged.feedbackCommitment = hex(key(3000));
  const {pureCircuits} = await import('../contracts/managed/reviewlab/contract/index.js');
  forged.receiptId = hex(pureCircuits.receiptDigest(bytes(forged.marketplaceId), bytes(forged.taskId),
    bytes(forged.taskContentDigest), bytes(forged.nullifier), bytes(forged.feedbackCommitment), forged.scores.map(BigInt)));
  assert.notEqual(forged.receiptId, record.reviews[0].receiptId);
  assert.equal((await verifyPublicReceipt(forged)).valid, true);
  record.reviews.push(forged);
  record.tasks[0].accepted = 2;
  const verification = await verifyPublicRecord(record);
  assert.equal(verification.valid, false);
  assert.match(verification.message, /Duplicate, foreign or orphan review/);
});

test('mutable receipt status never upgrades the status read from the supplied local record', async () => {
  const market = await createMarketplace({now: NOW});
  const credential = market.enrollExpert({profession: 'accounting', expiresAt: NOW + 2000});
  const task = await market.createTask({profession: 'accounting', deadline: NOW + 1000, capacity: 1, reward: 1, content: 'Synthetic status test'});
  const receipt = await market.submitReview({taskId: task.id, credential, feedback: 'Synthetic review', scores: [1, 5, 3]});
  const claimedLabel = {...receipt, status: 'claimed'};
  const check = await verifyPublicReceipt(claimedLabel, market.exportPublicRecord());
  assert.equal(check.valid, true, 'Receipt status is deliberately outside the immutable digest');
  assert.equal(check.included, true);
  assert.equal(check.recordedStatus, 'submitted');
  assert.equal(market.verifyReceipt(claimedLabel).currentStatus, 'submitted');
});
