import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { loginAsDefault } from './helpers';

test('Inkway reference palette on the working issue screen', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsDefault(page);
  await expect(page.getByRole('link', { name: 'Issues', exact: true }).first()).toBeVisible();
  await mkdir('artifacts/inkway-brand', { recursive: true });
  for (const [theme,canvas,primary] of [
    ['dark','#1F2937','#B5C9FF'],
    ['light','#FAF8F4','#1E3A8A'],
  ]) {
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark',dark),theme === 'dark');
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--page-canvas').trim())).toBe(canvas);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())).toBe(primary);
    await page.screenshot({path:`artifacts/inkway-brand/issues-${theme}.png`,fullPage:false,animations:'disabled'});
  }
});
