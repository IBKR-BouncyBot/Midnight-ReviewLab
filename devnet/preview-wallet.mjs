/** Dedicated public Preview TEST wallet. No import-time creation or network calls.
 * Secrets are encrypted with Windows CurrentUser DPAPI in ignored .local/.
 * Never use this test-only helper for mainnet or emit a decrypted value.
 */
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const directory=resolve(import.meta.dirname,'../.local');
// Checkpoints can contain the wallet's accumulated private sync state. Bound
// the payload explicitly while allowing the base64 IPC representation overhead.
const maximumPrivateBytes=32*1024*1024;
const maximumProtectedBytes=maximumPrivateBytes+64*1024;
function pathFor(name){if(!/^[a-z][a-z0-9-]{0,60}$/.test(name))throw new Error('Invalid private store name');return join(directory,`preview-${name}.dpapi`);}
function protect(value,decrypt=false){
  if(process.platform!=='win32')throw new Error('This local test key store requires Windows CurrentUser DPAPI');
  if(value.byteLength>(decrypt?maximumProtectedBytes:maximumPrivateBytes))throw new Error('Private test record exceeds the local storage limit');
  const method=decrypt?'Unprotect':'Protect';
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('midnight-reviewlab-preview-test-only-v1'); $result=[Security.Cryptography.ProtectedData]::${method}($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result));`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input:Buffer.from(value).toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
  if(result.status!==0||!result.stdout||!/^[A-Za-z0-9+/=]+$/.test(result.stdout))throw new Error('Local key protection failed; no secret was printed');
  const bytes=Buffer.from(result.stdout,'base64');
  if(bytes.byteLength>(decrypt?maximumPrivateBytes:maximumProtectedBytes)){bytes.fill(0);throw new Error('Protected test record exceeds the local storage limit');}
  return bytes;
}
export async function writePreviewSecret(name,value){
  const clear=Buffer.from(JSON.stringify({version:1,networkId:'preview',value}),'utf8');
  try{await mkdir(directory,{recursive:true});await writeFile(pathFor(name),protect(clear),{flag:'wx',mode:0o600});}
  finally{clear.fill(0);}
}
export async function readPreviewSecret(name){
  const clear=protect(await readFile(pathFor(name)),true);
  try{const record=JSON.parse(clear.toString('utf8'));if(record.version!==1||record.networkId!=='preview')throw new Error('Private test record has a different scope');return record.value;}
  finally{clear.fill(0);}
}
export async function loadPreviewSeed(){
  const value=await readPreviewSecret('wallet');
  if(!value||typeof value.seed!=='string'||!/^[0-9a-f]{64}$/.test(value.seed))throw new Error('Dedicated Preview wallet is unavailable');
  return value.seed;
}
async function publicAddress(){
  const [{WalletSeeds,logger},{createKeystore}]=await Promise.all([import('@midnight-ntwrk/testkit-js'),import('@midnight-ntwrk/wallet-sdk')]);
  logger.level='silent';
  // Derive only the public receiving address; do not start RPC subscriptions.
  const seeds=WalletSeeds.fromMasterSeed(await loadPreviewSeed());
  const address=createKeystore(seeds.unshielded,'preview').getBech32Address().asString();
  if(!address.startsWith('mn_addr_preview1'))throw new Error('Wrong network address');
  return address;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
  try{
    const command=process.argv[2];if(!['create','address'].includes(command)||process.argv.length!==3)throw new Error('Use create or address');
    if(command==='create'){
      try{await loadPreviewSeed();}
      catch(error){if(error.code!=='ENOENT')throw error;await writePreviewSecret('wallet',{seed:randomBytes(32).toString('hex')});}
    }
    const address=await publicAddress();
    process.stdout.write(JSON.stringify({networkId:'preview',purpose:'ReviewLab public testnet only',unshieldedAddress:address,secretStorage:'Windows CurrentUser DPAPI, local ignored directory',faucet:'https://midnight-tmnight-preview.nethermind.dev/'})+'\n');
  }catch{process.stderr.write('Preview wallet preparation failed; private details withheld.\n');process.exitCode=1;}
}
