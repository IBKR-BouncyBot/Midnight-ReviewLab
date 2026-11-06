/** Local-only validation of saved finalized bytes. Public accepted transactions
 * are downloaded and replayed with all ledger checks enabled. This diagnostic
 * is not chain inclusion evidence and never submits any transaction.
 */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {readPreviewSecret} from './preview-wallet.mjs';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import WebSocket from 'ws';
const directory=resolve(import.meta.dirname,'../artifacts/public-preview');
const diagnostic={networkId:'preview',checkedAt:new Date().toISOString(),method:'local-strict-ledger-replay',networkSubmission:false,independentChainVerification:false,steps:[]};
const clean=value=>{
 const text=String(value??'');
 if(text==='transaction is not in normal form')return 'transaction is not in normal form';
 if(text==='Local ledger application rejected')return 'Local ledger application rejected';
 if(text==='Public block metadata unavailable')return 'Public block metadata unavailable';
 return 'Local validation failed; details withheld';
};
for(const method of ['log','info','warn','debug','error','trace','dir'])console[method]=()=>{};
async function block(height){const response=await fetch('https://indexer.preview.midnight.network/api/v4/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query($offset: BlockOffset) { block(offset: $offset) { height hash timestamp ledgerParameters } }',variables:{offset:height===undefined?null:{height}}}),signal:AbortSignal.timeout(20000)});const value=await response.json();if(value.errors||!value.data?.block)throw new Error('Public block metadata unavailable');return value.data.block;}
try{
 assert.deepEqual(process.argv.slice(2),['--local-replay']);setNetworkId('preview');
 const evidence=JSON.parse(await readFile(join(directory,'network-evidence.json'),'utf8'));
 const saved=await readPreviewSecret(evidence.pendingSubmission.transactionSecret);
 assert.equal(saved.networkId,'preview');assert.equal(saved.address,evidence.unshieldedAddress);
 const pending=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(saved.transaction,'hex'));
 assert.deepEqual(pending.identifiers(),evidence.pendingSubmission.identifiers);
 diagnostic.transactionId=evidence.pendingSubmission.txId;
 const provider=indexerPublicDataProvider('https://indexer.preview.midnight.network/api/v4/graphql','wss://indexer.preview.midnight.network/api/v4/graphql/ws',WebSocket);
 const strict=new ledger.WellFormedStrictness();for(const key of ['enforceBalancing','verifyNativeProofs','verifyContractProofs','enforceLimits','verifySignatures'])strict[key]=true;
 let state=ledger.LedgerState.blank('preview');
 for(const operation of ['deploy-marketplace','enroll-expert','pending-create-task']){
   const accepted=evidence.acceptedTransactions.find(item=>item.operation===operation);
   const confirmation=operation==='pending-create-task'?null:await provider.watchForTxData(accepted.txId);
   const tx=confirmation?.tx??pending;
   const current=await block(confirmation?Number(confirmation.blockHeight):undefined),previous=await block(current.height-1);
   const entry={operation,referenceBlock:current.height,dustSpendCount:[...tx.intents.values()].reduce((sum,intent)=>sum+(intent.dustActions?.spends.length??0),0),status:'checking'};diagnostic.steps.push(entry);
   state.parameters=ledger.LedgerParameters.deserialize(Buffer.from(current.ledgerParameters,'hex'));
   const verified=tx.wellFormed(state,strict,new Date(current.timestamp));entry.wellFormed=true;
   const [next,result]=state.apply(verified,new ledger.TransactionContext(state,{secondsSinceEpoch:BigInt(Math.floor(current.timestamp/1000)),secondsSinceEpochErr:1,parentBlockHash:previous.hash,lastBlockTime:BigInt(Math.floor(previous.timestamp/1000))}));
   entry.status=result.type;if(result.error)entry.error=clean(result.error);
   if(result.type!=='success')throw new Error('Local ledger application rejected');
   state=next.postBlockUpdate(new Date(current.timestamp));
 }
 diagnostic.status='passed-local-replay';
}catch(error){diagnostic.status='local-validation-stopped';diagnostic.reason=clean(error.message);}
await writeFile(join(directory,'local-replay-diagnostic.json'),JSON.stringify(diagnostic,null,2)+'\n');
process.stdout.write(JSON.stringify(diagnostic)+'\n');
process.exit(0);
