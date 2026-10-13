import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import base from './playwright.config';

type ScheduledProject = NonNullable<PlaywrightTestConfig['projects']>[number];

const safeChromiumArgs = [
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--disable-dev-shm-usage',
  '--disable-features=Vulkan',
  '--no-sandbox',
];

const projects = (base.projects ?? [])
  .filter((project: ScheduledProject) => project.name !== 'knowledge')
  .map((project: ScheduledProject) => {
    const launchOptions = project.use?.launchOptions ?? {};
    const existingArgs = launchOptions.args ?? [];

    return {
      ...project,
      use: {
        ...project.use,
        launchOptions: {
          ...launchOptions,
          args: [...existingArgs, ...safeChromiumArgs],
        },
      },
    };
  });

export default defineConfig({
  ...base,
  projects,
  workers: process.env.PWWORKERS ? Number(process.env.PWWORKERS) : 2,
});
