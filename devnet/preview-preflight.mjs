/** Strict LOCAL validation using replayed public contract history. This is a
 * diagnostic gate, not independently authenticated chain-inclusion evidence.
 * Saved/new finalized transaction bytes never leave this process here.
 */
import assert from 'node:assert/strict';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import WebSocket from 'ws';
const indexer='https://indexer.preview.midnight.network/api/v4/graphql';
async function block(height){
  const response=await fetch(indexer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query($offset: BlockOffset) { block(offset: $offset) { height hash timestamp ledgerParameters } }',variables:{offset:height===undefined?null:{height}}}),signal:AbortSignal.timeout(20000)});
  const value=await response.json();if(value.errors||!value.data?.block)throw new Error('Public block metadata unavailable');return value.data.block;
}
export async function previewTransactionPreflight(transaction,evidence){
  assert.equal(evidence.networkId,'preview');
  const provider=indexerPublicDataProvider(indexer,'wss://indexer.preview.midnight.network/api/v4/graphql/ws',WebSocket);
  const strict=new ledger.WellFormedStrictness();
  for(const name of ['enforceBalancing','verifyNativeProofs','verifyContractProofs','enforceLimits','verifySignatures'])strict[name]=true;
  let state=ledger.LedgerState.blank('preview');
  async function apply(tx,height){
    const current=await block(height),previous=await block(current.height-1);
    state.parameters=ledger.LedgerParameters.deserialize(Buffer.from(current.ledgerParameters,'hex'));
    const verified=tx.wellFormed(state,strict,new Date(current.timestamp));
    const [next,result]=state.apply(verified,new ledger.TransactionContext(state,{secondsSinceEpoch:BigInt(Math.floor(current.timestamp/1000)),secondsSinceEpochErr:1,parentBlockHash:previous.hash,lastBlockTime:BigInt(Math.floor(previous.timestamp/1000))}));
    if(result.type!=='success')throw new Error('Local ledger application failed');
    state=next.postBlockUpdate(new Date(current.timestamp));return current.height;
  }
  const history=evidence.acceptedTransactions.filter(entry=>entry.operation!=='register-test-night-for-dust');
  for(const entry of history){const confirmed=await provider.watchForTxData(entry.txId);assert.equal(confirmed.status,'SucceedEntirely');await apply(confirmed.tx,Number(confirmed.blockHeight));}
  if(evidence.contractAddress){
    const indexed=await provider.queryContractState(evidence.contractAddress),replayed=state.index(evidence.contractAddress);
    assert.ok(indexed&&replayed,'Indexed contract is unavailable');
    assert.deepEqual(Buffer.from(replayed.serialize()),Buffer.from(indexed.serialize()),'Replayed contract differs from current indexer state');
  }
  const referenceBlock=await apply(transaction);
  return {method:'local-strict-ledger-replay',referenceBlock,acceptedContractTransactionsReplayed:history.length,allStrictnessFlagsEnabled:true,currentContractStateMatched:Boolean(evidence.contractAddress),dustSpendCount:[...transaction.intents.values()].reduce((sum,intent)=>sum+(intent.dustActions?.spends.length??0),0),status:'passed',independentChainVerification:false};
}
