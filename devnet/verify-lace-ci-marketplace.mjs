/** Read-only public recheck of the seven genuine Lace CI transactions.
 * No wallet, private record, proving or submission. The indexer cannot attest
 * where proofs were generated; the separate runner evidence records that UI.
 */
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyIndexedTransaction} from './lace-ci-marketplace.mjs';

const contract='7454e6f34f77f0de82f251f92e315a0db5df2a5bba98f9d21511eae919ef93d3';
const expected=[
  ['deploy',null,'0098b6ff70fc0009e324ac2b51402b03dfbe6f6f5072953d641920968bff802e9e'],
  ['create-task','createTask','0030d453061674c543ac8880b57525f01a448767b5d3a8a3992457ce8534f6a0de'],
  ['enroll-expert','enroll','00895f50113a8a316d42ebe2cc00b2c69f13f9a78f3f906d39127f5d5773bc42a8'],
  ['submit-review','submitReview','003a93513bd948beb9869811dbcd20ca36430e2418992a7187b95a944c8724763f'],
  ['approve-review','approveReview','004b3b5238aa661bb0e524983687555b31d617172e1a71e267d95dacfb1780102f'],
  ['claim-entitlement','claimReward','000ecc087453dcc17a3b7d721ef458d5818c052cc2aea87ca66612a4b16ae0a18b'],
  ['close-task','closeTask','0057232c3c6edd083d7c74bc5789817f80c2a8086067368fa4748eb4ca05683310'],
];
const root=resolve(import.meta.dirname,'..');
const report={schema:'reviewlab-public-lace-lifecycle-recheck-v1',checkedAt:new Date().toISOString(),networkId:'preview',
  workflowRunId:'42297109348',contractAddress:contract,status:'failed',walletAccess:false,transactionSubmitted:false,
  privateRecordRead:false,provingPerformed:false,provingLocationAttested:false,independentConsensusOrCryptographicProofVerification:false};
try{
  if(process.argv.length!==2)throw new Error('NO_ARGUMENTS_EXPECTED');
  const results=await Promise.allSettled(expected.map(async([operation,entry,id])=>({operation,...await verifyIndexedTransaction(id,contract,entry)})));
  if(results.some(item=>item.status!=='fulfilled'))throw new Error('PUBLIC_TRANSACTION_CHECK_FAILED');
  report.acceptedTransactions=results.map(item=>item.value);
  report.contractProofCount=report.acceptedTransactions.reduce((n,item)=>n+item.contractCalls.length,0);
  report.dustProofCount=report.acceptedTransactions.reduce((n,item)=>n+item.dustProofBytes.length,0);
  if(report.contractProofCount!==6||report.dustProofCount!==7)throw new Error('PROOF_COUNT_MISMATCH');
  report.sourceSha256=createHash('sha256').update(await readFile(import.meta.filename)).digest('hex');
  report.status='passed';
}catch{report.errorCode='PUBLIC_LACE_LIFECYCLE_RECHECK_FAILED';process.exitCode=1;}
const directory=resolve(root,'artifacts/lace-ci-lifecycle-recheck');await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'evidence.json'),JSON.stringify(report,null,2)+'\n');
if(report.status==='passed')await writeFile(resolve(root,'docs/lace-ci-public-verification.json'),JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({status:report.status,transactionCount:report.acceptedTransactions?.length,
  contractProofCount:report.contractProofCount,dustProofCount:report.dustProofCount,errorCode:report.errorCode})+'\n');
