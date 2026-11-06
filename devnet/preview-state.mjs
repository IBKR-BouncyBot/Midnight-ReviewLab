/** Encrypted, resumable public Preview TEST-wallet checkpoints.
 * Serialization uses the installed wallet SDK's public subwallet APIs.
 * Only an opaque checkpoint name and public address are stored in the pointer.
 */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {readPreviewSecret,writePreviewSecret} from './preview-wallet.mjs';

const directory=resolve(import.meta.dirname,'../.local');
const pointerPath=join(directory,'preview-checkpoint.json');
const namePattern=/^wallet-state-[0-9]{13}-[0-9a-f]{8}$/;
let checkpointQueue=Promise.resolve();

export function previewSyncProgress(state){
  const summary=progress=>Object.fromEntries(['appliedIndex','highestRelevantWalletIndex','highestIndex','highestRelevantIndex','appliedId','highestTransactionId'].filter(name=>progress[name]!==undefined).map(name=>[name,String(progress[name])]).concat([['connected',progress.isConnected===true],['complete',progress.isStrictlyComplete()]]));
  return {shielded:summary(state.shielded.state.progress),unshielded:summary(state.unshielded.progress),dust:summary(state.dust.state.progress)};
}

export function requirePreviewEndpoints(environment){
  const expected={networkId:'preview',walletNetworkId:'preview',node:'https://rpc.preview.midnight.network',nodeWS:'wss://rpc.preview.midnight.network',indexer:'https://indexer.preview.midnight.network/api/v4/graphql',indexerWS:'wss://indexer.preview.midnight.network/api/v4/graphql/ws'};
  for(const [name,value] of Object.entries(expected))if(environment[name]!==value)throw new Error('Preview wallet endpoint scope does not match');
  const prover=new URL(environment.proofServer);
  if(!['http:','https:'].includes(prover.protocol)||!['127.0.0.1','localhost','[::1]'].includes(prover.hostname)||prover.username||prover.password||prover.search||prover.hash)throw new Error('Preview test wallet requires a local prover');
}

export async function loadPreviewCheckpoint(address){
  let pointer;
  try{pointer=JSON.parse(await readFile(pointerPath,'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw new Error('Preview checkpoint pointer is unreadable');}
  if(pointer?.networkId!=='preview'||pointer.address!==address||!namePattern.test(pointer.name))throw new Error('Preview checkpoint has a different wallet or scope');
  const checkpoint=await readPreviewSecret(pointer.name);
  if(checkpoint?.version!==1||checkpoint.networkId!=='preview'||checkpoint.address!==address)throw new Error('Preview checkpoint identity does not match');
  for(const name of ['shielded','unshielded','dust'])if(typeof checkpoint[name]!=='string'||!checkpoint[name].length)throw new Error('Preview checkpoint is incomplete');
  return checkpoint;
}

async function checkpoint(wallet,address){
  if(typeof address!=='string'||!address.startsWith('mn_addr_preview1'))throw new Error('Only public Preview test wallets can be checkpointed');
  const [shielded,unshielded,dust]=await Promise.all([wallet.shielded.serializeState(),wallet.unshielded.serializeState(),wallet.dust.serializeState()]);
  const snapshot={version:1,networkId:'preview',address,createdAt:new Date().toISOString(),shielded,unshielded,dust};
  const name=`wallet-state-${Date.now()}-${randomBytes(4).toString('hex')}`;
  // writePreviewSecret encrypts before writing; no serialized private state is
  // written to a temporary plaintext file or used as a filename.
  await writePreviewSecret(name,snapshot);
  await mkdir(directory,{recursive:true});
  const temporary=`${pointerPath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary,JSON.stringify({version:1,networkId:'preview',address,name,savedAt:snapshot.createdAt},null,2)+'\n',{flag:'wx'});
  await rename(temporary,pointerPath);
  return {savedAt:snapshot.createdAt,serializedBytes:Buffer.byteLength(shielded)+Buffer.byteLength(unshielded)+Buffer.byteLength(dust)};
}

export function savePreviewCheckpoint(wallet,address){
  const operation=checkpointQueue.then(()=>checkpoint(wallet,address));
  checkpointQueue=operation.catch(()=>{});
  return operation;
}

export async function restorePreviewWallet({sdk,ledger,environment,seeds,keystore,checkpoint}){
  requirePreviewEndpoints(environment);
  if(checkpoint.address!==keystore.getBech32Address().asString())throw new Error('Checkpoint does not belong to this test wallet');
  const configuration={indexerClientConnection:{indexerHttpUrl:environment.indexer,indexerWsUrl:environment.indexerWS},provingServerUrl:new URL(environment.proofServer),networkId:'preview',relayURL:new URL(environment.nodeWS),txHistoryStorage:new sdk.InMemoryTransactionHistoryStorage(sdk.WalletEntrySchema,sdk.mergeWalletEntries),costParameters:{feeBlocksMargin:5}};
  const shielded=sdk.ShieldedWallet(configuration).restore(checkpoint.shielded);
  const unshielded=sdk.UnshieldedWallet({...configuration,txHistoryStorage:new sdk.InMemoryTransactionHistoryStorage(sdk.WalletEntrySchema,sdk.mergeWalletEntries)}).restore(checkpoint.unshielded);
  // A positive supported fee overhead prevents the SDK's zero-fee path from
  // creating an empty DustActions intent (upstream midnight-wallet issue 700).
  const dust=sdk.DustWallet({...configuration,costParameters:{ledgerParams:ledger.LedgerParameters.initialParameters(),additionalFeeOverhead:1000n,feeBlocksMargin:5}}).restore(checkpoint.dust);
  const wallet=await sdk.WalletFacade.init({configuration,shielded:()=>shielded,unshielded:()=>unshielded,dust:()=>dust});
  return {wallet,seeds,keystore};
}
