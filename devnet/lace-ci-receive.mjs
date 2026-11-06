/** Read ONLY public Preview addresses from the genuine Receive UI.
 * No dApp API, clipboard, private exports, seed derivation or extension storage.
 */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {MidnightBech32m,UnshieldedAddress,DustAddress} from '@midnight-ntwrk/wallet-sdk-address-format';

const origin='chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/';
const visible=async locator=>{
  try{
    return await locator.count()===1&&await locator.isVisible()&&await locator.evaluate(el=>{
      for(let node=el;node instanceof HTMLElement;node=node.parentElement){
        const style=getComputedStyle(node);
        if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return false;
      }
      return true;
    });
  }catch{return false;}
};
const pages=context=>context.pages().filter(page=>!page.isClosed()&&page.url().startsWith(origin));
class ReceiveUiError extends Error {
  constructor(code){super(code);this.name='ReceiveUiError';this.code=code;}
}
const requireUi=(condition,code)=>{if(!condition)throw new ReceiveUiError(code);};
async function waitClosed(locator,timeout=15000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(!await visible(locator))return true;await delay(100);}
  return !await visible(locator);
}

async function hitTarget(locator){
  if(await locator.count()!==1||!await visible(locator))return false;
  return locator.evaluate(el=>{
    const box=el.getBoundingClientRect(),x=box.left+box.width/2,y=box.top+box.height/2;
    if(box.width<=0||box.height<=0||x<0||y<0||x>=innerWidth||y>=innerHeight)return false;
    const hit=document.elementFromPoint(x,y);return Boolean(hit&&(hit===el||el.contains(hit)));
  });
}

export async function showMidnightAccountCard({context,onStep=async()=>{}}){
  assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');assert.equal(process.env.GITHUB_REPOSITORY,'IBKR-BouncyBot/Midnight-ReviewLab');
  let walletPage;
  for(const page of pages(context))if(await visible(page.getByTestId('main-menu-tab-btn'))){walletPage=page;break;}
  requireUi(walletPage,'LACE_HOME_UNAVAILABLE');
  await onStep('receive-wait-for-prior-sheet-close');
  const close=walletPage.getByTestId('side-sheet-close-button').filter({visible:true});
  if(await visible(close)&&!await waitClosed(close,3000)){
    // wasmSettings closes the settings sheet before returning, but its close
    // animation can overlap the next navigation. Only dismiss a known read-only
    // settings/Receive sheet, never a transaction or authentication prompt.
    const known=await visible(walletPage.getByTestId('proof-server-in-process-radio'))||
      await visible(walletPage.getByTestId('receive-sheet-header'));
    if(known){requireUi(await close.count()===1,'RECEIVE_PRIOR_SHEET_AMBIGUOUS');await close.click({timeout:5000});}
    requireUi(await waitClosed(close),'RECEIVE_PRIOR_SHEET_NOT_CLOSED');
  }
  await onStep('receive-show-portfolio');
  const home=walletPage.getByTestId('portfolio-tab-btn');
  if(!await visible(home))await walletPage.getByTestId('main-menu-tab-btn').click();
  await home.click({timeout:20000});
  const card=walletPage.getByTestId('account-card').filter({has:walletPage.getByTestId('account-card-generate-dust-button')});
  await onStep('receive-find-midnight-account-card');
  await card.waitFor({state:'attached',timeout:60000});requireUi(await card.count()===1,'MIDNIGHT_ACCOUNT_CARD_AMBIGUOUS');
  const receive=card.getByTestId('account-card-receive-button');
  if(await hitTarget(receive))return {page:walletPage,card};
  await onStep('receive-position-midnight-account-card');
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
  throw new ReceiveUiError('MIDNIGHT_ACCOUNT_CARD_NOT_VISIBLE');
}

export async function readPreviewReceivingAddress({context,evidence,save}){
  return readPublicReceivingAddress({context,evidence,save,kind:'unshielded'});
}

export async function readPreviewDustReceivingAddress({context,evidence,save}){
  return readPublicReceivingAddress({context,evidence,save,kind:'dust'});
}

async function readPublicReceivingAddress({context,evidence,save,kind}){
  const dust=kind==='dust';
  const tabId=dust?'Dust':'Unshielded';
  let step='receive-check-preview-settings';
  const stage=async name=>{step=name;evidence.stage=name;await save();};
  delete evidence.receiveFailure;
  try{
  requireUi(evidence.previewSelectedInExtensionUi===true&&evidence.internalWasmModeSelected===true,'RECEIVE_PREVIEW_SETTINGS_NOT_CONFIRMED');
  await stage('receive-open-midnight-portfolio');
  const {page:walletPage,card}=await showMidnightAccountCard({context,onStep:stage});
  await stage('receive-open-public-address-sheet');
  await card.getByTestId('account-card-receive-button').click({timeout:15000});
  const unshielded=walletPage.getByTestId('Unshielded');
  const menu=walletPage.getByTestId('receive-sheet-account-dropdown-menu-button');
  await stage('receive-wait-for-account-selector');
  await menu.waitFor({state:'visible',timeout:30000});
  if(!await visible(unshielded)){
    await stage('receive-open-account-selector');
    await menu.click();
    // Released DropdownMenu opens via requestIdleCallback and timers; a click
    // resolving does not mean the portal's option elements exist yet.
    await walletPage.getByTestId('dropdown-menu-item-0').waitFor({state:'visible',timeout:15000});
    const optionIds=await walletPage.locator('[data-testid^="dropdown-menu-item-"]').evaluateAll(elements=>
      [...new Set(elements.filter(el=>el.getClientRects().length).map(el=>el.getAttribute('data-testid')).filter(id=>/^dropdown-menu-item-\d+$/.test(id)))]);
    requireUi(optionIds.length>0&&optionIds.length<=4,'UNEXPECTED_FRESH_WALLET_ACCOUNT_COUNT');
    let found=false;
    for(let index=0;index<optionIds.length;index++){
      await stage(`receive-check-account-option-${index}`);
      if(index>0){await menu.click();await walletPage.getByTestId(optionIds[index]).waitFor({state:'visible',timeout:15000});}
      await walletPage.getByTestId(optionIds[index]).click({timeout:10000});
      await walletPage.getByTestId(optionIds[index]).waitFor({state:'hidden',timeout:15000});
      await delay(400);
      if(await visible(unshielded)){found=true;break;}
    }
    requireUi(found,'MIDNIGHT_RECEIVING_ACCOUNT_UNAVAILABLE');
  }
  await stage(dust?'receive-select-public-dust-tab':'receive-select-public-unshielded-tab');
  await walletPage.getByTestId(tabId).click({timeout:15000});
  await stage(dust?'receive-wait-for-preview-dust-address':'receive-wait-for-preview-address');
  await walletPage.waitForFunction(isDust=>{
    const el=document.querySelector('[data-testid="receive-sheet-address"]');
    const pattern=isDust?/^mn_dust_preview1[ac-hj-np-z02-9]+$/:/^mn_addr_preview1[ac-hj-np-z02-9]+$/;
    return Boolean(el&&el.getClientRects().length&&pattern.test(el.textContent.trim()));
  },dust,{timeout:180000});
  const address=(await walletPage.getByTestId('receive-sheet-address').innerText()).trim();
  await stage('receive-validate-public-address-checksum');
  try{
    const encoded=MidnightBech32m.parse(address);
    requireUi(encoded.network==='preview'&&encoded.asString()===address,'RECEIVE_ADDRESS_NETWORK_INVALID');
    encoded.decode(dust?DustAddress:UnshieldedAddress,'preview');
  }
  catch{throw new ReceiveUiError('RECEIVE_ADDRESS_CHECKSUM_OR_NETWORK_INVALID');}
  if(dust){
    evidence.dustReceivingAddressSource='released-Lace-Receive-Dust-UI';
    evidence.dustReceivingAddressChecksumVerified=true;evidence.dustReceivingAddressNetworkVerified='preview';
  }else{
    evidence.receivingAddressSource='released-Lace-Receive-Unshielded-UI';
    evidence.receivingAddressChecksumVerified=true;evidence.receivingAddressNetworkVerified='preview';
  }
  await save();
  await stage('receive-close-public-address-sheet');
  const close=walletPage.getByTestId('side-sheet-close-button').filter({visible:true});
  requireUi(await close.count()===1,'RECEIVE_SHEET_CLOSE_AMBIGUOUS');await close.click();
  requireUi(await waitClosed(menu)&&await waitClosed(close),'RECEIVE_SHEET_NOT_CLOSED');
  await showMidnightAccountCard({context,onStep:stage});
  await stage(dust?'receive-public-preview-dust-address-confirmed':'receive-public-preview-address-confirmed');
  return address;
  }catch(error){
    const code=error instanceof ReceiveUiError?error.code:error?.name==='TimeoutError'?'RECEIVE_UI_TIMEOUT':'RECEIVE_UI_FAILED';
    // Only fixed control names and rendered booleans are published. Do not
    // copy Playwright errors, account names, QR contents, addresses or DOM text.
    const controls=[];
    for(const page of pages(context).slice(0,4)){
      for(const id of ['side-sheet-close-button','proof-server-in-process-radio','portfolio-tab-btn',
        'account-card-generate-dust-button','account-card-receive-button','pagination-previous-button',
        'pagination-next-button','receive-sheet-header','receive-sheet-account-dropdown-menu-button',
        'dropdown-menu-item-0','Unshielded','Dust','receive-sheet-address','receive-sheet-empty-state']){
        try{const target=page.getByTestId(id);controls.push({id,count:await target.count(),visible:await visible(target),hitTarget:await hitTarget(target)});}
        catch{controls.push({id,unavailable:true});}
      }
    }
    evidence.receiveFailure={code,step,controls};await save();
    throw new ReceiveUiError(code);
  }
}
