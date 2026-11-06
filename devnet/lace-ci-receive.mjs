/** Read ONLY the public Preview NIGHT address from the genuine Receive UI.
 * No dApp API, clipboard, private exports, seed derivation or extension storage.
 */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {MidnightBech32m,UnshieldedAddress} from '@midnight-ntwrk/wallet-sdk-address-format';

const origin='chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/';
const visible=locator=>locator.isVisible().catch(()=>false);
const pages=context=>context.pages().filter(page=>!page.isClosed()&&page.url().startsWith(origin));

async function hitTarget(locator){
  if(await locator.count()!==1||!await visible(locator))return false;
  return locator.evaluate(el=>{
    const box=el.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
    if(box.width<=0||box.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
    const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===el||el.contains(hit)));
  });
}

export async function showMidnightAccountCard({context}){
  assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'IBKR-BouncyBot/Midnight-ReviewLab');
  let walletPage;
  for(const page of pages(context))if(await visible(page.getByTestId('main-menu-tab-btn'))){walletPage=page;break;}
  assert.ok(walletPage,'LACE_HOME_UNAVAILABLE');
  const home=walletPage.getByTestId('portfolio-tab-btn');
  if(!await visible(home))await walletPage.getByTestId('main-menu-tab-btn').click();
  await home.click({timeout:20000});
  const card=walletPage.getByTestId('account-card').filter({has:walletPage.getByTestId('account-card-generate-dust-button')});
  await card.waitFor({state:'attached',timeout:60000});assert.equal(await card.count(),1);
  const receive=card.getByTestId('account-card-receive-button');
  if(await hitTarget(receive))return {page:walletPage,card};
  for(let attempt=0;attempt<8;attempt++){
    const previous=walletPage.getByTestId('pagination-previous-button');
    if(!await visible(previous)||!await previous.isEnabled())break;
    await previous.click({timeout:5000});await delay(400);
  }
  for(let attempt=0;attempt<8;attempt++){
    if(await hitTarget(receive))return {page:walletPage,card};
    const next=walletPage.getByTestId('pagination-next-button');
    if(!await visible(next)||!await next.isEnabled())break;
    await next.click({timeout:5000});await delay(400);
  }
  throw new Error('MIDNIGHT_ACCOUNT_CARD_NOT_VISIBLE');
}

export async function readPreviewReceivingAddress({context,evidence,save}){
  assert.equal(evidence.previewSelectedInExtensionUi,true);assert.equal(evidence.internalWasmModeSelected,true);
  evidence.stage='read-public-preview-night-receive-address';await save();
  const {page:walletPage,card}=await showMidnightAccountCard({context});
  await card.getByTestId('account-card-receive-button').click({timeout:15000});
  const unshielded=walletPage.getByTestId('Unshielded');
  const menu=walletPage.getByTestId('receive-sheet-account-dropdown-menu-button');
  await menu.waitFor({state:'visible',timeout:30000});
  if(!await visible(unshielded)){
    await menu.click();
    const optionIds=await walletPage.locator('[data-testid^="dropdown-menu-item-"]').evaluateAll(elements=>
      [...new Set(elements.filter(el=>el.getClientRects().length).map(el=>el.getAttribute('data-testid')).filter(id=>/^dropdown-menu-item-\d+$/.test(id)))]);
    assert.ok(optionIds.length>0&&optionIds.length<=4,'UNEXPECTED_FRESH_WALLET_ACCOUNT_COUNT');
    let found=false;
    for(let index=0;index<optionIds.length;index++){
      if(index>0)await menu.click();
      await walletPage.getByTestId(optionIds[index]).click({timeout:10000});
      await delay(400);
      if(await visible(unshielded)){found=true;break;}
    }
    assert.equal(found,true,'MIDNIGHT_RECEIVING_ACCOUNT_UNAVAILABLE');
  }
  await unshielded.click({timeout:15000});
  await walletPage.waitForFunction(()=>{
    const el=document.querySelector('[data-testid="receive-sheet-address"]');
    return Boolean(el&&el.getClientRects().length&&/^mn_addr_preview1[ac-hj-np-z02-9]+$/.test(el.textContent.trim()));
  },null,{timeout:180000});
  const address=(await walletPage.getByTestId('receive-sheet-address').innerText()).trim();
  const encoded=MidnightBech32m.parse(address);assert.equal(encoded.network,'preview');encoded.decode(UnshieldedAddress,'preview');
  evidence.receivingAddressSource='released-Lace-Receive-Unshielded-UI';
  evidence.receivingAddressChecksumVerified=true;evidence.receivingAddressNetworkVerified='preview';
  await save();
  const close=walletPage.getByTestId('side-sheet-close-button').filter({visible:true});
  assert.equal(await close.count(),1);await close.click();
  await showMidnightAccountCard({context});
  return address;
}
