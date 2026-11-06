// UI boundary. Every accepted action below uses the real generated Compact engine.
// Private credentials and written feedback deliberately remain in session memory.
const ARCHIVE_KEY = 'reviewlab:last-public-report:v1';
export const professions = Object.freeze({software:'Software engineering',accounting:'Accounting',healthcare:'Healthcare research',science:'Science',legal:'Legal research'});
let engine;
let currentCredential = null;
let engineError = null;
const metadata = new Map();
const writtenFeedback = new Map();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

const samples = [
  {title:'Find the flaw in an AI code review',profession:'software',description:'Evaluate a model’s reasoning about asynchronous JavaScript and identify what it missed.',organization:'Meridian AI',icon:'code',color:'blue',capacity:12,reward:1800,minutes:12,tags:['Code reasoning','JavaScript'],prompt:'Review this cache implementation: async function get(key) { if (!cache.has(key)) cache.set(key, await fetchValue(key)); return cache.get(key); } What happens if two callers request the same missing key concurrently?',answer:'The cache prevents duplicate requests because JavaScript executes in a single thread. The first caller adds the fetched value to the map, and the second caller always sees that value. No additional coordination is needed.',days:7},
  {title:'Put financial reasoning to the test',profession:'accounting',description:'Review a short accounting explanation for accuracy, clarity and missing assumptions.',organization:'Ledger Research',icon:'chart',color:'purple',capacity:8,reward:2400,minutes:15,tags:['Financial reasoning','Explanation quality'],prompt:'A fictional company pays €12,000 on 1 January for a twelve-month software subscription. Explain the distinction between payment and expense recognition, assuming an accrual basis and equal service delivery each month.',answer:'The company records the full €12,000 as January’s expense because cash leaves the bank in January. The payment date determines expense recognition under accrual accounting. There is no prepaid balance after payment.',days:10},
  {title:'Check the evidence behind a health claim',profession:'healthcare',description:'Assess whether a research summary accurately describes correlation and causation.',organization:'Clarity Models',icon:'heart',color:'teal',capacity:10,reward:2200,minutes:14,tags:['Evidence quality','Research literacy'],prompt:'A fictional observational study reports that people using a wellness app have higher self-reported sleep scores. No participants were randomized. What conclusions can the study support?',answer:'This proves the app causes better sleep in everyone. Random assignment is unnecessary because the observed association is statistically significant. The results can be generalized to all age groups without further study.',days:9},
  {title:'Make a technical explanation more reliable',profession:'software',description:'Score an AI assistant’s explanation of password storage and suggest a precise correction.',organization:'Northstar Labs',icon:'terminal',color:'teal',capacity:16,reward:1600,minutes:10,tags:['Security fundamentals','Factuality'],prompt:'Explain why a web application should use a password-hashing function with a unique salt rather than reversible encryption to store passwords.',answer:'Passwords should be encrypted so that the support team can recover them on request. A single shared salt protects every account equally well. A fast general-purpose hash is best because it reduces server load.',days:14},
  {title:'Evaluate a statistical conclusion',profession:'science',description:'Help a research model distinguish what an experiment shows from what it only suggests.',organization:'Meridian AI',icon:'flask',color:'purple',capacity:14,reward:2000,minutes:13,tags:['Statistics','Scientific reasoning'],prompt:'An experiment with 20 participants finds no statistically significant difference between two teaching methods. Can we conclude the methods are equivalent?',answer:'Yes. A nonsignificant result establishes that the methods produce exactly the same outcomes. Sample size and statistical power do not affect this conclusion.',days:12},
  {title:'Spot unsupported claims in a contract summary',profession:'legal',description:'Review a fictional contract explanation for unsupported assumptions and overconfidence.',organization:'Clarity Models',icon:'scales',color:'amber',capacity:6,reward:2800,minutes:18,tags:['Document reasoning','Uncertainty'],prompt:'A fictional contract excerpt says: “Either party may terminate by giving thirty days’ written notice.” No jurisdiction, exceptions or other clauses are provided. Summarize only what this excerpt establishes.',answer:'This contract can always be ended immediately by either party without notice or consequences. The clause proves that all other obligations disappear on termination, regardless of the rest of the contract.',days:8},
];

function safeText(value,max=2000){if(typeof value!=='string'||value.length>max)throw new Error('The file contains an invalid text field.');return value;}
function hex(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))throw new Error('The file contains an invalid identifier.');return value.toLowerCase();}
function bounded(value,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error('The file contains an invalid number.');return value;}
function requireEngine(){if(!engine)throw new Error(engineError||'The Midnight contract runtime is not ready.');return engine;}
function snapshot(){return requireEngine().getState();}
function persist(){try{localStorage.setItem(ARCHIVE_KEY,JSON.stringify(exportPublic()));}catch{/* Quota/private browsing never changes a contract result. */}}
function normalizeTask(task){const meta=metadata.get(task.id)||{};return {...meta,...task,professionLabel:professions[task.profession]||task.profession,reviews:snapshot().reviews.filter(r=>r.taskId===task.id)};}

export async function init(){
  try{
    const native = await import('./native.js');
    engine = await native.createMarketplace();
    for(const sample of samples){
      const task = await engine.createTask({profession:sample.profession,deadline:nowSeconds()+sample.days*DAY,capacity:sample.capacity,reward:sample.reward,content:JSON.stringify({title:sample.title,prompt:sample.prompt,answer:sample.answer})});
      metadata.set(task.id,{...sample,createdAt:Date.now(),sample:true});
    }
    return {ready:true};
  }catch(error){engineError=`Midnight runtime could not start: ${error.message}`;engine=null;return {ready:false,error:engineError};}
}
export function isReady(){return !!engine;}
export function getError(){return engineError;}
export function listTasks(){return engine?snapshot().tasks.map(normalizeTask):[];}
export function getTask(id){return listTasks().find(task=>task.id===id)||null;}
export function getState(){return engine?snapshot():null;}
export function getCredential(){return currentCredential;}
export function listReviews(taskId){return engine?snapshot().reviews.filter(r=>!taskId||r.taskId===taskId).map(r=>({...r,id:r.receiptId,feedback:writtenFeedback.get(r.receiptId)||null,title:metadata.get(r.taskId)?.title||'Evaluation task'})):[];}
export async function createTask(data){
  const title=safeText(data.title,100).trim(),prompt=safeText(data.prompt,6000).trim(),answer=safeText(data.answer,12000).trim();
  if(title.length<6||prompt.length<10||answer.length<10)throw new Error('Please add a title, a complete prompt and the answer to evaluate.');
  if(!Object.hasOwn(professions,data.profession))throw new Error('Choose a supported expertise area.');
  const capacity=bounded(Number(data.capacity),1,1024),reward=bounded(Math.round(Number(data.reward)*100),1,10000000),days=bounded(Number(data.days),1,60);
  const task=await requireEngine().createTask({profession:data.profession,deadline:nowSeconds()+days*DAY,capacity,reward,content:JSON.stringify({title,prompt,answer})});
  metadata.set(task.id,{title,prompt,answer,description:safeText(data.description||'A new evaluation from your workspace.',500),organization:'Your workspace',icon:'sparkles',color:'teal',minutes:15,tags:['Your campaign'],createdAt:Date.now(),sample:false});
  persist();return normalizeTask(task);
}
export async function enroll({profession}){
  if(!Object.hasOwn(professions,profession))throw new Error('Choose a supported expertise area.');
  currentCredential=await requireEngine().enrollExpert({profession,expiresAt:nowSeconds()+90*DAY});
  persist();return currentCredential;
}
export async function submitReview(taskId,{feedback,scores}){
  if(!currentCredential)throw new Error('Create or load an expert credential first.');
  const text=safeText(feedback,6000).trim();
  if(text.length<20)throw new Error('Please write at least 20 characters of useful feedback.');
  if(!Array.isArray(scores)||scores.length!==3||scores.some(s=>!Number.isInteger(s)||s<1||s>5))throw new Error('Score all three criteria from 1 to 5.');
  const receipt=await requireEngine().submitReview({taskId,credential:currentCredential,feedback:text,scores});
  writtenFeedback.set(receipt.receiptId,text);persist();return receipt;
}
export async function approve(receiptId){const result=await requireEngine().approveReview(receiptId);persist();return result;}
export async function claimReward(receiptId){if(!currentCredential)throw new Error('Load the credential used for this review.');const result=await requireEngine().claimReward({receiptId,credential:currentCredential});persist();return result;}
export async function closeTask(taskId){const result=await requireEngine().closeTask(taskId);persist();return result;}
export function verifyReceipt(receipt){return requireEngine().verifyReceipt(receipt);}
export function exportCredential(){if(!currentCredential)throw new Error('No expert credential is loaded.');return {...currentCredential};}
export function importCredential(value){
  if(!value||value.version!==1||typeof value!=='object'||Array.isArray(value))throw new Error('This is not a ReviewLab credential file.');
  const keys=Object.keys(value);if(keys.some(k=>!['version','marketplaceId','secret','profession','expiresAt'].includes(k)))throw new Error('Unexpected credential fields.');
  if(value.marketplaceId!==snapshot().marketplaceId)throw new Error('This credential belongs to another lab session. Return to its original session or issue a new demo credential here.');
  if(!Object.hasOwn(professions,value.profession))throw new Error('Unsupported credential profession.');
  const secret=hex(value.secret);bounded(value.expiresAt,1,Number.MAX_SAFE_INTEGER);
  if(value.expiresAt<=nowSeconds())throw new Error('This credential has expired.');
  const candidate={version:1,marketplaceId:value.marketplaceId,secret,profession:value.profession,expiresAt:value.expiresAt};
  requireEngine().validateCredential(candidate);
  currentCredential=candidate;return currentCredential;
}
export function forgetCredential(){currentCredential=null;}
export function exportPublic(){
  const record=snapshot();return {version:1,kind:'reviewlab-workspace-report',exportedAt:new Date().toISOString(),notice:'Local generated-contract execution only. No blockchain acceptance, professional verification or payment is established. Credentials and written reviewer feedback are excluded.',nativeRecord:record,tasks:record.tasks.map(task=>{const meta=metadata.get(task.id)||{};return {id:task.id,title:meta.title||'',prompt:meta.prompt||'',answer:meta.answer||'',description:meta.description||'',profession:task.profession};})};
}
export async function importPublic(value){
  if(!value||typeof value!=='object'||value.version!==1||value.kind!=='reviewlab-workspace-report')throw new Error('This is not a ReviewLab workspace report.');
  const fields=['version','kind','exportedAt','notice','nativeRecord','tasks'];
  if(Object.keys(value).some(k=>!fields.includes(k)))throw new Error('Unexpected public report fields.');
  const native=value.nativeRecord;
  if(!native||native.kind!=='reviewlab-public-record'||native.mode!=='native-local'||!Array.isArray(native.tasks)||!Array.isArray(native.reviews)||native.tasks.length>1000||native.reviews.length>10000)throw new Error('Invalid or oversized native report.');
  const {verifyPublicRecord,sha256Text}=await import('./native.js');
  const check=await verifyPublicRecord(native);if(!check.valid)throw new Error(check.message);
  const taskById=new Map(native.tasks.map(t=>[t.id,t]));
  if(!Array.isArray(value.tasks)||value.tasks.length!==native.tasks.length)throw new Error('Task metadata does not match the report.');
  const metaIds=new Set(),metas=[];
  for(const t of value.tasks){
    if(!t||typeof t!=='object'||Object.keys(t).some(k=>!['id','title','prompt','answer','description','profession'].includes(k)))throw new Error('Unexpected task metadata fields.');
    hex(t.id);if(!taskById.has(t.id)||metaIds.has(t.id))throw new Error('Duplicate or unknown task metadata.');metaIds.add(t.id);
    const meta={id:t.id,title:safeText(t.title,100),prompt:safeText(t.prompt,6000),answer:safeText(t.answer,12000),description:safeText(t.description,500),profession:t.profession};
    const task=taskById.get(t.id);
    if(meta.profession!==task.profession)throw new Error('Task expertise does not match the committed record.');
    const digest=await sha256Text(JSON.stringify({title:meta.title,prompt:meta.prompt,answer:meta.answer}));
    if(digest!==task.contentDigest)throw new Error('Task content does not match its committed digest.');
    metas.push(meta);
  }
  return {version:1,kind:value.kind,exportedAt:safeText(value.exportedAt,40),nativeRecord:JSON.parse(JSON.stringify(native)),tasks:metas,notice:check.message};
}
export async function getArchivedReport(){try{const raw=localStorage.getItem(ARCHIVE_KEY);return raw?await importPublic(JSON.parse(raw)):null;}catch{return null;}}
export function clearArchivedReport(){localStorage.removeItem(ARCHIVE_KEY);}
export function downloadJson(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
