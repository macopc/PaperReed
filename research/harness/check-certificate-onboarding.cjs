const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ phase, main, run, until, shot, out, fixture, work }) => {
  const certPath = path.join(work, 'onboarding-review.crt');
  const certKey = path.join(work, 'onboarding-review.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
    '-pkeyopt', 'ec_param_enc:named_curve', '-nodes', '-sha256', '-days', '2', '-subj', '/CN=Paper Reed Test Mail',
    '-addext', 'subjectAltName=DNS:mail.example.test,IP:127.0.0.1',
    '-keyout', certKey, '-out', certPath], { stdio: 'ignore' });
  const cert = new X509Certificate(fs.readFileSync(certPath));
  const fingerprint = cert.fingerprint256.replace(/:/g, '').toLowerCase();
  const rejected = (service, port) => ({
    service, host: '127.0.0.1', port, sha256: fingerprint, chain: [cert.raw.toString('base64')],
  });
  const original = [rejected('imap', 993), rejected('smtp', 465)];
  const active = main.locator('.page-container:not([inert])');
  const page = active.locator('.AccountCertificatePage');
  const accept = page.getByRole('button', { name: '修复后重新验证', exact: true });
  const back = page.getByRole('button', { name: '返回设置', exact: true });
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const captureCertificate = async name => {
    await active.and(main.locator('.alpha-fade-enter-done')).locator('.AccountCertificatePage').waitFor();
    await main.locator('.page-container[inert], .page-container.alpha-fade-exit').waitFor({ state: 'detached' });
    await paint();
    await shot(name);
  };
  const resize = async (width, height) => {
    await run(`require("@electron/remote").getCurrentWindow().setContentSize(${width},${height});true`);
    await until(() => run(`innerWidth===${width} && innerHeight===${height}`), `certificate window ${width} × ${height}`);
    await paint();
  };
  await active.locator('[data-provider=imap]').click();
  await active.locator('#name').fill('Maya Chen');
  await active.locator('#emailAddress').fill(fixture.emailAddress);
  await active.locator('[id="settings.imap_password"]').fill(fixture.settings.imap_password);
  await active.locator('[data-manual-setup]').click();
  await active.locator('[id="settings.imap_host"]').fill('127.0.0.1');
  await active.locator('[id="settings.smtp_host"]').fill('127.0.0.1');

  const connect = active.getByRole('button', { name: '连接邮箱', exact: true });
  if (phase === 'native-imap' || phase === 'native-smtp') {
    const service = phase.slice('native-'.length);
    const trustedLabel = service === 'imap' ? '收信服务器 IMAP' : '发信服务器 SMTP';
    const leaf = new X509Certificate(fs.readFileSync(path.join(work, 'native-certificate.pem')));
    const expectedFingerprint = leaf.fingerprint256.replace(/:/g, '').toLowerCase();
    const field = key => active.locator(`[id="settings.${key}"]`);
    for (const protocol of ['imap', 'smtp']) {
      const settings = fixture.settings;
      await field(`${protocol}_port`).selectOption('0');
      await field(`${protocol}_port_custom`).fill(String(settings[`${protocol}_port`]));
      await field(`${protocol}_security`).selectOption(settings[`${protocol}_security`]);
      await field(`${protocol}_username`).fill(settings[`${protocol}_username`]);
      await field(`${protocol}_password`).fill(settings[`${protocol}_password`]);
    }

    // Observe the real subprocess response and rethrow it unchanged so the form owns navigation.
    await run(`(()=>{
      const {MailsyncProcess}=require('mailspring-exports');
      const test=MailsyncProcess.prototype.test;
      const reports=window.prNativeCertificateReports=[];
      MailsyncProcess.prototype.test=async function(){
        const {imap_certificate_sha256,smtp_certificate_sha256}=this.account.settings;
        try { return await test.call(this); }
        catch (err) {
          reports.push({errorCode:err.errorCode,certificateDetailsOnly:err.certificateDetailsOnly,
            certificates:err.certificates,imap_certificate_sha256,smtp_certificate_sha256});
          throw err;
        }
      };
      window.prRestoreNativeCertificateTest=()=>{MailsyncProcess.prototype.test=test;};
      return true;
    })()`);
    try {
      const assertNativeReports = async count => {
        const reports = await run('window.prNativeCertificateReports');
        assert.equal(reports.length, count);
        for (const report of reports) {
          assert.deepEqual(report, {
            errorCode: 'ErrorCertificate', certificateDetailsOnly: true,
            certificates: [{ service, host: '127.0.0.1', port: fixture.settings[`${service}_port`],
              sha256: expectedFingerprint, chain: [leaf.raw.toString('base64')] }],
          });
        }
      };
      await connect.click();
      await active.and(main.locator('.alpha-fade-enter-done')).locator('.AccountCertificatePage').waitFor();
      await assertNativeReports(1);
      const details = page.locator('.certificate');
      assert.match(await details.innerText(), new RegExp(`${trustedLabel}\\s+127\\.0\\.0\\.1:${fixture.settings[`${service}_port`]}`));
      assert.match(await details.innerText(), /签发者/);
      assert.match(await details.innerText(), /有效期/);
      assert.match(await details.innerText(), /适用名称\s+\S/);
      assert.equal((await details.locator('.fingerprint').textContent()).replace(/:/g, '').toLowerCase(), expectedFingerprint);
      assert.equal(await accept.getAttribute('aria-disabled'), 'false',
        'a readable certificate with a matching fingerprint can be revalidated');
      assert.match(await page.innerText(), /核对.*证书来源.*加入系统信任/,
        'show the private certificate recovery instructions after a real TLS rejection');
      await until(() => run('document.fonts.status==="loaded"'), 'native certificate page fonts');
      await resize(900, 660);
      await captureCertificate(`after-certificate-${service}-native-desktop`);
      await resize(420, 500);
      await captureCertificate(`after-certificate-${service}-native-narrow`);

      await accept.click();
      const rejectedAgain = page.getByRole('alert').filter({ hasText: '已核对的证书仍未通过验证' });
      await rejectedAgain.waitFor();
      await assertNativeReports(2);
      assert.match(await rejectedAgain.textContent(), new RegExp(trustedLabel));
      assert.match(await rejectedAgain.textContent(), /加入系统信任/);
      assert.equal(await accept.getAttribute('aria-disabled'), 'true');
      assert(await run(`(()=>{
        const review=document.querySelector('.page-container:not([inert]) .pr-certificate-setup');
        const title=review.querySelector('h2').getBoundingClientRect();
        const actions=review.querySelector('.pr-certificate-actions').getBoundingClientRect();
        const fingerprint=review.querySelector('.fingerprint').getBoundingClientRect();
        return review.scrollTop===0 && title.top>=review.getBoundingClientRect().top+40 &&
          fingerprint.bottom<=actions.top && document.activeElement.classList.contains('pr-certificate-return');
      })()`), 'show the complete heading and fingerprint while restoring return focus after a real TLS retry');
      await captureCertificate(`after-certificate-${service}-native-retry`);
      await back.click();
      await connect.click();
      await rejectedAgain.waitFor();
      await assertNativeReports(3);
      assert.equal(await accept.getAttribute('aria-disabled'), 'true');
      await run('document.querySelector(".page-container:not([inert]) .pr-certificate-retry").click();true');
      await paint();
      await assertNativeReports(3);
      assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'), 0);
      const result = { nativeCertificateReport: service, certificateSubject: leaf.subject ? 'present' : 'empty',
        parsedCertificateDetails: true,
        systemTrustEnforcedOnRetry: true, repeatedRejectionOnReentry: true, noAccountsCreated: true };
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
      console.log('PASS native certificate onboarding', JSON.stringify(result));
      return;
    } finally {
      await run('window.prRestoreNativeCertificateTest();true');
    }
  }

  await run(`(()=>{
    const {MailsyncProcess}=require('mailspring-exports');
    const originalTest=MailsyncProcess.prototype.test;
    const probe=window.prCertificateReview={calls:[]};
    MailsyncProcess.prototype.test=async function(){
      const cfg=this.account.settings;
      probe.calls.push({imap:cfg.imap_certificate_sha256,smtp:cfg.smtp_certificate_sha256});
      if(probe.calls.length===1){
        throw Object.assign(new Error('fixture certificate rejected'),{certificates:${JSON.stringify(original)}});
      }
      return new Promise((resolve,reject)=>{
        probe.resolve=resolve;
        probe.reject=details=>reject(Object.assign(new Error('fixture retry failed'),details));
      });
    };
    probe.restore=()=>{MailsyncProcess.prototype.test=originalTest;};
    return true;
  })()`);
  try {
    await active.getByRole('button', { name: '连接邮箱', exact: true }).click();
    await active.and(main.locator('.alpha-fade-enter-done')).locator('.AccountCertificatePage').waitFor();
    await until(() => run('document.fonts.status==="loaded"'), 'certificate page fonts');
    await resize(900, 660);
    await captureCertificate(`${phase}-certificate-desktop`);
    await resize(420, 500);
    await run('document.querySelector(".page-container:not([inert]) .AccountCertificatePage").scrollTop=0;true');
    await paint();
    await captureCertificate(`${phase}-certificate-narrow`);
    if (phase === 'before') return;

    const signFixtureLeaf = (name, subject, encoding, serial, extensions) => {
      const leafPath = path.join(work, name);
      execFileSync('openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
        '-pkeyopt', `ec_param_enc:${encoding}`, '-nodes', '-sha256', '-subj', subject,
        '-keyout', leafPath + '.key', '-out', leafPath + '.csr'], { stdio: 'ignore' });
      execFileSync('openssl', ['x509', '-req', '-in', leafPath + '.csr', '-CA', certPath, '-CAkey', certKey,
        '-set_serial', serial, '-sha256', '-days', '2', '-extfile', extensions,
        '-out', leafPath + '.crt'], { stdio: 'ignore' });
      return new X509Certificate(fs.readFileSync(leafPath + '.crt'));
    };
    const sameNameExtensions = path.join(work, 'same-name-leaf.ext');
    fs.writeFileSync(sameNameExtensions, 'subjectAltName=DNS:mail.example.test,IP:127.0.0.1\n');
    const sameNameResults = [];
    for (const [encoding, serial] of [['named_curve', '2'], ['explicit', '3']]) {
      const leaf = signFixtureLeaf(`same-name-${encoding}`, '/CN=Paper Reed Test Mail', encoding, serial, sameNameExtensions);
      assert.equal(leaf.subject, leaf.issuer);
      assert(leaf.checkIssued(leaf), 'fixture reaches the name-based self-issued check');
      assert(leaf.verify(cert.publicKey));
      assert(!leaf.verify(leaf.publicKey));
      const report = { ...original[0], sha256: leaf.fingerprint256, chain: [leaf.raw.toString('base64')] };
      const problems = await run(`(()=>{
        const {describeRejectedCertificate}=require(AppEnv.getLoadSettings().resourcePath +
          '/internal_packages/onboarding/lib/certificate-review');
        return describeRejectedCertificate(${JSON.stringify(report)}, new Date(), true).problems;
      })()`);
      sameNameResults.push(problems.includes('系统无法验证此证书。') &&
        problems.every(problem => !problem.includes('自签名证书')));
    }
    const sameNameIssuerNotSelfSigned = sameNameResults.every(Boolean);

    const sanOnlyExtensions = path.join(work, 'san-only-leaf.ext');
    fs.writeFileSync(sanOnlyExtensions, 'subjectAltName=critical,DNS:mail.example.test,IP:127.0.0.1\n');
    const sanOnlyLeaf = signFixtureLeaf('san-only-leaf', '/', 'named_curve', '4', sanOnlyExtensions);
    const sanOnlyReport = { ...original[0], sha256: sanOnlyLeaf.fingerprint256,
      chain: [sanOnlyLeaf.raw.toString('base64')] };
    const sanOnlyDetailsPreserved = await run(`(()=>{
      const {X509Certificate}=require('crypto');
      const {describeRejectedCertificate}=require(AppEnv.getLoadSettings().resourcePath +
        '/internal_packages/onboarding/lib/certificate-review');
      const report=${JSON.stringify(sanOnlyReport)};
      if(new X509Certificate(Buffer.from(report.chain[0],'base64')).subject) return false;
      const info=describeRejectedCertificate(report,new Date(),true);
      return info.issuedTo==='' && info.issuedBy==='Paper Reed Test Mail' &&
        info.names.join('|')==='mail.example.test|127.0.0.1' && info.fingerprint===report.sha256 &&
        Number.isFinite(info.validFrom.getTime()) && Number.isFinite(info.validTo.getTime());
    })()`);
    assert(sanOnlyDetailsPreserved, 'an empty subject preserves names from the SAN, issuer, dates and fingerprint');

    const leafConfig = path.join(work, 'self-signed-server.ext');
    const leafPath = path.join(work, 'self-signed-server.crt');
    fs.writeFileSync(leafConfig, `[req]
prompt = no
distinguished_name = subject
x509_extensions = server
[subject]
CN = mail.example.test
[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @names
[names]
DNS.1 = mail.example.test
IP.1 = 127.0.0.1
IP.2 = ::1
URI.1 = https://pki.example.test/mail
URI.2 = https://pki.example.test/reports/a,b
email.1 = admin@example.test
`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
      '-pkeyopt', 'ec_param_enc:named_curve', '-nodes', '-sha256', '-days', '2', '-config', leafConfig,
      '-keyout', path.join(work, 'self-signed-server.key'), '-out', leafPath], { stdio: 'ignore' });
    const serverLeaf = new X509Certificate(fs.readFileSync(leafPath));
    assert.equal(serverLeaf.ca, false);
    assert(serverLeaf.verify(serverLeaf.publicKey));
    assert(!serverLeaf.checkIssued(serverLeaf), 'the server leaf lacks certificate signing usage');
    assert.match(serverLeaf.subjectAltName, /URI:"https:\/\/pki\.example\.test\/reports\/a/);
    const leafReport = { ...original[0], sha256: serverLeaf.fingerprint256,
      chain: [serverLeaf.raw.toString('base64')] };
    const { matching, wrongHost } = await run(`(()=>{
      const {describeRejectedCertificate}=require(AppEnv.getLoadSettings().resourcePath +
        '/internal_packages/onboarding/lib/certificate-review');
      const report=${JSON.stringify(leafReport)};
      return {
        matching:describeRejectedCertificate(report, new Date(), true),
        wrongHost:describeRejectedCertificate({...report,host:'different.example.test'}, new Date(), true),
      };
    })()`);
    const selfSignedServerLeafIdentified =
      matching.problems.length === 1 && matching.problems[0].includes('自签名证书');
    const expectedServerNames = ['mail.example.test', '127.0.0.1', '0:0:0:0:0:0:0:1'];
    const mismatch = wrongHost.problems.find(problem => problem.includes('不匹配')) || '';
    const serverNamesExcludeUriAndEmail =
      JSON.stringify(matching.names) === JSON.stringify(expectedServerNames) &&
      expectedServerNames.every(name => mismatch.includes(name)) && !/https:|admin@/.test(mismatch);
    assert.deepEqual({ selfSignedServerLeafIdentified, serverNamesExcludeUriAndEmail },
      { selfSignedServerLeafIdentified: true, serverNamesExcludeUriAndEmail: true });

    const oauthKeepsSystemTrustGuidance = await run(`(()=>{
      const OAuthSignInPage = require(AppEnv.getLoadSettings().resourcePath +
        '/internal_packages/onboarding/lib/oauth-signin-page').default;
      const view = new OAuthSignInPage({serviceName:'Fixture Mail'});
      view.setState = state => Object.assign(view.state, state);
      const guidance = 'Certificate Error (IMAP). Review the operating system trust settings.';
      const error = {message:guidance,errorCode:'ErrorCertificate',isUserError:true,rawLog:'fixture TLS diagnostics'};
      view._onError(error);
      const baseline = {...view.state};
      view._onError({...error,certificateDetailsOnly:true,certificates:${JSON.stringify(original)}});
      const unchanged = view.state.errorMessage === baseline.errorMessage && view.state.errorLog === baseline.errorLog;
      view._onError({...error,certificates:${JSON.stringify(original)}});
      return unchanged && view.state.errorMessage !== guidance;
    })()`);

    assert.equal(await page.getByRole('heading', { name: '无法验证服务器证书' }).count(), 1);
    assert.equal(await page.locator('.certificate').count(), 1, 'both endpoints share one certificate');
    const details = await page.locator('.certificate').innerText();
    assert.match(details, /收信服务器 IMAP\s+127\.0\.0\.1:993/);
    assert.match(details, /发信服务器 SMTP\s+127\.0\.0\.1:465/);
    assert.match(details, /自签名证书/);
    assert.match(details, /Paper Reed Test Mail/);
    assert.match(details, /有效期/);
    assert.equal((await page.locator('.fingerprint').textContent()).replace(/:/g, '').toLowerCase(), fingerprint);
    assert(await run(`(()=>{
      const page=document.querySelector('.page-container:not([inert]) .AccountCertificatePage');
      const footer=page.querySelector('.pr-certificate-actions').getBoundingClientRect();
      const fingerprint=page.querySelector('.fingerprint').getBoundingClientRect();
      return page.scrollWidth<=page.clientWidth+1 && footer.bottom<=innerHeight+1 &&
        fingerprint.top>=0 && fingerprint.bottom<=footer.top &&
        document.activeElement.textContent==='返回设置';
    })()`), 'the full fingerprint and safe return action fit in the compact viewport');

    await main.keyboard.press('Tab');
    assert(await run('document.activeElement.textContent==="修复后重新验证"'));
    const idle = await accept.boundingBox();
    await main.keyboard.down('Enter');
    await main.keyboard.down('Enter');
    await main.keyboard.up('Enter');
    await until(() => run('window.prCertificateReview.calls.length===2'), 'one certificate retry');
    assert.deepEqual(await run('window.prCertificateReview.calls[1]'), {});
    const pending = page.getByRole('button', { name: '正在重新验证…' });
    assert.deepEqual(await pending.boundingBox(), idle);
    assert.equal(await pending.getAttribute('aria-disabled'), 'true');
    await paint();
    await captureCertificate('after-certificate-retrying');

    const replacement = { ...original[1], sha256: 'b'.repeat(64), chain: [] };
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(replacement)}]});true`);
    await page.getByText('服务器提供了不同的证书', { exact: false }).waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: '服务器提供了不同的证书' }).count(), 1,
      'certificate changes are announced as alerts');
    assert.match(await page.innerText(), /仅提供 SHA-256 指纹/);
    assert(await run('document.activeElement.textContent==="返回设置"'));
    assert.equal((await page.locator('.fingerprint').textContent()).replace(/:/g, ''), replacement.sha256.toUpperCase());
    await paint();
    await captureCertificate('after-certificate-changed');

    await accept.click();
    await until(() => run('window.prCertificateReview.calls.length===3'), 'replacement fingerprint retry');
    await run('window.prCertificateReview.reject({errorCode:"ErrorAuthentication",errorService:"smtp"});true');
    const authentication = page.getByRole('alert').filter({ hasText: '发信服务器拒绝登录' });
    await authentication.waitFor();
    assert.match(await authentication.textContent(), /请核对用户名和密码/);
    const retryConnection = page.getByRole('button', { name: '重新验证', exact: true });
    const previousCertificate = page.getByText('上次报告的证书', { exact: true });
    const authenticationUsesConnectionCopy =
      (await page.getByRole('heading', { name: '连接邮箱失败', exact: true }).count()) === 1 &&
      (await retryConnection.count()) === 1 && (await accept.count()) === 0 &&
      (await previousCertificate.count()) === 1 && !(await page.locator('.fingerprint').isVisible()) &&
      await run('document.activeElement.textContent==="返回设置"');
    await captureCertificate('after-certificate-authentication');
    if (authenticationUsesConnectionCopy) {
      await previousCertificate.click();
      assert.equal((await page.locator('.fingerprint').textContent()).replace(/:/g, ''), replacement.sha256.toUpperCase());
      await previousCertificate.click();
    }
    await page.locator('.pr-certificate-retry').click();
    await until(() => run('window.prCertificateReview.calls.length===4'), 'retry after authentication failure');
    const inconsistent = { ...original[1], sha256: 'c'.repeat(64) };
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(inconsistent)}]});true`);
    await page.getByText('证书详情与收到的指纹不一致').waitFor();
    assert.equal(await accept.getAttribute('aria-disabled'), 'true');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    const clearReviewedFingerprints = async () => {
      for (const service of ['imap', 'smtp']) {
        const host = active.locator(`[id="settings.${service}_host"]`);
        await host.fill(`${service}.fixture.test`);
        await host.fill('127.0.0.1');
      }
    };
    await clearReviewedFingerprints();
    await connect.click();
    await until(() => run('window.prCertificateReview.calls.length===5'), 'server verification before sequential review');
    assert.deepEqual(await run('window.prCertificateReview.calls[4]'), {});
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(original[0])}]});true`);
    await accept.click();
    await until(() => run('window.prCertificateReview.calls.length===6'), 'IMAP certificate retry');
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(original[1])}]});true`);
    await page.getByText('发信服务器 SMTP', { exact: true }).waitFor();
    assert.equal(await page.getByText('服务器提供了不同的证书', { exact: false }).count(), 0,
      'the first SMTP report is not an IMAP certificate replacement');
    await page.getByRole('alert').filter({ hasText: '收到尚未核对的服务器证书' }).waitFor();
    await resize(420, 500);
    await paint();
    await captureCertificate('after-certificate-first-report');
    await accept.click();
    await until(() => run('window.prCertificateReview.calls.length===7'), 'SMTP certificate retry');
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(original[1])}]});true`);
    await page.getByRole('alert').filter({ hasText: '已核对的证书仍未通过验证' }).waitFor();
    assert.equal(await accept.getAttribute('aria-disabled'), 'true');
    await run('document.querySelector(".page-container:not([inert]) .pr-certificate-retry").click();true');
    await paint();
    assert.equal(await run('window.prCertificateReview.calls.length'), 7);
    await captureCertificate('after-certificate-still-rejected');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    await clearReviewedFingerprints();
    await connect.click();
    await until(() => run('window.prCertificateReview.calls.length===8'), 'server verification before mixed report');
    assert.deepEqual(await run('window.prCertificateReview.calls[7]'), {});
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(original[0])}]});true`);
    await accept.click();
    await until(() => run('window.prCertificateReview.calls.length===9'), 'IMAP retry before mixed report');
    await run(`window.prCertificateReview.reject({certificates:${JSON.stringify(original)}});true`);
    await page.getByRole('alert').filter({ hasText: '尚未核对的服务器证书' }).waitFor();
    const mixedRejection = page.getByRole('alert').filter({ hasText: '已核对的证书仍未通过验证' });
    assert.equal(await mixedRejection.count(), 1, 'a first SMTP report must not hide the repeated IMAP rejection');
    assert.match(await mixedRejection.textContent(), /收信服务器 IMAP/);
    assert.equal(await page.getByText('服务器提供了不同的证书', { exact: false }).count(), 0);
    assert.equal(await accept.getAttribute('aria-disabled'), 'true');
    assert(await run('document.activeElement.textContent==="返回设置"'));
    await run('document.querySelector(".page-container:not([inert]) .pr-certificate-retry").click();true');
    await paint();
    assert.equal(await run('window.prCertificateReview.calls.length'), 9);
    await resize(420, 500);
    await captureCertificate('after-certificate-mixed-report');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    await connect.click();
    await until(() => run('window.prCertificateReview.calls.length===10'), 'server verification after returning without changes');
    const reentryReport = [{ ...original[0], sha256: cert.fingerprint256 }, original[1]];
    await run(`window.prCertificateReview.reject({certificates:${JSON.stringify(reentryReport)},rawLog:'fixture reentry certificate diagnostic'});true`);
    await page.waitFor();
    assert.equal(await accept.getAttribute('aria-disabled'), 'true', 'reopening settings did not clear the repeated rejection');
    const reentryRejection = page.getByRole('alert').filter({ hasText: '已核对的证书仍未通过验证' });
    assert.match(await reentryRejection.textContent(), /收信服务器 IMAP/);
    assert.equal(await reentryRejection.getByRole('button', { name: '查看诊断' }).count(), 1);
    await page.getByRole('alert').filter({ hasText: '尚未核对的服务器证书' }).waitFor();
    assert.equal(await page.getByText('服务器提供了不同的证书', { exact: false }).count(), 0);
    assert(await run('document.activeElement.textContent==="返回设置"'));
    assert.equal(await back.getAttribute('aria-describedby'), await reentryRejection.getAttribute('id'));
    await run('document.querySelector(".page-container:not([inert]) .pr-certificate-retry").click();true');
    await paint();
    assert.equal(await run('window.prCertificateReview.calls.length'), 10);
    await resize(420, 500);
    await captureCertificate('after-certificate-reentry');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    await connect.click();
    await until(() => run('window.prCertificateReview.calls.length===11'), 'settings submission before mixed rotation report');
    const rotatedIMAP = { ...replacement, service: 'imap', port: original[0].port };
    await run(`window.prCertificateReview.reject({certificates:${JSON.stringify([rotatedIMAP, original[1]])}});true`);
    const rotated = page.getByRole('alert').filter({ hasText: '服务器提供了不同的证书' });
    await rotated.waitFor();
    const rotationText = await rotated.textContent();
    const reentryShowsFirstAndRotated = rotationText.includes('尚未核对的服务器证书');
    const mixedReportIdentifiesEachProtocol =
      rotationText.includes('服务器提供了不同的证书（收信服务器 IMAP）') &&
      rotationText.includes('尚未核对的服务器证书（发信服务器 SMTP）');
    assert.equal(await accept.getAttribute('aria-disabled'), 'false', 'new certificates can be reviewed and retried');
    assert.equal(await page.getByText('已核对的证书仍未通过验证', { exact: false }).count(), 0);
    assert.deepEqual({ oauthKeepsSystemTrustGuidance, reentryShowsFirstAndRotated },
      { oauthKeepsSystemTrustGuidance: true, reentryShowsFirstAndRotated: true });
    assert.deepEqual({ sameNameIssuerNotSelfSigned, mixedReportIdentifiesEachProtocol },
      { sameNameIssuerNotSelfSigned: true, mixedReportIdentifiesEachProtocol: true });
    await resize(420, 500);
    await captureCertificate('after-certificate-reentry-rotation');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    await connect.click();
    await until(() => run('window.prCertificateReview.calls.length===12'), 'settings submission before SMTP-only report');
    await run(`window.prCertificateReview.reject({certificates:[${JSON.stringify(original[1])}]});true`);
    await page.getByText('发信服务器 SMTP', { exact: true }).waitFor();
    const firstReportAfterReturning = (await page.getByRole('alert')
      .filter({ hasText: '尚未核对的服务器证书' }).count()) === 1;
    assert.equal(await accept.getAttribute('aria-disabled'), 'false');
    assert.equal(await page.getByText('服务器提供了不同的证书', { exact: false }).count(), 0);
    assert.deepEqual({ authenticationUsesConnectionCopy, firstReportAfterReturning },
      { authenticationUsesConnectionCopy: true, firstReportAfterReturning: true });
    await resize(420, 500);
    await captureCertificate('after-certificate-reentry-first-report');
    await back.click();
    await active.locator('.AccountIMAPSettingsForm').waitFor();

    for (const [reopen, pending, lateResult] of [
      [13, 14, `window.prCertificateReview.reject({certificates:[${JSON.stringify(replacement)}]})`],
      [15, 16, 'window.prCertificateReview.resolve()'],
    ]) {
      await clearReviewedFingerprints();
      await active.getByRole('button', { name: '连接邮箱', exact: true }).click();
      await until(() => run(`window.prCertificateReview.calls.length===${reopen}`), 'server form validation pending again');
      assert.deepEqual(await run(`window.prCertificateReview.calls[${reopen - 1}]`), {});
      await run(`window.prCertificateReview.reject({certificates:${JSON.stringify(original)}});true`);
      await accept.click();
      await until(() => run(`window.prCertificateReview.calls.length===${pending}`), 'retry pending before leaving');
      await back.click();
      await active.locator('.AccountIMAPSettingsForm').waitFor();
      await run(`${lateResult};true`);
      await paint();
      assert.equal(await page.count(), 0, 'abandoned retry cannot reopen certificate review');
      assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'), 0);
    }

    assert((await run('window.prCertificateReview.calls')).every(call => Object.keys(call).length === 0),
      'reviewed fingerprints only compare reports and are never submitted as trust settings');
    const result = { narrowLayout: true, parsedCertificateDetails: true, safeInitialFocus: true,
      stableKeyboardRetry: true, replacedCertificateAnnounced: true, authenticationDiagnostic: true,
      inconsistentFingerprintBlocksRetry: true, firstReportDistinguished: true, repeatedRejectionBlocksRetry: true,
      mixedReportPreservesRepeatedRejection: true, repeatedRejectionOnReentry: true, abandonedRetryIgnored: true,
      oauthKeepsSystemTrustGuidance, reentryShowsFirstAndRotated, authenticationUsesConnectionCopy, firstReportAfterReturning,
      sameNameIssuerNotSelfSigned, mixedReportIdentifiesEachProtocol,
      selfSignedServerLeafIdentified, serverNamesExcludeUriAndEmail,
      sanOnlyDetailsPreserved,
      noAccountsCreated: true, expectedSMTPSubmissions: 0 };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('PASS certificate onboarding', JSON.stringify(result));
  } finally {
    await run('window.prCertificateReview.restore();true');
  }
};
