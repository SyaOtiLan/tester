/**
 * project — create project / task through the UI.
 *
 * Covers PJ-050, PJ-074.
 *
 * A logged-in UI session is seeded through the real login form (see
 * helpers/session.ts). These specs drive the SPA, so run them with
 * `--workers=1` for stability.
 *
 * Env vars consumed:
 *   - PROJECT_BASE_URL
 */
import { test, expect, baseURLFor } from '../fixtures';
import { seedUiSession } from '../helpers/session';
import { createProject, firstColumnId } from '../helpers/api';

const baseURL = baseURLFor('project');

test.describe("【project ui】项目 — 通过 UI 创建（project — create via UI）", () => {
  test.skip(!baseURL, 'PROJECT_BASE_URL not configured');

  // PJ-050 UI 新建项目走完创建向导
  test("【项目管理 / E2E】 PJ-050 UI 新建项目走完创建向导", async ({ page }) => {
    await seedUiSession(page, baseURL!);

    const name = `向导项目${Date.now() % 100000}`;
    // Ctrl/Cmd+B opens the "新建项目" wizard modal (same handler as the
    // "新建项目" dropdown item, onAddMenu('project')).
    await page.keyboard.press('Control+b');

    const modal = page.locator('.ivu-modal-wrap', { hasText: '新建项目' }).last();
    const nameInput = modal.locator('input[type="text"]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
    await nameInput.fill(name);

    // Click the primary "添加" (submit) button in the modal footer.
    await modal.getByRole('button', { name: '添加' }).click();

    // The app forwards to the created project panel …
    await page.waitForURL(/\/manage\/project\/\d+/, { timeout: 20_000 });
    // … and the project name shows up in the left sidebar project list.
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  // PJ-074 UI 新建任务出现在看板列
  test("【任务管理 / E2E】 PJ-074 UI 新建任务出现在看板列", async ({ page }) => {
    const account = await seedUiSession(page, baseURL!);

    // Prepare a project with a default column via the API, then open its board.
    const { id: pid } = await createProject(baseURL!, account.token, { name: `看板${Date.now() % 100000}` });
    await firstColumnId(baseURL!, account.token, pid); // ensure a column exists
    await page.goto(`/manage/project/${pid}`, { waitUntil: 'domcontentloaded' });

    // Open the inline "添加任务" composer in the first column.
    const addBtn = page.locator('.task-add-row .add-btn').first();
    await addBtn.waitFor({ state: 'visible', timeout: 20_000 });
    await addBtn.click();

    const taskName = `看板任务${Date.now() % 100000}`;
    const composer = page.locator('.task-add-row textarea').first();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
    await composer.fill(taskName);
    await composer.press('Enter');

    // The new task card appears in the board.
    await expect(page.getByText(taskName).first()).toBeVisible({ timeout: 15_000 });
  });
});
