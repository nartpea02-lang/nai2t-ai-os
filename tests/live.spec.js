/* Live-backend integration: the frontend talking to a real WebSocket backend
   (tests/stub-backend.js) over the documented protocol. */
const { test, expect } = require('@playwright/test');

const BACKEND = 'ws://localhost:4322/ws';
const withBackend = (url) => '/hq/?backend=' + encodeURIComponent(url);

async function openTerminal(page) {
  await page.click('[data-testid="menu-btn"]');
  await page.click('[data-view="terminal"]');
}
async function openAssistant(page) {
  await page.click('[data-testid="menu-btn"]');
  await page.click('[data-view="assistant"]');
}
async function say(page, text) {
  await page.fill('[data-testid="chat-input"]', text);
  await page.click('[data-testid="send-btn"]');
}

test('connects to the backend and streams the agent answer into the chat', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(withBackend(BACKEND));
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('เชื่อมต่อแล้ว');
  await expect(page.locator('[data-testid="terminal-log"]')).toContainText('claude-opus-5-stub');

  await openAssistant(page);
  await say(page, 'สรุปสถานะงาน');
  // The streamed deltas are assembled into one bubble — the offline brain never
  // produces this text, so seeing it proves the turn was served by the backend.
  await expect(page.locator('.msg-ai .msg-bubble').last())
    .toHaveText('รับทราบครับ กำลังตรวจสอบสถานะงานให้', { timeout: 5000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('tool calls and sub-agents from the backend render live', async ({ page }) => {
  await page.goto(withBackend(BACKEND));
  await say(page, 'สรุปสถานะงาน');
  // Sub-agent card appears in the dispatch panel…
  await expect(page.locator('.sa-card').first()).toContainText('ผู้ช่วยค้นข้อมูล', { timeout: 5000 });
  // …and the tool call is logged in the terminal.
  await openTerminal(page);
  const log = page.locator('[data-testid="terminal-log"]');
  await expect(log).toContainText('read_file');
  await expect(log).toContainText('อ่านไฟล์แล้ว');
});

test('a destructive command runs only after the user approves it', async ({ page }) => {
  await page.goto(withBackend(BACKEND));
  await say(page, 'ลบไฟล์ log เก่า');
  const card = page.locator('.confirm-card');
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.locator('.confirm-cmd')).toHaveText('rm -rf old.log');

  // Nothing has run yet: the command must not be echoed as executed.
  await openTerminal(page);
  await expect(page.locator('[data-testid="terminal-log"]')).not.toContainText('$ rm -rf old.log');

  await openAssistant(page);
  await page.click('[data-testid="confirm-allow"]');
  await expect(page.locator('.msg-ai .msg-bubble').last()).toContainText('ลบไฟล์เรียบร้อย', { timeout: 5000 });
  await openTerminal(page);
  const log = page.locator('[data-testid="terminal-log"]');
  await expect(log).toContainText('$ rm -rf old.log');
  await expect(log).toContainText('removed old.log');
});

test('denying a destructive command cancels it', async ({ page }) => {
  await page.goto(withBackend(BACKEND));
  await say(page, 'ลบไฟล์ log เก่า');
  await expect(page.locator('.confirm-card')).toBeVisible({ timeout: 5000 });
  await page.click('.confirm-card [data-act="deny"]');
  await expect(page.locator('.msg-ai .msg-bubble').last()).toContainText('ยกเลิกคำสั่ง', { timeout: 5000 });
  await openTerminal(page);
  await expect(page.locator('[data-testid="terminal-log"]')).not.toContainText('$ rm -rf old.log');
});

test('reconnects by itself after the backend drops the socket', async ({ page }) => {
  await page.goto(withBackend(BACKEND));
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('เชื่อมต่อแล้ว');

  await openAssistant(page);
  await say(page, 'drop');                       // stub closes the connection
  await openTerminal(page);
  await expect(page.locator('[data-testid="terminal-log"]')).toContainText('เชื่อมต่อใหม่ใน', { timeout: 5000 });
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('เชื่อมต่อแล้ว', { timeout: 15000 });
});

test('an origin rejection is reported with the fix, not a silent failure', async ({ page }) => {
  await page.goto(withBackend(BACKEND + '?reject=1'));
  await openTerminal(page);
  const log = page.locator('[data-testid="terminal-log"]');
  await expect(log).toContainText('ALLOWED_ORIGINS', { timeout: 8000 });
  await expect(log).toContainText('http://localhost:4321');
});

test('the backend URL can be set from the UI and survives a reload', async ({ page }) => {
  await page.goto('/hq/');                       // no backend configured anywhere
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('ออฟไลน์');

  await page.fill('[data-testid="backend-url"]', 'localhost:4322');   // bare host is enough
  await page.click('[data-testid="backend-connect"]');
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('เชื่อมต่อแล้ว', { timeout: 8000 });

  await page.reload();
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('เชื่อมต่อแล้ว', { timeout: 8000 });
  await expect(page.locator('[data-testid="backend-url"]')).toHaveValue('localhost:4322');

  // Clearing it puts the app back into offline mode for good.
  await page.click('[data-testid="backend-clear"]');
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('ออฟไลน์');
  await page.reload();
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('ออฟไลน์');
});

test('an unreachable backend degrades to the offline brain and offers a retry', async ({ page }) => {
  await page.goto(withBackend('ws://localhost:4399/ws'));   // nothing listening
  await openTerminal(page);
  await expect(page.locator('[data-testid="live-chip"]')).toContainText('ออฟไลน์', { timeout: 10000 });
  await expect(page.locator('[data-testid="retry-btn"]')).toBeVisible();

  await openAssistant(page);
  await say(page, 'สรุปสถานะงาน');
  await expect(page.locator('.msg-ai .msg-bubble').last()).toContainText('สรุป', { timeout: 5000 });
});

test('the stop button is offered only while a turn is running', async ({ page }) => {
  await page.goto(withBackend(BACKEND));
  await openTerminal(page);
  await expect(page.locator('[data-testid="stop-btn"]')).toBeHidden();
  await openAssistant(page);
  await say(page, 'ลบไฟล์ log เก่า');            // waits on a confirmation => still running
  await openTerminal(page);
  await expect(page.locator('[data-testid="stop-btn"]')).toBeVisible();
  await page.click('[data-testid="stop-btn"]');
  await expect(page.locator('[data-testid="stop-btn"]')).toBeHidden();
});

test('URL normalization accepts what an operator would actually paste', async ({ page }) => {
  await page.goto('/hq/');
  const cases = await page.evaluate(() => ({
    bare: LuzyLive.normalizeUrl('nai2t-luzy.onrender.com'),
    https: LuzyLive.normalizeUrl('https://nai2t-luzy.onrender.com'),
    full: LuzyLive.normalizeUrl('wss://nai2t-luzy.onrender.com/ws'),
    spaced: LuzyLive.normalizeUrl('  wss://nai2t-luzy.onrender.com/ws  '),
    empty: LuzyLive.normalizeUrl(''),
    health: LuzyLive.healthUrl('wss://nai2t-luzy.onrender.com/ws'),
  }));
  expect(cases.bare).toBe('ws://nai2t-luzy.onrender.com/ws');       // page is http here
  expect(cases.https).toBe('wss://nai2t-luzy.onrender.com/ws');
  expect(cases.full).toBe('wss://nai2t-luzy.onrender.com/ws');
  expect(cases.spaced).toBe('wss://nai2t-luzy.onrender.com/ws');
  expect(cases.empty).toBe('');
  expect(cases.health).toBe('https://nai2t-luzy.onrender.com/health');
});
