import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makePage } from '../src/model';

test('group headers edit shared categories while display settings and new records retain their view context', async ({}, info) => {
  test.setTimeout(180000);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mini-notion-groups-')));
  const metadata = path.join(root, '.mininotion');
  fs.mkdirSync(metadata);
  fs.writeFileSync(
    path.join(metadata, 'collection.json'),
    JSON.stringify({ format: 'mininotion.collection/v1' }),
  );
  fs.mkdirSync(path.join(root, 'Welcome'));
  fs.writeFileSync(
    path.join(root, 'Welcome/index.mininotion.json'),
    JSON.stringify({ format: 'mininotion.page/v1', page: makePage({ title: 'Welcome' }) }),
  );
  const env = {
    ...process.env,
    MINI_NOTION_TEST: '1',
    MINI_NOTION_BACKGROUND_TEST: '1',
    MINI_NOTION_WORKSPACE: root,
    MINI_NOTION_DATA_DIR: path.join(metadata, 'desktop'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app: ElectronApplication | undefined, page: Page;
  const errors: string[] = [];
  const launch = async () => {
    app = await electron.launch({
      executablePath: process.env.MINI_NOTION_EXECUTABLE,
      args: process.env.MINI_NOTION_EXECUTABLE ? [] : ['.'],
      env,
    });
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.sidebar').waitFor();
  };
  const api = async (method: string, params: Record<string, unknown> = {}) => {
    const reply = await page.evaluate(({ method, params }) => window.native!.api(method, params), {
      method,
      params,
    });
    expect(reply.error).toBeUndefined();
    return reply.result;
  };
  try {
    await launch();
    const source = await api('database.create', {
      title: '分类验收',
      color: 'white',
      columns: [
        {
          id: 'stage',
          name: '阶段',
          type: 'status',
          statusGroups: { todo: ['待办'], doing: ['进行中'], done: ['完成'] },
          defaultStatus: '进行中',
          optionColors: { 进行中: 'blue' },
        },
        { id: 'team', name: '团队', type: 'select', options: ['产品', '工程'] },
      ],
    });
    const board = await api('view.create', {
      databaseId: source.id,
      type: 'board',
      name: '分类看板',
      config: { groupBy: 'stage', groupOrder: ['完成', '进行中', '待办', ''], hideEmptyGroups: false },
    });
    const layouts: Record<string, any> = {};
    for (const [type, name] of [
      ['table', '分组表格'],
      ['list', '分组列表'],
      ['gallery', '分组画廊'],
    ])
      layouts[type] = await api('view.create', {
        databaseId: source.id,
        type,
        name,
        config: { groupBy: 'stage', hideEmptyGroups: false },
      });
    const existing = await api('record.create', {
      databaseId: source.id,
      title: '进行记录',
      color: 'white',
      values: { stage: '进行中', team: '工程' },
    });
    await api('record.create', {
      databaseId: source.id,
      title: '待办记录',
      color: 'white',
      values: { stage: '待办', team: '产品' },
    });
    const linkedView = {
      ...board,
      id: 'linked-board',
      name: '独立分组',
      hiddenGroups: [],
      collapsedGroups: [],
    };
    const host = await api('page.create', {
      title: '关联分组验收',
      color: 'white',
      blocks: [
        {
          type: 'databaseView',
          props: {
            databaseId: source.id,
            linked: true,
            viewState: JSON.stringify({ views: [linkedView], activeViewId: linkedView.id, view: 'board' }),
          },
        },
      ],
    });
    await api('view.select', { databaseId: source.id, viewId: board.id });
    await api('page.open', { pageId: source.id });
    await expect(page.locator('.page-title')).toHaveValue('分类验收');
    const database = () => page.locator(`.database[data-database-id="${source.id}"]`);
    const group = (key: string) => database().locator(`[data-group-key=${JSON.stringify(key)}]`);
    const sourceView = async (id = board.id) =>
      (await api('view.list', { databaseId: source.id })).find((view: any) => view.id === id);
    const property = async () =>
      (await api('property.list', { databaseId: source.id })).find((column: any) => column.id === 'stage');
    const chooseView = async (id: string) => {
      const tab = database().locator(`[data-view-id="${id}"]`);
      if (!(await tab.evaluate((element) => element.classList.contains('active')))) await tab.click();
      await expect(tab).toHaveClass(/active/);
    };
    const finishRow = async (title: string, expected: Record<string, string>) => {
      await page.locator('.peek-panel .page-title').fill(title);
      await expect
        .poll(
          async () =>
            (await api('record.list', { databaseId: source.id })).find((row: any) => row.title === title)
              ?.values,
        )
        .toMatchObject(expected);
      await page.getByRole('button', { name: '关闭预览', exact: true }).click();
    };
    await expect(group('进行中')).toBeVisible();
    // Notion colors board columns by their group option by default. The
    // toggle remains per-view, and both light/dark palettes retain a wash.
    await expect(group('进行中')).toHaveAttribute('data-color-tone', 'blue');
    await expect(group('待办')).toHaveAttribute('data-color-tone', 'gray');
    await expect(group('完成')).toHaveAttribute('data-color-tone', 'green');
    const lightWash = await group('进行中').evaluate(element => getComputedStyle(element).backgroundColor);
    await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
    const colorToggle = page.getByRole('checkbox', { name: '显示分组列颜色' });
    await expect(colorToggle).toBeChecked();
    await colorToggle.uncheck();
    await expect(group('进行中')).not.toHaveAttribute('data-color-tone');
    await expect.poll(async () => (await sourceView()).colorColumns).toBe(false);
    await colorToggle.check();
    await expect(group('进行中')).toHaveAttribute('data-color-tone', 'blue');
    await page.keyboard.press('Escape');
    await api('settings.set', { changes: { theme: 'dark' } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(async () => group('进行中').evaluate(element => getComputedStyle(element).backgroundColor))
      .not.toBe(lightWash);
    await page.screenshot({ path: info.outputPath('board-columns-dark.png'), animations: 'disabled' });
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 680));
    await expect(database().locator('.database-new')).toBeInViewport();
    const viewAdd = database().getByRole('button', { name: '添加视图' });
    await expect(viewAdd).toBeInViewport();
    const [tabsBox, addBox] = await Promise.all([
      database().locator('.view-tabs').boundingBox(), viewAdd.boundingBox(),
    ]);
    expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(tabsBox!.x + tabsBox!.width + 1);
    await page.screenshot({ path: info.outputPath('board-columns-narrow.png'), animations: 'disabled' });
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
    await api('settings.set', { changes: { theme: 'light' } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // View grouping is directly discoverable, and a board provides a
    // trailing-column category action like the native Notion board.
    await expect(database().getByRole('button', { name: '设置分组与分类', exact: true })).toBeVisible();
    const addCategory = () => database().locator('.group-add-board-column');
    const mainAddCategory = () => database().locator('.database-new');
    await expect(addCategory()).toBeVisible();
    await expect(mainAddCategory()).toHaveText('新增分类');
    await expect(database().locator('.database-category-add')).toHaveCount(0);
    await expect
      .poll(async () => addCategory().evaluate((element) => getComputedStyle(element).paddingLeft))
      .not.toBe('0px');
    await database().getByRole('button', { name: '折叠分组 进行中', exact: true }).click();
    await expect.poll(async () => (await sourceView()).collapsedGroups).toContain('进行中');
    const groupNameButton = group('进行中').locator('.group-name-button');
    await groupNameButton.click();
    let dialog = page.getByRole('dialog', { name: '编辑分类' });
    await expect(dialog).toHaveClass(/group-option-editor/);
    await expect(dialog.getByRole('textbox', { name: '分类名称' })).toBeFocused();
    const triggerRect = await groupNameButton.boundingBox(), editorRect = await dialog.boundingBox();
    expect(editorRect).not.toBeNull();
    expect(editorRect!.width).toBeLessThanOrEqual(317);
    // The anchor stays nearby; the popover may shift slightly upward to fit
    // the viewport after resizing the application window.
    expect(editorRect!.y).toBeGreaterThanOrEqual(triggerRect!.y + triggerRect!.height - 24);
    expect(editorRect!.y).toBeGreaterThanOrEqual(8);
    expect(editorRect!.y + editorRect!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await groupNameButton.click();
    dialog = page.getByRole('dialog', { name: '编辑分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('制作中');
    await dialog.getByRole('button', { name: '红色', exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect
      .poll(async () => (await api('page.get', { pageId: existing.id })).values.stage)
      .toBe('制作中');
    await expect.poll(async () => (await property()).defaultStatus).toBe('制作中');
    expect((await property()).statusGroups.doing).toEqual(['制作中']);
    expect((await property()).optionColors['制作中']).toBe('red');
    await expect(group('制作中')).toHaveAttribute('data-color-tone', 'red');
    expect((await sourceView()).collapsedGroups).toContain('制作中');
    expect((await sourceView()).groupOrder).toEqual(['完成', '制作中', '待办', '']);

    await mainAddCategory().click();
    dialog = page.getByRole('dialog', { name: '新增分类' });
    await expect(dialog.getByRole('textbox', { name: '分类名称' })).toBeFocused();
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('制作中');
    await expect(dialog.getByRole('alert')).toContainText('已存在');
    await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(mainAddCategory()).toBeFocused();
    await mainAddCategory().click();
    dialog = page.getByRole('dialog', { name: '新增分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('审核中');
    await dialog.getByRole('combobox', { name: '状态分组', includeHidden: true }).selectOption('doing');
    await dialog.getByRole('button', { name: '紫色', exact: true }).click();
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await property()).options).toContain('审核中');
    expect((await property()).statusGroups.doing).toContain('审核中');
    // The view settings expose category creation and renaming without opening
    // the property editor or discovering hidden per-column controls.
    await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
    await page.getByRole('button', { name: '重命名分类 审核中', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '编辑分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('待审核');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await property()).options).toContain('待审核');
    await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
    await page.locator('.group-settings-add').click();
    dialog = page.getByRole('dialog', { name: '新增分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('审核中');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await property()).options).toContain('审核中');
    await group('审核中').locator('.board-add').click();
    await finishRow('审核记录', { stage: '审核中' });

    await group('制作中').getByRole('button', { name: '分组 制作中 的更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '上移分组', exact: true }).click();
    await expect.poll(async () => (await sourceView()).groupOrder[0]).toBe('制作中');
    await group('制作中').getByRole('button', { name: '分组 制作中 的更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '隐藏分组', exact: true }).click();
    await expect(group('制作中')).toHaveCount(0);
    await expect.poll(async () => (await sourceView()).hiddenGroups).toContain('制作中');
    await chooseView(layouts.list.id);
    await expect(group('制作中')).toBeVisible();
    expect((await sourceView(layouts.list.id)).hiddenGroups || []).not.toContain('制作中');
    await chooseView(board.id);
    await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
    await page.getByRole('button', { name: '显示分组 制作中', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(group('制作中')).toBeVisible();

    for (const type of ['table', 'list', 'gallery']) {
      await chooseView(layouts[type].id);
      await expect(group('制作中').locator('.tag-red').first()).toBeVisible();
      await group('制作中').getByRole('button', { name: '分组 制作中 的更多操作', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: '编辑属性', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await database().getByRole('button', { name: '折叠分组 制作中', exact: true }).click();
      await expect(group('制作中').getByText('进行记录', { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await sourceView(layouts[type].id)).collapsedGroups).toContain('制作中');
      await database().getByRole('button', { name: '展开分组 制作中', exact: true }).click();
      await expect(group('制作中').getByText('进行记录', { exact: true })).toBeVisible();
    }
    await group('审核中').locator('.gallery-add').click();
    await finishRow('画廊新增', { stage: '审核中' });

    await chooseView(board.id);
    await api('view.update', {
      databaseId: source.id,
      viewId: board.id,
      changes: { subGroupBy: 'team', collapsedGroups: [] },
    });
    const subgroup = database().locator('[data-subgroup-key="工程"]');
    await subgroup.locator('[data-group-key="制作中"] .board-add').click();
    await finishRow('双重分组新增', { stage: '制作中', team: '工程' });

    await api('page.open', { pageId: host.id });
    await expect(page.locator('.page-title')).toHaveValue('关联分组验收');
    await expect(page.locator('.inline-database')).toHaveCount(1);
    await expect(group('制作中')).toBeVisible();
    // Real pointer + keyboard stress, not a synthetic CSS class injection:
    // 50 cycles * 4 interactions, observing the surrounding editor block.
    await page.evaluate(() => {
      const inline = document.querySelector('.inline-database')!;
      const block = inline.closest('.bn-block-content[data-content-type="databaseView"]')!;
      let visualHalos = 0, unexpectedDrags = 0;
      const observer = new MutationObserver(() => {
        const first = block.firstElementChild!;
        const style = getComputedStyle(first, '::after');
        if (block.classList.contains('ProseMirror-selectednode') &&
            (style.content !== 'none' || style.boxShadow !== 'none')) visualHalos++;
      });
      observer.observe(block, { attributes: true, attributeFilter: ['class'] });
      block.addEventListener('dragstart', () => { unexpectedDrags++; });
      (window as any).__groupInteractionProbe = { get: () => ({ visualHalos, unexpectedDrags }), stop: () => observer.disconnect() };
    });
    for (let iteration = 0; iteration < 50; iteration++) {
      await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
      await page.keyboard.press('Escape');
      await group('待办').locator('.group-name-button').click();
      await expect(page.getByRole('dialog', { name: '编辑分类' }).getByRole('textbox', { name: '分类名称' })).toBeFocused();
      await page.keyboard.press('Escape');
    }
    const interaction = await page.evaluate(() => {
      const probe = (window as any).__groupInteractionProbe;
      const result = probe.get();
      probe.stop();
      delete (window as any).__groupInteractionProbe;
      return result;
    });
    expect(interaction).toEqual({ visualHalos: 0, unexpectedDrags: 0 });
    expect((await property()).options).toContain('待办');
    await group('制作中').getByRole('button', { name: '分组 制作中 的更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '隐藏分组', exact: true }).click();
    await expect(group('制作中')).toHaveCount(0);
    await expect
      .poll(
        async () =>
          JSON.parse((await api('page.get', { pageId: host.id })).blocks[0].props.viewState).views[0]
            .hiddenGroups,
      )
      .toContain('制作中');
    expect((await sourceView()).hiddenGroups || []).not.toContain('制作中');
    // A nested database is an interactive editor block; selecting that outer
    // BlockNote node must never paint its default blue selection rectangle.
    const halo = await page.locator('.inline-database').evaluate((inline) => {
      const block = inline.closest('.bn-block-content[data-content-type="databaseView"]');
      if (!block || !block.firstElementChild) throw new Error('Inline database block DOM was not found');
      block.classList.add('ProseMirror-selectednode');
      const computed = getComputedStyle(block.firstElementChild, '::after');
      const result = { content: computed.content, shadow: computed.boxShadow };
      block.classList.remove('ProseMirror-selectednode');
      return result;
    });
    expect(halo.content).toBe('none');
    expect(halo.shadow).toBe('none');
    await page.screenshot({ path: info.outputPath('linked-groups.png'), animations: 'disabled' });

    await app!.close();
    app = undefined;
    await launch();
    await api('page.open', { pageId: host.id });
    await expect(page.locator('.page-title')).toHaveValue('关联分组验收');
    await expect(group('制作中')).toHaveCount(0);
    await api('page.open', { pageId: source.id });
    await expect(page.locator('.page-title')).toHaveValue('分类验收');
    await api('view.update', { databaseId: source.id, viewId: board.id, changes: { subGroupBy: '' } });
    await expect(group('制作中')).toHaveCount(1);
    await expect(group('制作中')).toBeVisible();
    await expect(group('制作中')).toHaveAttribute('data-color-tone', 'red');
    await expect.poll(async () => (await sourceView()).colorColumns).toBe(true);
    const count = (await api('record.list', { databaseId: source.id })).length;
    await group('审核中').getByRole('button', { name: '分组 审核中 的更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除分组', exact: true }).click();
    await page
      .getByRole('dialog', { name: '删除分组', exact: true })
      .getByRole('button', { name: '删除', exact: true })
      .click();
    await expect.poll(async () => (await property()).options.includes('审核中')).toBe(false);
    expect((await api('record.list', { databaseId: source.id })).length).toBe(count);
    expect(
      (await api('record.list', { databaseId: source.id }))
        .filter((row: any) => ['审核记录', '画廊新增'].includes(row.title))
        .map((row: any) => row.values.stage),
    ).toEqual(['制作中', '制作中']);
    // Newly added empty categories must be surfaced even if the view was
    // previously configured to hide empty groups; property data must survive.
    await api('view.update', { databaseId: source.id, viewId: board.id, changes: { hideEmptyGroups: true } });
    await database().getByRole('button', { name: '设置分组与分类', exact: true }).click();
    await page.getByRole('button', { name: '重命名分类 制作中', exact: true }).click();
    dialog = page.getByRole('dialog', { name: '编辑分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('制作中');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await sourceView()).hideEmptyGroups).toBe(true);
    await mainAddCategory().click();
    dialog = page.getByRole('dialog', { name: '新增分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('回归候选');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await property()).options).toContain('回归候选');
    await expect.poll(async () => (await sourceView()).hideEmptyGroups).toBe(true);
    await expect.poll(async () => (await sourceView()).revealedGroups).toContain('回归候选');
    await expect(group('回归候选')).toBeVisible();
    await expect(group('待办')).toBeVisible();
    await expect(mainAddCategory()).toHaveText('新增分类');
    await api('view.update', { databaseId: source.id, viewId: board.id, changes: { hideEmptyGroups: true } });
    await addCategory().click();
    dialog = page.getByRole('dialog', { name: '新增分类' });
    await dialog.getByRole('textbox', { name: '分类名称' }).fill('末尾新增');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(async () => (await property()).options).toContain('末尾新增');
    await expect.poll(async () => (await sourceView()).hideEmptyGroups).toBe(true);
    await expect.poll(async () => (await sourceView()).revealedGroups).toContain('末尾新增');
    await expect(group('末尾新增')).toBeVisible();
    await expect(mainAddCategory()).toHaveText('新增分类');
    expect(errors).toEqual([]);
    console.log(
      'GROUP UI PASS',
      JSON.stringify({
        layouts: 4,
        renamePreservesRows: true,
        groupStateMigrates: true,
        groupedCreation: true,
        subgroupCreation: true,
        linkedIsolation: true,
        restart: true,
      }),
    );
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
