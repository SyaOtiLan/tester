export type TestTitleLanguage = 'zh' | 'en';

function selectedTitleLanguage(): TestTitleLanguage {
  return process.env.TEST_TITLE_LANG?.trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

export function localizedTitle(zh: string, en: string): string {
  return selectedTitleLanguage() === 'en' ? en : zh;
}
