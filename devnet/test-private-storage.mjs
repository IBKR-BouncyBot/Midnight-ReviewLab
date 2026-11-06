/** Actual SDK encryption + filesystem LevelDB; random synthetic inputs only.
 * Never opens a wallet, reads an existing database, or accesses the network.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Level } from 'level';
import { levelPrivateStateProvider, StorageEncryption } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { sampleSigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

const root=resolve(import.meta.dirname,'..');
const report={schema:'reviewlab-private-storage-regression/v1',startedAt:new Date().toISOString(),status:'running',backend:'official-Level-provider-with-filesystem-LevelDB',syntheticInputsOnly:true,walletAccess:false,networkRequests:0,tests:[],limitations:[]};
let phase='setup';
const providers=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const password=()=>{for(;;){const value=`Q7!${randomBytes(28).toString('base64url')}@x`;try{validatePassword(value);return value;}catch{}}};
async function entries(path){const db=new Level(path,{keyEncoding:'buffer',valueEncoding:'buffer'});try{await db.open();return await db.iterator().all();}finally{await db.close();}}
const entriesHash=values=>hash(Buffer.concat(values.flatMap(([key,value])=>[Buffer.from(String(key.length)+':'),key,Buffer.from(String(value.length)+':'),value])));
async function files(path){const output=[];for(const item of await readdir(path,{withFileTypes:true})){const next=join(path,item.name);if(item.isDirectory())output.push(...await files(next));else if(item.isFile())output.push(next);else throw new Error('Unexpected filesystem entry');}return output;}
async function check(name,operation){phase=name;await operation();report.tests.push({name,status:'passed'});}

try{
  await mkdir(join(root,'.local/private-storage-tests'),{recursive:true});
  const directory=await mkdtemp(join(root,'.local/private-storage-tests/run-'));
  const database=join(directory,'database');
  const correct=password(),wrong=password(),rotated=password();
  const address='1'.repeat(64),otherContract='2'.repeat(64),stateId='syntheticState';
  const marker=`synthetic-private-${randomBytes(24).toString('hex')}`;
  const signingKey=sampleSigningKey();
  const privateState={secret:marker,nested:{feedback:`synthetic-feedback-${randomBytes(24).toString('hex')}`},counter:9n,bytes:Buffer.from(randomBytes(32))};
  const create=(accountId,pw,path=database)=>{const provider=levelPrivateStateProvider({midnightDbName:path,privateStateStoreName:'reviewlab-private',signingKeyStoreName:'reviewlab-signing',accountId,privateStoragePasswordProvider:()=>pw});provider.setContractAddress(address);providers.push(provider);return provider;};
  const original=create('preview:synthetic-account-a',correct);
  await check('write-and-read-private-state-and-signing-key',async()=>{
    await original.set(stateId,privateState);await original.setSigningKey(address,signingKey);
    assert.deepEqual(await original.get(stateId),privateState);assert.equal(await original.getSigningKey(address),signingKey);
  });
  await check('reopen-after-invalidating-key-cache',async()=>{
    await original.invalidateEncryptionCache();const reopened=create('preview:synthetic-account-a',correct);
    assert.deepEqual(await reopened.get(stateId),privateState);assert.equal(await reopened.getSigningKey(address),signingKey);
  });
  await check('wrong-password-warm-and-cold-reads-do-not-change-records',async()=>{
    const baseline=entriesHash(await entries(database));
    const denied=create('preview:synthetic-account-a',wrong);
    await assert.rejects(()=>denied.get(stateId));await assert.rejects(()=>denied.getSigningKey(address));
    await denied.invalidateEncryptionCache();
    await assert.rejects(()=>denied.get(stateId));await assert.rejects(()=>denied.getSigningKey(address));
    assert.equal(entriesHash(await entries(database)),baseline);
    assert.deepEqual(await original.get(stateId),privateState);assert.equal(await original.getSigningKey(address),signingKey);
  });
  await check('account-isolation-and-network-qualified-account-isolation',async()=>{
    for(const account of ['preview:synthetic-account-b','preprod:synthetic-account-a']){
      const isolated=create(account,correct);assert.equal(await isolated.get(stateId),null);assert.equal(await isolated.getSigningKey(address),null);
      await isolated.set(stateId,{sentinel:'separate-test-namespace'});
      assert.deepEqual(await original.get(stateId),privateState);
    }
  });
  await check('contract-context-isolation',async()=>{
    original.setContractAddress(otherContract);assert.equal(await original.get(stateId),null);
    assert.equal(await original.getSigningKey(otherContract),null);original.setContractAddress(address);
    assert.deepEqual(await original.get(stateId),privateState);
  });
  await check('wrong-password-rotation-is-atomic',async()=>{
    const baseline=entriesHash(await entries(database));
    await assert.rejects(()=>original.changePassword(()=>wrong,()=>rotated));
    await assert.rejects(()=>original.changeSigningKeysPassword(()=>wrong,()=>rotated));
    assert.equal(entriesHash(await entries(database)),baseline);
    assert.deepEqual(await original.get(stateId),privateState);assert.equal(await original.getSigningKey(address),signingKey);
  });
  await check('successful-password-rotation-reopens-state-and-signing-keys',async()=>{
    assert.equal((await original.changePassword(()=>correct,()=>rotated)).entriesMigrated,1);
    assert.equal((await original.changeSigningKeysPassword(()=>correct,()=>rotated)).entriesMigrated,1);
    await original.invalidateEncryptionCache();const reopened=create('preview:synthetic-account-a',rotated);
    assert.deepEqual(await reopened.get(stateId),privateState);assert.equal(await reopened.getSigningKey(address),signingKey);
    await assert.rejects(()=>original.get(stateId));await assert.rejects(()=>original.getSigningKey(address));
  });
  await check('raw-level-records-and-files-contain-no-synthetic-secret-plaintext',async()=>{
    const values=await entries(database);const records=values.filter(([key])=>!key.toString('utf8').endsWith('__midnight_encryption_metadata__'));
    assert(records.length>=4);assert(records.every(([,value])=>StorageEncryption.isEncrypted(value.toString('utf8'))));
    const secretValues=[marker,privateState.nested.feedback,signingKey,correct,wrong,rotated,privateState.bytes.toString('hex')];
    const needles=secretValues.flatMap(value=>[Buffer.from(value),Buffer.from(value,'utf16le'),Buffer.from(Buffer.from(value).toString('base64')),Buffer.from(Buffer.from(value).toString('hex'))]);
    needles.push(privateState.bytes);
    for(const [,value] of values)for(const needle of needles)assert(!value.includes(needle));
    const paths=await files(database);for(const path of paths){const bytes=await readFile(path);for(const needle of needles)assert(!bytes.includes(needle));}
    report.encryptedRecordCount=records.length;report.databaseFileCount=paths.length;report.plaintextMarkersFound=0;
  });
  await check('direct-writes-are-not-password-authentication',async()=>{
    // Separate disposable namespace: never damage the main regression store.
    const probePath=join(directory,'write-boundary-probe');const first=create('preview:synthetic-write-probe',correct,probePath);
    await first.set(stateId,{secret:marker});await first.invalidateEncryptionCache();
    const other=create('preview:synthetic-write-probe',wrong,probePath);
    let writeRejected=false;try{await other.set(stateId,{changed:true});}catch{writeRejected=true;}
    if(writeRejected){assert.deepEqual(await first.get(stateId),{secret:marker});report.directWrongPasswordWriteRejected=true;}
    else{await assert.rejects(()=>first.get(stateId));assert.deepEqual(await other.get(stateId),{changed:true});report.directWrongPasswordWriteRejected=false;report.limitations.push('The SDK set() API encrypts with the supplied password but does not authenticate it against existing records before overwriting. Applications must verify existing state before writes; wrong-password read/rotation protection is not write authorization.');}
  });
  report.sourceSha256=hash(await readFile(new URL(import.meta.url)));
  report.status='passed-with-documented-write-boundary';report.completedAt=new Date().toISOString();
  report.scope='Filesystem LevelDB backend using the same official encryption provider; browser IndexedDB restart and crash recovery are not established.';
}catch{report.status='failed';report.failureStage=phase;report.error='Storage regression failed; synthetic private values and raw error details withheld';process.exitCode=1;}
finally{
  for(const provider of providers)await provider.invalidateEncryptionCache().catch(()=>{});
  const artifacts=join(root,'artifacts/private-storage');await mkdir(artifacts,{recursive:true});
  await writeFile(join(artifacts,'storage-evidence.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report)+'\n');
}
