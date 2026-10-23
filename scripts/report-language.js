// Translate only the Playwright report controls. Test names, errors and logs stay verbatim.
(() => {
  'use strict';

  const button = document.getElementById('tester-report-language');
  const root = document.getElementById('root');
  const menu = document.getElementById('tester-project-menu');
  if (!button || !root || !menu) return;

  const labels = new Map([
    ['All', '全部'], ['Passed', '通过'], ['Failed', '失败'],
    ['Flaky', '不稳定'], ['Skipped', '跳过'],
    ['Theme:', '主题：'], ['Dark mode', '深色'], ['Light mode', '浅色'],
    ['System', '跟随系统'], ['Search tests', '搜索用例'],
    ['No tests found', '没有找到用例'], ['View Trace', '查看追踪'],
    ['Errors', '错误'], ['Steps', '步骤'], ['Attachments', '附件'],
    ['Stdout', '标准输出'], ['Stderr', '标准错误'],
    ['Settings', '设置'], ['Speedboard', '耗时概览'],
    ['Duration', '耗时'], ['Retries', '重试'], ['Retry', '重试'],
    ['Run', '运行'], ['Copy', '复制'], ['Download', '下载'],
  ]);
  const reverse = new Map([...labels].map(([en, zh]) => [zh, en]));
  const textSelector = [
    '.subnav-item-label', '.header-setting-theme',
    '[data-testid="overall-duration"]', '.subnav-search',
    '[role="tab"]', '.tabbed-pane-tab',
    'button:not(.chip-header)', 'option', 'label',
  ].join(',');
  // The filename selects the test-title language. This is a full report switch,
  // not a DOM-only translation of test names or failure evidence.
  const language = location.pathname.endsWith('/full.en.html') ? 'en' : 'zh';
  let scheduled = false;

  function translated(value) {
    const leading = value.match(/^\s*/)[0];
    const trailing = value.match(/\s*$/)[0];
    const bare = value.trim();
    const table = language === 'zh' ? labels : reverse;
    let result = table.get(bare);
    if (!result && language === 'zh' && bare.startsWith('Total time: '))
      result = '总耗时：' + bare.slice('Total time: '.length);
    if (!result && language === 'en' && bare.startsWith('总耗时：'))
      result = 'Total time: ' + bare.slice('总耗时：'.length);
    return result ? leading + result + trailing : value;
  }

  function translateControls() {
    scheduled = false;
    for (const control of root.querySelectorAll(textSelector)) {
      if (control.closest('pre, code, .test-file-test, .chip-header')) continue;
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const next = translated(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      }
    }
    for (const control of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
      if (control.closest('.test-file-test, pre, code')) continue;
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        if (!control.hasAttribute(attr)) continue;
        const value = control.getAttribute(attr);
        const next = translated(value);
        if (next !== value) control.setAttribute(attr, next);
      }
    }
    const summary = menu.querySelector('summary');
    if (summary) {
      summary.textContent = language === 'zh'
        ? summary.textContent.replace(/^Projects \((\d+)\)$/, '项目目录（$1）')
        : summary.textContent.replace(/^项目目录（(\d+)）$/, 'Projects ($1)');
    }
    for (const link of menu.querySelectorAll('.links a')) {
      const value = link.textContent;
      if (language === 'en' && value === '返回项目总览') link.textContent = 'Back to project overview';
      if (language === 'en' && value === '全部详细用例') link.textContent = 'All test cases';
      if (language === 'zh' && value === 'Back to project overview') link.textContent = '返回项目总览';
      if (language === 'zh' && value === 'All test cases') link.textContent = '全部详细用例';
      const count = link.querySelector('small');
      if (count) {
        count.textContent = language === 'zh'
          ? count.textContent.replace(/^(\d+) tests$/, '$1 条')
          : count.textContent.replace(/^(\d+) 条$/, '$1 tests');
      }
      if (language === 'en' && link.getAttribute('href')?.startsWith('full.html'))
        link.setAttribute('href', link.getAttribute('href').replace(/^full\.html/, 'full.en.html'));
    }
    menu.setAttribute('aria-label', language === 'zh' ? '项目目录' : 'Project directory');
    document.title = language === 'zh' ? 'Playwright 测试报告' : 'Playwright Test Report';
  }

  function schedule() {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(translateControls);
    }
  }

  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  button.textContent = language === 'zh' ? '中文' : 'English';
  button.setAttribute('aria-label', language === 'zh' ? '当前中文，点击切换为英文' : 'Currently English; click to switch to Chinese');
  button.addEventListener('click', () => {
    const target = new URL(location.href);
    target.pathname = target.pathname.replace(/full(?:\.en)?\.html$/, language === 'zh' ? 'full.en.html' : 'full.html');
    location.assign(target.href);
  });
  new MutationObserver(schedule).observe(root, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-label', 'placeholder', 'title'],
  });
  schedule();
})();
