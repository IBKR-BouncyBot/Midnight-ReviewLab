// Adapted from Midnight BallotLab: byte-identical code in an isolated wallet graph.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const runtime=resolve(import.meta.dirname,'.runtime');
const files=['lib/network/sdk-client.mjs','lib/network/config.mjs','lib/network/public-testnet.mjs','lib/native-engine.mjs','contracts/managed/reviewlab/contract/index.js','contracts/reviewlab.compact'];
export async function stageRuntime(){
  const hashes={};
  for(const path of files){
    const bytes=await readFile(join(root,path));if(!bytes.length)throw new Error('Required source is empty');
    const destination=join(runtime,path);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
    hashes[path]=createHash('sha256').update(bytes).digest('hex');
  }
  return {runtime,hashes};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(JSON.stringify(await stageRuntime()));
