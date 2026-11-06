/** Test harness only: official wallet WASM worker, no HTTP proving endpoint. */
import {createHash} from 'node:crypto';
import {WasmProver} from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import {Effect} from 'effect';
import {CostModel} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {zkConfigToProvingKeyMaterial} from '@midnight-ntwrk/midnight-js-types';

const circuits=new Set(['enroll','createTask','submitReview','approveReview','claimReward','closeTask']);
const walletKeys={'midnight/zswap/spend':'zswap/9/spend','midnight/zswap/output':'zswap/9/output','midnight/zswap/sign':'zswap/9/sign','midnight/dust/spend':'dust/9/spend'};
const base='https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/';

export async function createLocalWasmProving({zkConfigProvider,metrics}){
  const cache=new Map();
  metrics.publicAssetDownloads??=[];metrics.proofs??=[];metrics.checks??=0;
  async function asset(path){
    if(!/^(?:bls_midnight_2p[0-9]{1,2}|(?:dust|zswap)\/9\/(?:spend|output|sign)\.(?:prover|verifier|bzkir))$/.test(path))throw new Error('Unexpected public parameter');
    if(!cache.has(path))cache.set(path,(async()=>{
      const response=await fetch(base+path,{method:'GET',signal:AbortSignal.timeout(120000)});
      if(!response.ok)throw new Error('Public proving material unavailable');
      const bytes=new Uint8Array(await response.arrayBuffer());
      metrics.publicAssetDownloads.push({path,method:'GET',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      return bytes;
    })());
    return cache.get(path);
  }
  const keyMaterialProvider={
    async lookupKey(key){
      if(circuits.has(key))return zkConfigToProvingKeyMaterial(await zkConfigProvider.get(key));
      const path=walletKeys[key];if(!path)throw new Error('Unexpected proving key');
      const [proverKey,verifierKey,ir]=await Promise.all(['prover','verifier','bzkir'].map(ext=>asset(`${path}.${ext}`)));
      return {proverKey,verifierKey,ir};
    },
    getParams:k=>asset(`bls_midnight_2p${k}`),
  };
  const prover=await Effect.runPromise(WasmProver.create({keyMaterialProvider}));
  const underlying=prover.asProvingProvider();
  const provider={
    async check(preimage,key){const result=await underlying.check(preimage,key);metrics.checks++;return result;},
    async prove(preimage,key,binding){
      const start=performance.now();const result=await underlying.prove(preimage,key,binding);
      metrics.proofs.push({circuit:circuits.has(key)||walletKeys[key]?key:'unrecognized',bytes:result.length,durationMs:Math.round(performance.now()-start)});
      return result;
    },
  };
  // The same official provider handles both contract calls and wallet/DUST.
  const prove=transaction=>transaction.prove(provider,CostModel.initialCostModel());
  return {proofProvider:{proveTx:prove},walletProvingService:{prove}};
}
