// Read-only, public Preview query. Never opens a wallet or reads private files.
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import WebSocket from 'ws';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {MidnightBech32m,UnshieldedAddress,DustAddress} from '@midnight-ntwrk/wallet-sdk-address-format';

const endpoint='https://indexer.preview.midnight.network/api/v4/graphql';
const websocketEndpoint='wss://indexer.preview.midnight.network/api/v4/graphql/ws';
const fundingTxId='00cae2416d0dacbe8573c7a519f5ce933d7e36004f0ea2e18c6532d793f23c5e6b';
const recipient='mn_addr_preview1h9uhqe9t8pkxmn9ykfk3gwetw8p4uf3vvkqcvsdd9atxhtgqwufshdnhp2';
const parsed=MidnightBech32m.parse(recipient),owner=parsed.decode(UnshieldedAddress,'preview').hexString;
const root=resolve(import.meta.dirname,'..');
const report={schema:'reviewlab-lace-ci-public-registration-verification-v1',status:'running',checkedAt:new Date().toISOString(),networkId:'preview',endpoint,websocketEndpoint,recipient,fundingTxId,confirmationSource:'canonical-public-Preview-indexer',walletAccessed:false,transactionSubmitted:false,independentConsensusOrCryptographicProofVerification:false,publicHistory:[],registrations:[]};
const fail=code=>{throw new Error(code);};
async function query(query,variables={}){
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,variables}),credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!response.ok||response.url!==endpoint||response.redirected)fail('INDEXER_UNAVAILABLE');
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>16*1024*1024)fail('RESPONSE_LIMIT');chunks.push(chunk);}
  const body=JSON.parse(Buffer.concat(chunks,bytes));if(body.errors?.length){report.queryRejected=true;fail('QUERY_REJECTED');}return body.data;
}
const subscription=`subscription($address:UnshieldedAddress!,$transactionId:Int){unshieldedTransactions(address:$address,transactionId:$transactionId){__typename ... on UnshieldedTransaction{transaction{id hash block{height hash timestamp} ... on RegularTransaction{identifiers transactionResult{status} fees{paidFees estimatedFees}}} createdUtxos{owner tokenType value outputIndex intentHash registeredForDustGeneration} spentUtxos{owner tokenType value outputIndex intentHash registeredForDustGeneration}} ... on UnshieldedTransactionsProgress{highestTransactionId}}}`;
async function history(){
  return new Promise((done,reject)=>{
    const items=new Map();let settle,finished=false;const ws=new WebSocket(websocketEndpoint,'graphql-transport-ws',{maxPayload:4*1024*1024});
    const timeout=setTimeout(()=>finish(new Error('HISTORY_TIMEOUT')),45000);
    function finish(error){if(finished)return;finished=true;clearTimeout(timeout);clearTimeout(settle);if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({id:'registration-check',type:'complete'}));ws.close();}else ws.terminate();error?reject(error):done([...items.values()]);}
    ws.on('open',()=>ws.send(JSON.stringify({type:'connection_init',payload:{}})));
    ws.on('error',()=>finish(new Error('HISTORY_CONNECTION_FAILED')));
    ws.on('message',bytes=>{try{
      const message=JSON.parse(bytes.toString());
      if(message.type==='connection_ack'){ws.send(JSON.stringify({id:'registration-check',type:'subscribe',payload:{query:subscription,variables:{address:recipient,transactionId:0}}}));return;}
      if(message.type==='ping'){ws.send(JSON.stringify({type:'pong'}));return;}
      if(message.type==='error'||message.payload?.errors?.length){report.subscriptionRejected=true;return finish(new Error('HISTORY_QUERY_REJECTED'));}
      const event=message.payload?.data?.unshieldedTransactions;if(!event)return;
      if(event.__typename==='UnshieldedTransactionsProgress'){report.highestAddressTransactionId=event.highestTransactionId;clearTimeout(settle);settle=setTimeout(()=>finish(),1800);}
      if(event.__typename==='UnshieldedTransaction'){
        if(items.size>=12)fail('ADDRESS_HISTORY_LIMIT');
        const keep=rows=>(rows??[]).filter(row=>row.owner===recipient).map(({tokenType,value,outputIndex,intentHash,registeredForDustGeneration})=>({tokenType,value,outputIndex,intentHash,registeredForDustGeneration}));
        items.set(event.transaction.id,{...event.transaction,createdUtxos:keep(event.createdUtxos),spentUtxos:keep(event.spentUtxos)});
      }
    }catch{finish(new Error('INVALID_HISTORY_RESPONSE'));}});
  });
}
try{
  report.publicHistory=await history();
  if(!report.publicHistory.some(tx=>tx.identifiers?.includes(fundingTxId)))fail('FUNDING_NOT_IN_ADDRESS_HISTORY');
  for(const event of report.publicHistory){
    if(!event.identifiers?.length||event.identifiers.includes(fundingTxId))continue;
    const data=await query('query($offset:TransactionOffset!){transactions(offset:$offset){raw hash block{height hash timestamp} ... on RegularTransaction{identifiers transactionResult{status} fees{paidFees estimatedFees}}}}',{offset:{identifier:event.identifiers.at(-1)}});
    const exact=data.transactions?.filter(tx=>tx.identifiers?.some(id=>event.identifiers.includes(id)))??[];
    if(exact.length!==1)fail('REGISTRATION_IDENTITY_NOT_UNIQUE');const indexed=exact[0];
    if(!/^(?:[0-9a-f]{2})+$/.test(indexed.raw??'')||indexed.raw.length>16*1024*1024)fail('INVALID_PUBLIC_TRANSACTION');
    const tx=ledger.Transaction.deserialize('signature','proof','binding',Buffer.from(indexed.raw,'hex'));
    if(tx.transactionHash()!==indexed.hash||!tx.identifiers().some(id=>event.identifiers.includes(id)))fail('REGISTRATION_TRANSACTION_IDENTITY_MISMATCH');
    for(const [segment,intent] of tx.intents){
      for(const registration of intent.dustActions?.registrations??[]){
        if(ledger.addressFromKey(registration.nightKey)!==owner)continue;
        const dustProofBytes=(intent.dustActions?.spends??[]).filter(spend=>spend.proof?.instance==='proof').map(spend=>spend.proof.serialize().byteLength);
        report.registrations.push({txId:event.identifiers.at(-1),transactionHash:indexed.hash,blockHeight:Number(indexed.block.height),blockHash:indexed.block.hash,blockTimestamp:indexed.block.timestamp,indexerStatus:indexed.transactionResult?.status,segment,registrationOwnerMatchesRecipient:true,delegationPresent:registration.dustAddress!==undefined,dustAddress:registration.dustAddress===undefined?null:MidnightBech32m.encode('preview',new DustAddress(registration.dustAddress)).asString(),allowedFeePayment:registration.allowFeePayment.toString(),registrationSignaturePresent:typeof registration.signature==='string'&&registration.signature.length>0,dustSpendProofCount:dustProofBytes.length,dustSpendProofBytes:dustProofBytes,paidFeesIndexerUnits:String(indexed.fees?.paidFees)});
      }
    }
  }
  const fundingData=await query('query($offset:TransactionOffset!){transactions(offset:$offset){... on RegularTransaction{identifiers unshieldedCreatedOutputs{owner tokenType value outputIndex intentHash registeredForDustGeneration spentAtTransaction{hash ... on RegularTransaction{identifiers transactionResult{status}}}}}}}',{offset:{identifier:fundingTxId}});
  const funding=fundingData.transactions?.find(item=>item.identifiers?.includes(fundingTxId));
  const ownOutputs=funding?.unshieldedCreatedOutputs?.filter(item=>item.owner===recipient&&item.tokenType===ledger.unshieldedToken().raw)??[];
  if(ownOutputs.length!==1||BigInt(ownOutputs[0].value)!==1_000_000_000n)fail('DIRECT_FUNDING_OUTPUT_MISMATCH');
  report.fundingOutputState=ownOutputs.map(({value,outputIndex,intentHash,registeredForDustGeneration,spentAtTransaction})=>({valueSTAR:value,outputIndex,intentHash,registeredForDustGeneration,spent:spentAtTransaction!==null,spentAtTransaction}));
  report.indexerHead=(await query('{block{height hash timestamp}}')).block;
  report.acceptedRegistrationObserved=report.registrations.some(item=>item.delegationPresent&&item.indexerStatus==='SUCCESS');
  report.status=report.acceptedRegistrationObserved?'accepted-registration-observed':'no-accepted-registration-observed';
  report.limitations=['Public indexer evidence is checked against decoded transaction identifiers and ownership; independent consensus and cryptographic signature/proof verification are not performed.','This check cannot establish whether Lace synchronized the registration or displayed usable DUST capacity.','Only the requested recipient history and matching registration delegation/proof fields are retained; raw transactions and unrelated outputs are omitted.'];
}catch(error){report.status='failed';report.code=/^[A-Z_]+$/.test(error.message)?error.message:'PUBLIC_REGISTRATION_CHECK_FAILED';process.exitCode=1;}
report.completedAt=new Date().toISOString();report.helperSha256=createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
await mkdir(resolve(root,'artifacts'),{recursive:true});await writeFile(resolve(root,'artifacts/lace-ci-registration-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,code:report.code,historyTransactions:report.publicHistory.length,registrationTransactions:report.registrations.length,registrations:report.registrations,fundingOutputState:report.fundingOutputState,indexerHead:report.indexerHead}));
