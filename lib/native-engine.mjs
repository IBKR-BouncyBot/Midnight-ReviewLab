/** Actual generated Compact execution, never a mock proof or network transaction.
 * All roles share one browser process in this research demo. Private state,
 * feedback plaintext, salts and proofData never enter public record exports.
 */
export const PROFESSIONS = Object.freeze({ accounting: 1, software: 2, science: 3, legal: 4, healthcare: 5 });
const professionName = value => Object.keys(PROFESSIONS).find(key => PROFESSIONS[key] === Number(value));
const STATUSES = ['submitted', 'approved', 'claimed'];
const HEX = /^[0-9a-f]{64}$/;
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value, label = 'value') => {
  if (typeof value !== 'string' || !HEX.test(value) || /^0+$/.test(value)) throw new TypeError(`${label} must be a nonzero 32-byte lowercase hexadecimal value`);
  return Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));
};
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} must be an integer from ${min} through ${max}`);
  return value;
}
function skill(value) {
  if (!Object.hasOwn(PROFESSIONS, value)) throw new TypeError('Choose accounting, software, science, legal or healthcare');
  return BigInt(PROFESSIONS[value]);
}
function ratings(values) {
  if (!Array.isArray(values) || values.length !== 3) throw new TypeError('Provide accuracy, reasoning and safety scores');
  return values.map(value => BigInt(integer(value, 'Score', 1, 5)));
}
function randomSecret() {
  const value = new Uint8Array(32);
  do { globalThis.crypto.getRandomValues(value); } while (value.every(byte => byte === 0));
  return value;
}
export async function sha256Text(text) {
  if (typeof text !== 'string') throw new TypeError('Text must be a string');
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
async function modules() {
  const [runtime, bindings] = await Promise.all([
    import('@midnight-ntwrk/compact-runtime'),
    import('../contracts/managed/reviewlab/contract/index.js'),
  ]);
  return { runtime, bindings };
}
const witnessNames = ['issuerSecret', 'ownerSecret', 'expertSecret', 'profession', 'validUntil', 'eligibilityPath', 'feedbackDigest', 'feedbackSalt'];
export const nativeWitnesses = Object.freeze(Object.fromEntries(witnessNames.map(name => [name, ({privateState}) => {
  if (!privateState || !Object.hasOwn(privateState, name)) throw new Error(`Missing private input: ${name}`);
  return [privateState, privateState[name]];
}])));

/** Developer harness. onCircuit receives PRIVATE proof inputs for a local prover.
 * Never persist or expose that callback's values in logs, exports or browser UI.
 */
export async function createNativeHarness({ now, marketplaceId = randomSecret(), issuerSecret = randomSecret(), onCircuit, address } = {}) {
  const { runtime: RT, bindings } = await modules();
  const contract = new bindings.Contract(nativeWitnesses);
  const contractAddress = address ?? RT.sampleContractAddress();
  const coinPublicKey = '0'.repeat(64);
  const initial = contract.initialState(RT.createConstructorContext({}, coinPublicKey), marketplaceId, bindings.pureCircuits.issuerIdentity(issuerSecret));
  let clock = now;
  const time = () => integer(clock ?? Math.floor(Date.now() / 1000), 'Local clock');
  let context = RT.createCircuitContext(contractAddress, coinPublicKey, initial.currentContractState, {}, undefined, undefined, time());
  function call(name, args = [], privateState = {}) {
    if (!Object.hasOwn(contract.impureCircuits, name)) throw new Error('Unknown contract circuit');
    const before = RT.createCircuitContext(contractAddress, coinPublicKey, context.currentQueryContext.state, privateState, undefined, undefined, time());
    const result = contract.impureCircuits[name](before, ...args);
    context = result.context;
    onCircuit?.({name, args, beforeContext: before, result});
    return result.result;
  }
  return Object.freeze({
    contractAddress, marketplaceId, issuerSecret, initial, contract,
    pure: bindings.pureCircuits, state: () => bindings.ledger(context.currentQueryContext.state),
    call, time, setTime(value) { clock = integer(value, 'Local clock'); },
  });
}

function taskDTO(id, task) {
  return {id: hex(id), profession: professionName(task.profession), deadline: Number(task.deadline), capacity: Number(task.capacity),
    reward: Number(task.reward), contentDigest: hex(task.contentDigest), accepted: Number(task.accepted), closed: task.closed};
}
function receiptDTO(marketplaceId, id, review) {
  return {version: 1, mode: 'native-local', marketplaceId, taskId: hex(review.taskId), taskContentDigest: hex(review.taskContentDigest), receiptId: hex(id), nullifier: hex(review.nullifier),
    feedbackCommitment: hex(review.feedbackCommitment), scores: review.scores.map(Number), status: STATUSES[Number(review.status)]};
}
function validateReceipt(receipt, pure) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new TypeError('Receipt must be an object');
  const allowed = ['version','mode','marketplaceId','taskId','taskContentDigest','receiptId','nullifier','feedbackCommitment','scores','status'];
  if (Object.keys(receipt).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(receipt, key))) throw new TypeError('Receipt contains missing or unexpected fields');
  if (receipt.version !== 1 || receipt.mode !== 'native-local' || !STATUSES.includes(receipt.status)) throw new TypeError('Unsupported receipt format');
  const expected = pure.receiptDigest(bytes(receipt.marketplaceId, 'Marketplace id'), bytes(receipt.taskId, 'Task id'), bytes(receipt.taskContentDigest, 'Task content digest'),
    bytes(receipt.nullifier, 'Nullifier'), bytes(receipt.feedbackCommitment, 'Feedback commitment'), ratings(receipt.scores));
  bytes(receipt.receiptId, 'Receipt id');
  if (hex(expected) !== receipt.receiptId) throw new Error('Receipt digest does not match its contents');
  return receipt;
}

export async function verifyPublicReceipt(receipt, record) {
  try {
    const { bindings } = await modules();
    validateReceipt(receipt, bindings.pureCircuits);
    let included = false, recordedStatus;
    if (record) {
      const verification = await verifyPublicRecord(record);
      if (!verification.valid) throw new Error(verification.message);
      const matching = record.marketplaceId === receipt.marketplaceId && record.reviews.find(review => review.receiptId === receipt.receiptId);
      included = Boolean(matching);
      recordedStatus = matching ? matching.status : undefined;
    }
    return {valid: true, included, recordedStatus, message: included ? 'Receipt is consistent and appears in the supplied local record. Status is taken from that record, not authenticated by a blockchain proof.' : 'Receipt digest is consistent. This does not establish inclusion, credential eligibility or blockchain acceptance.'};
  } catch (error) { return {valid: false, included: false, message: error.message}; }
}

export async function verifyPublicRecord(record) {
  try {
    const { bindings } = await modules();
    if (!record || record.version !== 1 || record.kind !== 'reviewlab-public-record' || record.mode !== 'native-local') throw new Error('Unsupported public record');
    const fields = ['version','kind','mode','marketplaceId','contractAddress','expertsEnrolled','tasks','reviews','claims'];
    if (Object.keys(record).some(key => !fields.includes(key)) || fields.some(key => !Object.hasOwn(record,key))) throw new Error('Unexpected or missing public-record fields');
    bytes(record.marketplaceId, 'Marketplace id'); bytes(record.contractAddress, 'Contract address');
    integer(record.expertsEnrolled, 'Credential count', 0, 1024);
    if (!Array.isArray(record.tasks) || record.tasks.length > 10000 || !Array.isArray(record.reviews) || record.reviews.length > 100000) throw new Error('Invalid public record arrays');
    const taskIds = new Set(), receiptIds = new Set(), nullifiers = new Set(), counts = new Map(), contents = new Map();
    for (const task of record.tasks) {
      const fields = ['id','profession','deadline','capacity','reward','contentDigest','accepted','closed'];
      if (!task || Object.keys(task).some(key=>!fields.includes(key)) || fields.some(key=>!Object.hasOwn(task,key))) throw new Error('Invalid public task fields');
      bytes(task.id, 'Task id'); bytes(task.contentDigest, 'Content digest'); skill(task.profession);
      integer(task.deadline, 'Deadline', 1); integer(task.capacity, 'Capacity', 1, 1024); integer(task.reward, 'Reward', 1);
      integer(task.accepted, 'Accepted reviews', 0, task.capacity);
      if (typeof task.closed !== 'boolean' || taskIds.has(task.id)) throw new Error('Invalid or duplicate public task');
      taskIds.add(task.id); counts.set(task.id, 0); contents.set(task.id, task.contentDigest);
    }
    for (const receipt of record.reviews) {
      validateReceipt(receipt, bindings.pureCircuits);
      if (receipt.marketplaceId !== record.marketplaceId || !taskIds.has(receipt.taskId) || receiptIds.has(receipt.receiptId) || nullifiers.has(receipt.nullifier)) throw new Error('Duplicate, foreign or orphan review');
      if (receipt.taskContentDigest !== contents.get(receipt.taskId)) throw new Error('Receipt does not match the task content digest');
      receiptIds.add(receipt.receiptId); nullifiers.add(receipt.nullifier); counts.set(receipt.taskId, counts.get(receipt.taskId) + 1);
    }
    for (const task of record.tasks) if (counts.get(task.id) !== task.accepted) throw new Error('Task review count does not match the record');
    integer(record.claims, 'Claim count', 0, record.reviews.length);
    if (record.claims !== record.reviews.filter(review=>review.status==='claimed').length) throw new Error('Claim count does not match the record');
    return {valid: true, message: 'Public record is internally consistent. It does not establish authenticity, completeness or blockchain acceptance.'};
  } catch(error) { return {valid:false, message:error.message}; }
}

export async function createMarketplace({now, onCircuit} = {}) {
  const native = await createNativeHarness({now, onCircuit});
  const marketId = hex(native.marketplaceId);
  const owners = new Map();
  const feedbackOpenings = new Map();
  function credentialInputs(credential) {
    if (!credential || credential.version !== 1 || credential.marketplaceId !== marketId) throw new Error('Credential belongs to another marketplace or has an unsupported format');
    const secret = bytes(credential.secret, 'Expert secret');
    const profession = skill(credential.profession);
    const validUntil = BigInt(integer(credential.expiresAt, 'Credential expiry', 1));
    const leaf = native.pure.memberIdentity(native.marketplaceId, secret, profession, validUntil);
    const eligibilityPath = native.state().members.findPathForLeaf(leaf);
    if (!eligibilityPath) throw new Error('Credential is not enrolled in this marketplace');
    return {expertSecret:secret, profession, validUntil, eligibilityPath};
  }
  function ownerFor(taskId) {
    if (!owners.has(taskId)) throw new Error('This session does not have the task owner key');
    return {ownerSecret: owners.get(taskId)};
  }
  function reviewFor(receiptId) {
    const id = bytes(receiptId, 'Receipt id');
    if (!native.state().reviews.member(id)) throw new Error('Unknown receipt');
    return native.state().reviews.lookup(id);
  }
  function receiptFor(receiptId) { return receiptDTO(marketId, bytes(receiptId), reviewFor(receiptId)); }
  function snapshot() {
    const state = native.state();
    return {version:1,kind:'reviewlab-public-record',mode:'native-local',marketplaceId:marketId,contractAddress:native.contractAddress,
      expertsEnrolled:Number(state.enrolled.size()),tasks:Array.from(state.tasks, ([id,task])=>taskDTO(id,task)),
      reviews:Array.from(state.reviews,([id,review])=>receiptDTO(marketId,id,review)),claims:Number(state.totalClaims)};
  }
  return Object.freeze({
    mode:'native-local', marketplaceId:marketId, contractAddress:native.contractAddress,
    validateCredential(credential) {
      credentialInputs(credential);
      if(credential.expiresAt<=native.time()) throw new Error('Credential has expired');
      return {valid:true,profession:credential.profession,expiresAt:credential.expiresAt};
    },
    enrollExpert({profession, expiresAt = native.time() + 365 * 24 * 60 * 60} = {}) {
      const skillId = skill(profession); const expiry = integer(expiresAt,'Credential expiry',1); const secret = randomSecret();
      const member = native.pure.memberIdentity(native.marketplaceId, secret, skillId, BigInt(expiry));
      native.call('enroll', [member], {issuerSecret:native.issuerSecret});
      return {version:1,marketplaceId:marketId,secret:hex(secret),profession,expiresAt:expiry};
    },
    async createTask({id=hex(randomSecret()),profession,deadline,capacity=20,reward=25,contentDigest,content}={}) {
      const taskId=bytes(id,'Task id'), ownerSecret=randomSecret();
      const contentHash=contentDigest ?? await sha256Text(content ?? JSON.stringify({profession,deadline,capacity,reward}));
      native.call('createTask',[taskId,skill(profession),BigInt(integer(deadline,'Task deadline',1)),BigInt(integer(capacity,'Capacity',1,1024)),BigInt(integer(reward,'Reward',1)),bytes(contentHash,'Content digest')],{ownerSecret});
      owners.set(id,ownerSecret);
      return taskDTO(taskId,native.state().tasks.lookup(taskId));
    },
    async submitReview({taskId,credential,feedback,scores}={}) {
      if(typeof feedback!=='string'||feedback.trim().length<1||feedback.length>20000) throw new Error('Feedback must contain 1 to 20,000 characters');
      const privateState=credentialInputs(credential), feedbackSalt=randomSecret(), digest=bytes(await sha256Text(feedback));
      const receiptId=hex(native.call('submitReview',[bytes(taskId,'Task id'),ratings(scores)],{...privateState,feedbackDigest:digest,feedbackSalt}));
      feedbackOpenings.set(receiptId,{feedback,salt:hex(feedbackSalt),digest:hex(digest)});
      return receiptFor(receiptId);
    },
    approveReview(receiptId) {
      const review=reviewFor(receiptId);
      native.call('approveReview',[bytes(receiptId)],ownerFor(hex(review.taskId)));
      return receiptFor(receiptId);
    },
    claimReward({receiptId,credential}={}) {
      if(!credential||credential.marketplaceId!==marketId||credential.version!==1) throw new Error('Credential belongs to another marketplace');
      native.call('claimReward',[bytes(receiptId,'Receipt id')],{expertSecret:bytes(credential.secret,'Expert secret')});
      return receiptFor(receiptId);
    },
    closeTask(taskId) {
      native.call('closeTask',[bytes(taskId,'Task id')],ownerFor(taskId));
      return taskDTO(bytes(taskId),native.state().tasks.lookup(bytes(taskId)));
    },
    verifyReceipt(receipt) {
      try {
        validateReceipt(receipt,native.pure);
        const included=receipt.marketplaceId===marketId&&native.state().reviews.member(bytes(receipt.receiptId));
        return {valid:true,included,currentStatus:included?receiptFor(receipt.receiptId).status:undefined,message:included?'Receipt matches this local contract state. No network proof has been checked.':'Receipt is internally consistent but does not appear in this local session.'};
      } catch(error) {return {valid:false,included:false,message:error.message};}
    },
    getFeedbackOpening(receiptId) {
      const opening=feedbackOpenings.get(receiptId);
      if(!opening) throw new Error('Feedback opening is not available in this session');
      return {...opening};
    },
    getState:snapshot,exportPublicRecord:snapshot,
  });
}
