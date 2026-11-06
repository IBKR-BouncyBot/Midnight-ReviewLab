import test from 'node:test';
import assert from 'node:assert/strict';
import {NETWORK_DEFAULTS,resolveNativeBrowserConfig,requireDevelopmentNetwork,requireConnectedNetwork,requireLocalWalletProver,findNativeWallets,checkPublicServices,nativeNetworkErrorMessage} from '../lib/network/config.mjs';
import {createCredential,credentialCommitment,issuerIdentityFor,randomHex32,createNetworkClient} from '../lib/network/sdk-client.mjs';
import {setNetworkId} from '@midnight-ntwrk/midnight-js-network-id';

const page='https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network.html';
test('public Preview defaults retain project-relative proving asset paths',()=>{
  const config=resolveNativeBrowserConfig(NETWORK_DEFAULTS.preview,page);
  assert.equal(config.compiledAssetsUrl,'https://ibkr-bouncybot.github.io/Midnight-ReviewLab/network-contract');
  assert.equal(config.networkId,'preview');
  assert.equal(config.indexerWsUri,'wss://indexer.preview.midnight.network/api/v4/graphql/ws');
  assert.deepEqual(resolveNativeBrowserConfig(NETWORK_DEFAULTS.preview,`${page}#connect`),config);
  assert.throws(()=>resolveNativeBrowserConfig({...NETWORK_DEFAULTS.preview,indexerUri:`${NETWORK_DEFAULTS.preview.indexerUri}#fragment`},page),/fragment/);
});
test('mainnet, cross-network services and foreign compiled keys are rejected',()=>{
  assert.throws(()=>requireDevelopmentNetwork('mainnet'),/development network/);
  assert.throws(()=>resolveNativeBrowserConfig({...NETWORK_DEFAULTS.preview,indexerUri:'https://indexer.mainnet.midnight.network/api/v4/graphql'},page),/different network/);
  assert.throws(()=>resolveNativeBrowserConfig({...NETWORK_DEFAULTS.preview,compiledAssetsUrl:'https://other.example/keys'},page),/page origin/);
  assert.throws(()=>resolveNativeBrowserConfig({...NETWORK_DEFAULTS.preview,indexerUri:'http://remote.example/graphql'},page),/secure/);
});
test('local prover requirement refuses remote, credentialed and unreported destinations',()=>{
  assert.equal(requireLocalWalletProver({proverServerUri:'http://localhost:6300'}),'http://localhost:6300/');
  for(const proverServerUri of [undefined,'https://prover.example/','http://user:pass@localhost:6300','http://localhost:6300/?token=x'])assert.throws(()=>requireLocalWalletProver({proverServerUri}));
});
test('wallet discovery accepts actual API 4 connectors without deduplicating identities',()=>{
  const wallet={apiVersion:'4.0.1',name:'Example',rdns:'org.example',connect(){}};
  const wallets=findNativeWallets({a:wallet,b:{...wallet},old:{...wallet,apiVersion:'3.0.0'},cardano:{enable(){}}});
  assert.deepEqual(wallets.map(value=>value.id),['a','b']);
});
test('wallet network mismatch and disconnected status fail before operations',()=>{
  assert.doesNotThrow(()=>requireConnectedNetwork({status:'connected',networkId:'preview'},{networkId:'preview'},'preview'));
  assert.throws(()=>requireConnectedNetwork({status:'connected',networkId:'preprod'},{networkId:'preview'},'preview'),/match/);
  assert.throws(()=>requireConnectedNetwork({status:'disconnected',networkId:'preview'},{networkId:'preview'},'preview'),/match/);
});
test('credential commitments bind marketplace, secret, profession and expiry',()=>{
  const credential=createCredential({marketplaceId:randomHex32(),profession:'accounting',expiresAt:1900000000});
  const commitment=credentialCommitment(credential);assert.match(commitment,/^[0-9a-f]{64}$/);
  for(const change of [{marketplaceId:randomHex32()},{secret:randomHex32()},{profession:'software'},{expiresAt:1900000001}])assert.notEqual(credentialCommitment({...credential,...change}),commitment);
  assert.throws(()=>credentialCommitment({...credential,secret:'bad'}));
  assert.match(issuerIdentityFor(randomHex32()),/^[0-9a-f]{64}$/);
});
test('SDK rejects missing providers and mismatched global network before any connection',()=>{
  setNetworkId('preview');
  assert.throws(()=>createNetworkClient({}, {networkId:'preview',compiledAssetsPath:'./network-contract'}),/Missing provider/);
  const providers=Object.fromEntries(['privateStateProvider','publicDataProvider','zkConfigProvider','proofProvider','walletProvider','midnightProvider'].map(name=>[name,{}]));
  assert.throws(()=>createNetworkClient(providers,{networkId:'preprod',compiledAssetsPath:'./network-contract'}),/Network changed/);
});
test('service checks contain no wallet data and do not overclaim authentication',async()=>{
  const requests=[];
  const result=await checkPublicServices(NETWORK_DEFAULTS.undeployed,{pageUrl:page,fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({data:{block:{height:10}}})};}});
  assert.equal(requests.length,1);assert.deepEqual(JSON.parse(requests[0].options.body),{query:'{ block { height } }'});
  assert.equal(result.transactionSubmitted,false);assert.equal(result.networkIdentityAuthenticated,false);
});
test('wallet and service failures do not surface secret-bearing raw exception payloads',async()=>{
  const secret='private-secret-example';
  assert.equal(nativeNetworkErrorMessage(new Error(secret)).includes(secret),false);
  await assert.rejects(checkPublicServices(NETWORK_DEFAULTS.undeployed,{pageUrl:page,fetchImpl:async()=>{throw new Error(secret);}}),error=>!error.message.includes(secret));
});
