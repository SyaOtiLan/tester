import type { ReporterDescription } from '@playwright/test';

const summaryReporterPath = new URL('./summary.ts', import.meta.url).pathname;

export function defaultReporters(): ReporterDescription[] {
  return [
    ['list'],
    ['html', { open: 'never', outputFolder: process.env.TESTER_RUNTIME_DIR ? `${process.env.TESTER_RUNTIME_DIR}/reports` : 'reports' }],
    ['junit', { outputFile: process.env.TESTER_RUNTIME_DIR ? `${process.env.TESTER_RUNTIME_DIR}/junit.xml` : 'junit.xml' }],
    [summaryReporterPath],
  ];
}
