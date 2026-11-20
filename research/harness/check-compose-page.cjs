const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ app, main, cdp, evaluate, until }) => {
  const out = process.env.PAPER_REED_UI_OUTPUT;
  const phase = process.env.PAPER_REED_COMPOSE_PAGE_CHECK;
  const after = phase === 'after';
  const run = expression => evaluate(cdp, expression);
  const editor = main.locator('.pr-editor .pr-composer');
  const subject = editor.getByRole('textbox', { name: '邮件主题' });
  const recipient = editor.locator('.to-field input[role=combobox]');
  const body = editor.locator('[contenteditable=true]');
  const token = address => editor.locator('.token').filter({ hasText: address });
  const focused = selector => until(() => run(
    'document.activeElement.matches(' + JSON.stringify(selector) + ')'
  ), 'focus reaches ' + selector, 4000);
  fs.mkdirSync(out, { recursive: true });

  const resize = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    await run('new Promise(resolve => requestAnimationFrame(() => { document.querySelector(".pr-main").scrollTop = 0; requestAnimationFrame(resolve); }))');
  };
  const capture = async (name, width, height) => {
    await resize(width, height);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };

  await main.locator('.pr-compose-button').click();
  await editor.waitFor();
  await capture('compose-blank', 1440, 900);
  await capture('compose-blank-compact', 900, 640);
  await subject.fill('周四评审 · 请确认最终议程和交付范围');
  assert(await run('(() => { const subject = document.querySelector(".pr-subject-heading textarea"); const ime = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }); return subject.dispatchEvent(ime); })()'));
  await subject.press('Enter');
  await focused('.to-field input[role=combobox]');
  const pendingAddress = 'w'.repeat(40) + '@example.test';
  await resize(740, 700);
  await recipient.fill(pendingAddress);
  await capture('compose-address-in-progress', 740, 700);
  const pendingAddressFits = await run(`(() => {
    const field = document.querySelector('.to-field');
    const input = field.querySelector('input[role=combobox]');
    const right = field.getBoundingClientRect().right;
    return input.getBoundingClientRect().right <= right + 1 &&
      input.parentElement.getBoundingClientRect().right <= right + 1 &&
      document.documentElement.scrollWidth <= innerWidth;
  })()`);
  if (after || phase === 'layout-control') {
    assert(pendingAddressFits, 'uncommitted address stays within its column');
    assert.equal(await recipient.inputValue(), pendingAddress);
    await recipient.press('End');
    assert(await run('document.activeElement.scrollWidth > document.activeElement.clientWidth'),
      'the input can scroll to show the end of the longer address');
  }
  await recipient.fill('');
  await resize(900, 640);
  const add = async (field, address) => {
    await field.fill(address);
    await field.press('Enter');
    await token(address).waitFor({ timeout: 5000 });
  };
  await add(recipient, 'client-review@example.test');
  const finalAddress = 'cross-functional-review-coordinator-for-thursday@example.test';
  if (after || phase === 'edit-control') {
    const longAddress = 'w'.repeat(63) + '@example.test';
    await resize(740, 700);
    await add(recipient, longAddress);
    await token(longAddress).locator('.participant-primary').dblclick();
    const editing = editor.locator('.to-field input.token-editing-input');
    await editing.waitFor();
    assert.equal(await editing.inputValue(), longAddress);
    await editing.press('End');
    await capture('compose-address-editing', 740, 700);
    const editingFits = await run(`(() => {
      const pane = document.querySelector('.pr-main');
      const field = pane.querySelector('.to-field');
      const input = field.querySelector('input.token-editing-input');
      const right = field.getBoundingClientRect().right;
      return input.getBoundingClientRect().right <= right + 1 &&
        input.parentElement.getBoundingClientRect().right <= right + 1 &&
        pane.scrollWidth <= pane.clientWidth;
    })()`);
    assert(editingFits, 'editing a confirmed long address must not widen the compose pane');
    await editing.fill(finalAddress);
    await editing.press('Enter');
    await token(finalAddress).waitFor();
    assert.equal(await token(longAddress).count(), 0);
    await resize(900, 640);
  } else {
    await add(recipient, finalAddress);
  }

  const measure = () => run('(() => { const editor = document.querySelector(".pr-editor"); const to = editor.querySelector(".to-field"); const chip = to.querySelector(".token:last-of-type"); const actions = editor.querySelector(".composer-header-actions"); const send = editor.querySelector(".pr-send"); const bar = editor.querySelector(".pr-compose-actions"); const box = element => element.getBoundingClientRect(); const bounds = box(actions); return { besideRecipients: bounds.top >= box(to).top - 1 && bounds.left >= box(to).right - 1, visibleRecipient: !chip || box(chip).right <= box(to).right + 1, anchoredSend: Math.abs(box(send).right - box(bar).right) < 2, noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth, sendVisible: box(send).bottom <= innerHeight }; })()');
  const compact = await measure();
  if (after) {
    assert(compact.besideRecipients, 'addressing tools are next to the recipient row');
    assert(compact.visibleRecipient, 'a long address does not overlap the addressing tools');
    assert(compact.anchoredSend);
    assert(compact.noHorizontalOverflow && compact.sendVisible);
    await recipient.focus();
    await main.keyboard.press('Tab');
    await focused('.composer-header-actions .show-cc');
    await main.keyboard.press('ArrowRight');
    await focused('.composer-header-actions .show-bcc');
    await main.keyboard.press('ArrowLeft');
    await focused('.composer-header-actions .show-cc');
  }

  for (const [name, selector, address] of [
    ['抄送', '.cc-field input[role=combobox]', 'notes@example.test'],
    ['密送', '.bcc-field input[role=combobox]', 'records@example.test'],
  ]) {
    const option = editor.getByRole('button', { name, exact: true });
    await option.press('Enter');
    await focused(selector);
    await add(editor.locator(selector), address);
  }
  if (after || phase === 'keys-control') {
    const value = await subject.inputValue();
    await subject.press('Shift+Enter');
    const shiftKeepsSubject = await run('document.activeElement.matches(".pr-subject-heading textarea")');
    const shiftKeepsValue = await subject.inputValue() === value;
    await subject.focus();
    const legacyIMEPasses = await run(`(() => {
      const input = document.activeElement;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'keyCode', { value: 229 });
      return input.dispatchEvent(event) && document.activeElement === input;
    })()`);
    assert.deepEqual({ shiftKeepsSubject, shiftKeepsValue, legacyIMEPasses },
      { shiftKeepsSubject: true, shiftKeepsValue: true, legacyIMEPasses: true },
      'Shift+Enter and compatible IME events keep the subject editor active');
  }
  await subject.press('Enter');
  await focused(after ? '.pr-editor [contenteditable=true]' : '.to-field input[role=combobox]');
  await body.click();
  await main.keyboard.insertText('各位好，下方是周四评审前需要确认的两项内容。');
  await body.getByText(/周四评审前需要确认/).waitFor();
  await capture('compose-filled', 1440, 900);
  await capture('compose-filled-compact', 900, 640);
  await capture('compose-filled-narrow', 740, 700);
  if (after) {
    const narrow = await measure();
    assert(narrow.besideRecipients && narrow.visibleRecipient && narrow.anchoredSend, JSON.stringify(narrow));
    assert(narrow.noHorizontalOverflow && narrow.sendVisible, JSON.stringify(narrow));
  }

  await editor.getByRole('button', { name: /返回收件箱/ }).click();
  await editor.waitFor({ state: 'detached' });
  await main.locator('[data-mailbox=drafts]').click();
  await main.locator('.pr-mail-row').filter({ hasText: '周四评审' }).click();
  await body.getByText(/周四评审前需要确认/).waitFor();
  for (const address of ['client-review@example.test', finalAddress, 'notes@example.test', 'records@example.test']) {
    assert.equal(await token(address).count(), 1);
  }
  if (after) {
    await editor.locator('.composer-header-actions .show-popout').click();
    const popup = await until(() => app.windows().find(window => {
      const settings = new URL(window.url() || 'about:blank').searchParams.get('loadSettings');
      return window !== main && !window.isClosed() && settings && JSON.parse(settings).windowType === 'composer';
    }), 'standalone editor opens from the relocated popout button');
    await popup.locator('.pr-composer [contenteditable=true]').getByText(/周四评审前需要确认/).waitFor();
    assert.equal(await popup.locator('.pr-composer .pr-subject-heading textarea').inputValue(), '周四评审 · 请确认最终议程和交付范围');
    assert.equal(await popup.locator('.pr-workspace-composer').count(), 0);
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    compact, pendingAddressFits, composeVerified: after, ccBccKeyboardAndDraftRestored: true, imeProtected: true,
    ...(after ? { editedLongRecipientStaysWithinPane: true, toolbarReachedFromRecipient: true, relocatedPopoutOpensSameDraft: true } : {}),
  }, null, 2) + '\n');
  console.log('PASS write-mail layout, keyboard addressing and draft recovery');
};
