import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'artifacts/browser');
await mkdir(output, { recursive: true });
const server = createStaticServer({ port: 0, prefix: '/Midnight-ReviewLab' });
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/Midnight-ReviewLab/`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], remoteRequests = [], cases = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) remoteRequests.push(new URL(request.url()).origin); });
const visible = (selector) => page.locator(selector).waitFor({ state: 'visible' });
const closeDialog = () => page.getByRole('button', { name: 'Close dialog', exact: true }).click();
async function download(click) {
  const pending = page.waitForEvent('download'); await click();
  const file = await pending; return JSON.parse(await readFile(await file.path(), 'utf8'));
}
async function upload(kind, value) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(`[data-action="import-${kind}"]`).first().click();
  await (await chooser).setFiles({ name: 'synthetic-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}
let report;
try {
  await page.goto(base);
  await page.reload();
  await page.getByText('6 open tasks', { exact: true }).waitFor();
  assert.equal(await page.locator('.task-card').count(), 6);
  await page.getByLabel('Search evaluations').fill('code review');
  assert.equal(await page.locator('.task-card').count(), 1);
  await page.getByLabel('Search evaluations').fill('');
  await page.getByRole('button', { name: 'Accounting', exact: true }).click();
  assert.equal(await page.locator('.task-card').count(), 1);
  await page.getByRole('button', { name: 'All evaluations', exact: true }).click();
  await page.screenshot({ path: resolve(output, 'marketplace-desktop.png'), fullPage: true });
  cases.push('Native WASM startup, six campaigns, search and expertise filters');

  await page.getByRole('link', { name: 'Credentials', exact: true }).click();
  await page.getByRole('button', { name: 'Create demo credential', exact: true }).click();
  await page.getByLabel('Expertise area').selectOption('software');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Issue demo credential' }).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  const credential = await download(() => page.getByRole('button', { name: 'Save private credential' }).click());
  assert.equal(credential.profession, 'software');
  assert.match(credential.secret, /^[0-9a-f]{64}$/);
  await page.getByRole('link', { name: /Marketplace 6/ }).click();
  await page.locator('.task-card').filter({ hasText: 'Find the flaw in an AI code review' }).getByRole('link', { name: 'View task' }).click();
  const taskUrl = page.url();
  await page.getByRole('button', { name: 'Write a review' }).click();
  await page.getByRole('button', { name: 'Accuracy: 2 of 5', exact: true }).click();
  await page.getByRole('button', { name: 'Reasoning: 2 of 5', exact: true }).click();
  await page.getByRole('button', { name: 'Safety: 3 of 5', exact: true }).click();
  const feedback = 'Synthetic feedback: cache the pending promise before awaiting it to prevent concurrent duplicate requests.';
  await page.getByLabel('Your feedback', { exact: true }).fill(feedback);
  await page.getByRole('button', { name: 'Submit expert review' }).click();
  await page.getByRole('heading', { name: 'Your review receipt', exact: true }).waitFor();
  const receipt = await download(() => page.getByRole('button', { name: 'Save receipt', exact: true }).click());
  assert.match(receipt.taskContentDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.scores, [2,2,3]);
  assert(!JSON.stringify(receipt).includes(credential.secret));
  await page.getByRole('button', { name: 'Open buyer results', exact: true }).click();
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  await page.getByRole('button', { name: 'Claim entitlement', exact: true }).click();
  await page.getByText('Entitlement recorded', { exact: true }).waitFor();
  await closeDialog();
  cases.push('Credential issuance, private review, complete receipt, owner approval and author claim');

  await page.getByRole('button', { name: 'Write a review' }).click();
  for (const label of ['Accuracy', 'Reasoning', 'Safety']) await page.getByRole('button', { name: `${label}: 4 of 5`, exact: true }).click();
  await page.getByLabel('Your feedback', { exact: true }).fill('A second synthetic review from the same credential must be rejected.');
  await page.getByRole('button', { name: 'Submit expert review' }).click();
  await page.locator('#review-form .form-error').filter({ hasText: /already reviewed/ }).waitFor();
  await closeDialog();
  await page.getByRole('link', { name: 'Lab workspace', exact: true }).click();
  report = await download(() => page.getByRole('button', { name: 'Export record', exact: true }).click());
  assert.equal(report.nativeRecord.reviews.length, 1);
  assert.equal(report.nativeRecord.claims, 1);
  assert(!JSON.stringify(report).includes(credential.secret));
  assert(!JSON.stringify(report).includes(feedback));
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  assert(!storage.includes(credential.secret)); assert(!storage.includes(feedback));
  cases.push('Duplicate blocked and private credential/feedback excluded from exports and storage');

  await upload('report', report);
  await page.getByRole('heading', { name: 'Public workspace report', exact: true }).waitFor();
  await closeDialog();
  const modified = structuredClone(report); modified.tasks[0].answer += ' Tampered.';
  await upload('report', modified);
  await page.locator('#toast').filter({ hasText: /Could not open file/ }).waitFor();
  assert.equal(await page.locator('#modal').isVisible(), false);
  const duplicate = structuredClone(report); duplicate.tasks[1] = duplicate.tasks[0];
  await upload('report', duplicate);
  await page.locator('#toast').filter({ hasText: /Could not open file/ }).waitFor();
  await page.getByRole('link', { name: 'Network & verification', exact: true }).click();
  await upload('receipt', receipt);
  await page.getByRole('heading', { name: 'Receipt check', exact: true }).waitFor();
  assert.match(await page.locator('#modal').innerText(), /consistent/);
  await closeDialog();
  const badReceipt = structuredClone(receipt); badReceipt.scores[0] = 5;
  await upload('receipt', badReceipt);
  await page.getByRole('heading', { name: 'Receipt check', exact: true }).waitFor();
  assert.match(await page.locator('#modal').innerText(), /does not match/);
  await closeDialog();
  cases.push('Native receipt imports, valid reports, rejected metadata tampering and duplicate metadata');

  await page.getByRole('link', { name: 'Lab workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New campaign', exact: true }).click();
  await page.getByLabel('Campaign title').fill('Browser acceptance campaign');
  await page.getByLabel('Original prompt', { exact: true }).fill('Explain why this boundary condition requires checking.');
  await page.getByLabel('AI answer to evaluate').fill('<img src=x onerror=alert(1)> Boundaries never matter.');
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser acceptance campaign', exact: true }).waitFor();
  assert.equal(await page.locator('.answer-box img').count(), 0);
  await page.getByRole('link', { name: 'Lab workspace', exact: true }).click();
  await page.locator('.campaign-row').filter({ hasText: 'Browser acceptance campaign' }).getByRole('button', { name: 'Close task', exact: true }).click();
  await page.getByRole('button', { name: 'Close campaign', exact: true }).click();
  await page.locator('#modal').waitFor({ state: 'hidden' });
  await page.locator('.campaign-row').filter({ hasText: 'Browser acceptance campaign' }).getByRole('link', { name: 'View task', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'This task is closed', exact: true }).isEnabled(), false);
  cases.push('Buyer creates a campaign, task content renders as text, closure disables reviews');

  await page.getByRole('link', { name: 'DUST sponsorship', exact: true }).click();
  await page.getByLabel('Registered NIGHT').fill('20000');
  assert.equal((await page.locator('.calc-value').innerText()).replaceAll(',', ''), '266');
  await page.getByLabel('DUST per transaction', { exact: true }).fill('0');
  await page.locator('#calc-result .form-error').waitFor();
  cases.push('Editable DUST scenario recalculates and rejects zero fee');

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['marketplace','workspace','credentials','sponsorship','privacy','network']) {
    await page.goto(base + '#' + route);
    await page.getByText('Midnight runtime ready', { exact: false }).waitFor({ state: 'attached' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${route} must fit mobile width`);
  }
  await page.goto(base);
  await page.getByText('6 open tasks', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, 'marketplace-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('link', { name: 'Credentials', exact: true }).click();
  await page.getByRole('heading', { name: 'Your expertise. Your identity.', exact: true }).waitFor();
  cases.push('All six screens fit 390px and mobile navigation works');

  assert.deepEqual(errors, [], 'No browser runtime errors');
  assert.deepEqual(remoteRequests, [], 'No automatic third-party requests');
  const evidence = { status: 'passed', testedAt: new Date().toISOString(), browser: await browser.version(), cases, errors: 0, remoteRequests: 0, networkSubmission: false };
  await writeFile(resolve(output, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch(error) {
  await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(()=>{});
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); server.close(); }
