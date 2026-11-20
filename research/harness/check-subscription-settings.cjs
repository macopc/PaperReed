const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ main, cdp, evaluate, until }) => {
  const before = process.env.PAPER_REED_SUBPAGES_PHASE === 'before';
  const out = path.resolve(__dirname, '../subpages-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = (expression) => evaluate(cdp, expression);
  const shot = async (name) => {
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, `${before ? 'before' : 'after'}-subscription-${name}.png`), Buffer.from(data, 'base64'));
  };
  const identity = {
    id: 'subscription-fixture', firstName: 'Lin', lastName: 'Wei',
    emailAddress: 'lin.wei.long-mailbox-name@example.test', stripePlan: 'Pro Annual',
    stripePlanEffective: 'Basic', featureUsage: {}, token: 'fixture-only-first',
  };
  await run(`(() => {
    const {IdentityStore}=require('mailspring-exports');
    const original=IdentityStore.identity;
    window.prSetServiceIdentity=(value)=>{window.prServiceIdentity=value;IdentityStore.trigger();};
    window.prRestoreServiceIdentity=()=>{IdentityStore.identity=original;IdentityStore.trigger();};
    IdentityStore.identity=()=>window.prServiceIdentity;
    window.prServiceIdentity=null;
    return true;
  })()`);
  try {
    await main.getByRole('button', { name: '设置', exact: true }).click();
    await main.locator('[data-settings-tab="Subscription"]').click();
    const page = main.locator(before ? '.container-identity' : '.pr-subscription');
    await page.waitFor();
    await shot('desktop');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await run('require("@electron/remote").getCurrentWindow().setContentSize(740,700);true');
    await until(() => run('innerWidth===740 && innerHeight===700'), 'native 740 × 700 settings window');
    await shot('narrow');
    if (!before) {
      const manageMailboxes = page.getByRole('button', { name: '管理邮箱账号' });
      assert.equal(await page.getByRole('button').count(), 1);
      await manageMailboxes.focus();
      await main.keyboard.press('Space');
      await main.locator('[data-settings-tab="Accounts"][aria-current="page"]').waitFor();
      await main.locator('[data-settings-tab="Subscription"]').click();
    }
    await run(`window.prSetServiceIdentity(${JSON.stringify(identity)});true`);
    await page.getByText(identity.emailAddress, { exact: true }).waitFor();
    await shot('linked');
    if (before) {
      console.log('PASS Subscription settings baseline at 1440 and native 740');
      return;
    }

    assert.match(await page.locator('dl').textContent(), /订阅套餐Mailspring Pro Annual.*当前权限Mailspring Basic/);
    const billingHelp = page.getByText('功能以当前权限为准。可在「管理账单」核对付款和订阅状态。', { exact: true });
    assert.equal(await billingHelp.count(), 1);
    assert(await run(`(() => {
      const panel=document.querySelector('.pr-settings-page');
      return panel.scrollWidth<=panel.clientWidth+1 && panel.getBoundingClientRect().right<=innerWidth;
    })()`));
    await run(`(() => {
      const { Actions, IdentityStore }=require('mailspring-exports');
      const { shell }=require('electron');
      const remote=require('@electron/remote');
      const originals={open:shell.openExternal, fetch:window.fetch, identity:IdentityStore._identity,
        refresh:IdentityStore.fetchIdentity, dialog:remote.dialog.showMessageBoxSync, logout:Actions.logoutMailspringIdentity};
      const calls={paths:[], opened:[], refreshes:[], confirms:[], logouts:0, confirm:false};
      window.prServiceCalls=calls;
      window.prUpdateServiceIdentity=(value)=>{IdentityStore._identity=value;window.prSetServiceIdentity(value);};
      IdentityStore._identity=window.prServiceIdentity;
      window.fetch=async (url, init)=>{
        if(new URL(url).pathname!=='/api/login-link') throw new Error('unexpected request in SSO fixture');
        const path=init.body.get('next_path');
        calls.paths.push(path);
        if(calls.deferLink) await new Promise(resolve=>{window.prReleaseServiceLink=resolve;});
        return {ok:true,json:async()=>({path:calls.replyPath || path})};
      };
      IdentityStore.fetchIdentity=(options)=>{
        calls.refreshes.push(options);
        return new Promise((resolve,reject)=>{window.prFinishRefresh=ok=>ok?resolve():reject(new Error('offline'));});
      };
      shell.openExternal=async url=>{calls.opened.push(url);};
      remote.dialog.showMessageBoxSync=(parent,options)=>{
        calls.confirms.push({bound:parent.id===remote.getCurrentWindow().id, options});
        return calls.confirm?1:0;
      };
      Actions.logoutMailspringIdentity=()=>{calls.logouts++;};
      window.prRestoreServiceActions=()=>{
        shell.openExternal=originals.open;window.fetch=originals.fetch;IdentityStore._identity=originals.identity;
        IdentityStore.fetchIdentity=originals.refresh;remote.dialog.showMessageBoxSync=originals.dialog;
        Actions.logoutMailspringIdentity=originals.logout;
      };
      return true;
    })()`);
    const press = async (label) => {
      await page.getByRole('button', { name: label, exact: true }).focus();
      await main.keyboard.press('Enter');
    };
    const status = page.getByRole('status');
    try {
      await press('管理账号');
      await until(() => run('window.prServiceCalls.opened.length===1'), 'account dashboard opens');
      await press('管理账单');
      await until(() => run('window.prServiceCalls.opened.length===2'), 'billing dashboard opens');
      assert.match((await run('window.prServiceCalls.paths'))[1], /#billing$/);
      assert.equal(new URL((await run('window.prServiceCalls.opened'))[1]).hash, '#billing');
      await run('window.prServiceCalls.replyPath="@unrelated.example.test/dashboard";true');
      await press('管理账单');
      await status.getByText('无法打开 Mailspring 页面，请重试。', { exact: true }).waitFor();
      assert.equal(await run('window.prServiceCalls.opened.length'), 2);
      await run('window.prServiceCalls.replyPath=null;window.prServiceCalls.deferLink=true;true');

      await press('管理账单');
      await until(() => run('typeof window.prReleaseServiceLink==="function"'), 'held SSO response');
      const reauthenticated = { ...identity, token: 'fixture-only-second' };
      await run(`window.prUpdateServiceIdentity(${JSON.stringify(reauthenticated)});window.prServiceCalls.deferLink=false;window.prReleaseServiceLink();true`);
      await status.getByText('无法打开 Mailspring 页面，请重试。', { exact: true }).waitFor();
      assert.equal(await run('window.prServiceCalls.opened.length'), 2);

      await press('刷新状态');
      await status.getByText('正在刷新订阅状态…', { exact: true }).waitFor();
      await main.keyboard.press('Enter');
      assert.deepEqual(await run('window.prServiceCalls.refreshes'), [{ requireFresh: true }]);
      await run('window.prFinishRefresh(false);true');
      await status.getByText('无法刷新订阅状态。请检查连接后重试。', { exact: true }).waitFor();
      assert.equal(await run('document.activeElement.textContent.trim()'), '刷新状态');
      await shot('refresh-error');
      await main.keyboard.press('Enter');
      await run('window.prFinishRefresh(true);true');
      await until(async () => (await status.textContent()) === '', 'retry clears refresh feedback');

      const basic = { ...reauthenticated, stripePlan: 'Basic', stripePlanEffective: 'Basic' };
      await run(`window.prUpdateServiceIdentity(${JSON.stringify(basic)});true`);
      assert.equal(await page.getByText('当前权限', { exact: true }).count(), 0);
      assert.equal(await billingHelp.count(), 0);
      await press('查看 Pro 方案');
      await until(() => run('window.prServiceCalls.opened.length===3'), 'existing Pro plan route opens');
      const paths = (await run('window.prServiceCalls.paths')).map((value) => {
        const url = new URL(value, 'https://id.getmailspring.com');
        return url.pathname + url.hash;
      });
      assert.deepEqual(paths, ['/dashboard', '/dashboard#billing', '/dashboard#billing', '/dashboard#billing', '/payment']);

      await press('退出登录…');
      const [confirm] = await run('window.prServiceCalls.confirms');
      assert(confirm.bound);
      assert.equal(confirm.options.defaultId, confirm.options.cancelId);
      assert.equal(confirm.options.buttons[confirm.options.defaultId], '取消');
      assert.match(confirm.options.detail, /会重启.*保存正在编辑的内容.*仍可使用已添加的邮箱账号.*无法重新登录/);
      assert.match(confirm.options.detail, /订阅和续费按原设置继续.*先打开「管理账单」/);
      assert.equal(await run('window.prServiceCalls.logouts'), 0);
      assert.equal(await run('document.activeElement.textContent.trim()'), '退出登录…');
      await run('window.prServiceCalls.confirm=true;true');
      await main.keyboard.press('Enter');
      assert.equal(await run('window.prServiceCalls.logouts'), 1);
    } finally {
      await run('window.prRestoreServiceActions();true');
    }

    assert(await run(`(async () => {
      const {IdentityStore}=require('mailspring-exports');
      const identity=IdentityStore._identity;
      const saveIdentity=IdentityStore.saveIdentity;
      const fetch=window.fetch;
      try {
        IdentityStore.saveIdentity=async next=>{IdentityStore._identity=next;};
        IdentityStore._identity={id:'refresh-first',token:'fixture-only'};
        window.fetch=async()=>{throw new Error('offline fixture');};
        const cached=await IdentityStore.fetchIdentity();
        const failed=await IdentityStore.fetchIdentity({requireFresh:true}).then(()=>false,()=>true);
        let respond;
        window.fetch=()=>new Promise(resolve=>{respond=resolve;});
        const stale=IdentityStore.fetchIdentity({requireFresh:true}).then(()=>false,()=>true);
        IdentityStore._identity={id:'refresh-second',token:'fixture-only'};
        respond({ok:true,json:async()=>({id:'refresh-first'})});
        if (cached.id!=='refresh-first' || !failed || !await stale || IdentityStore._identity.id!=='refresh-second') return false;

        const staleToken=IdentityStore.fetchIdentity({requireFresh:true}).then(()=>false,()=>true);
        IdentityStore._identity={id:'refresh-second',token:'fixture-replaced',stripePlanEffective:'Basic'};
        respond({ok:true,json:async()=>({id:'refresh-second',stripePlanEffective:'Pro'})});
        if (!await staleToken || IdentityStore._identity.stripePlanEffective!=='Basic') return false;

        window.fetch=async()=>({ok:true,json:async()=>({id:'server-returned-another-identity'})});
        const wrongIdentity=await IdentityStore.fetchIdentity({requireFresh:true}).then(()=>false,()=>true);
        return wrongIdentity && IdentityStore._identity.id==='refresh-second';
      } finally {
        window.fetch=fetch;
        IdentityStore._identity=identity;
        IdentityStore.saveIdentity=saveIdentity;
      }
    })()`));

    const responseOrder = await run(`(async () => {
      const {IdentityStore}=require('mailspring-exports');
      const identity=IdentityStore._identity;
      const saveIdentity=IdentityStore.saveIdentity;
      const fetch=window.fetch;
      try {
        const requests=[];
        IdentityStore._identity={id:'response-order',token:'fixture-only',stripePlanEffective:'Basic'};
        IdentityStore.saveIdentity=async next=>{IdentityStore._identity=next;};
        window.fetch=()=>new Promise(resolve=>{requests.push(resolve);});
        const poll=IdentityStore.fetchIdentity();
        const manual=IdentityStore.fetchIdentity({requireFresh:true});
        const reply=(plan)=>({ok:true,json:async()=>({id:'response-order',stripePlanEffective:plan})});
        requests[1](reply('Pro'));
        const manualPlan=(await manual).stripePlanEffective;
        requests[0](reply('Basic'));
        await poll;
        return {manualPlan, finalPlan:IdentityStore._identity.stripePlanEffective};
      } finally {
        window.fetch=fetch;
        IdentityStore.saveIdentity=saveIdentity;
        IdentityStore._identity=identity;
      }
    })()`);
    assert.deepEqual(responseOrder, { manualPlan: 'Pro', finalPlan: 'Pro' }, 'a slow background poll cannot overwrite newer permissions');

    const result = {
      narrowNative740: true,
      unlinkedRoutesToMailboxes: true,
      linkedPlanAndEffectiveTier: true,
      tierMismatchOffersBillingHelp: true,
      serviceLinksAndOriginGuard: true,
      billingAnchorRetainedBySSO: true,
      staleLinkBlockedAfterCredentialChange: true,
      refreshErrorAndFocus: true,
      refreshReportsFailureAndRejectsStaleIdentity: true,
      olderPollingCannotOverwriteManualRefresh: true,
      signOutDefaultsToCancel: true,
      signOutExplainsReloginAndBilling: true,
      expectedSMTPSubmissions: 0,
    };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('PASS Subscription settings', JSON.stringify(result));
  } finally {
    await run('window.prRestoreServiceIdentity();true');
  }
};
