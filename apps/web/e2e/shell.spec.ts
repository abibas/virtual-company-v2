import { expect, test } from '@playwright/test';

test('the shell loads and Home shows the API version and readiness', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Most Wanted Corp');
  await expect(page.getByRole('status')).toHaveText(/^API v\d+\.\d+\.\d+\S* · ready$/);

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  for (const name of ['Inbox', 'Tasks', 'Org', 'Machines', 'Settings']) {
    await expect(nav.getByRole('button', { name })).toBeDisabled();
  }
  await expect(page.getByRole('main')).toContainText('Home');
});
