const { test, expect } = require('@playwright/test');

const PAGES = [
  { name: 'HQ (Luzy)',  url: '/',        assistant: 'Luzy',  view: 'org' },
  { name: 'Atlas',      url: '/atlas/',  assistant: 'Atlas', view: 'kanban' },
  { name: 'Nova',       url: '/nova/',   assistant: 'Nova',  view: 'calendar' },
];

const SIZES = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 800 },
  { w: 768,  h: 1024 },
  { w: 480,  h: 900 },
  { w: 360,  h: 780 },
];

// Fail loudly on any page/console error.
function guardErrors(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
}

for (const p of PAGES) {
  for (const s of SIZES) {
    test(`${p.name} renders clean @ ${s.w}x${s.h}`, async ({ page }) => {
      const errors = [];
      guardErrors(page, errors);
      await page.setViewportSize({ width: s.w, height: s.h });
      await page.goto(p.url);

      // Assistant is the home view and must be visible.
      await expect(page.locator('[data-testid="avatar"] svg')).toBeVisible();
      await expect(page.locator('.persona-name')).toHaveText(p.assistant);
      await expect(page.locator('[data-testid="mic-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();

      // No horizontal overflow at any size.
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(1);

      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}

test('greeting appears and is spoken path runs', async ({ page }) => {
  const errors = [];
  guardErrors(page, errors);
  await page.goto('/');
  await expect(page.locator('.msg-ai .msg-bubble').first()).toContainText('Luzy');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('text dispatch creates a real agent-dispatch visualization', async ({ page }) => {
  await page.goto('/atlas/');
  await page.fill('[data-testid="chat-input"]', 'มอบหมายงานติดตั้งโซลาร์ให้ทีมช่าง');
  await page.click('[data-testid="send-btn"]');
  // A dispatch flow node with a real assignee name should render.
  const flow = page.locator('.dispatch-flow').first();
  await expect(flow).toBeVisible({ timeout: 4000 });
  await expect(flow.locator('.df-to .df-name')).not.toBeEmpty();
  await expect(flow.locator('.df-task-title')).toContainText('ติดตั้ง');
});

test('drawer opens and switches to operational view', async ({ page }) => {
  await page.goto('/atlas/');
  await page.click('[data-testid="menu-btn"]');
  await expect(page.locator('.drawer')).toHaveClass(/open/);
  await page.click('[data-view="kanban"]');
  await expect(page.locator('[data-view-panel="kanban"]')).toBeVisible();
  await expect(page.locator('.kanban-col').first()).toBeVisible();
});

test('southern dialect toggle responds', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'พูดใต้');
  await page.click('[data-testid="send-btn"]');
  await expect(page.locator('.mode-badge')).toHaveClass(/visible/, { timeout: 4000 });
});

test('Nova calendar and campaigns render from data', async ({ page }) => {
  await page.goto('/nova/');
  await page.click('[data-testid="menu-btn"]');
  await page.click('[data-view="campaigns"]');
  await expect(page.locator('[data-view-panel="campaigns"] .badge').first()).toBeVisible();
});
