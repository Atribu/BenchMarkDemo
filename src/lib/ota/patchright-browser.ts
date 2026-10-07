import { chromium, type BrowserContext, type Page } from "patchright";

export interface PatchrightBrowserHandle {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
}

export async function createPatchrightBrowserPage(): Promise<PatchrightBrowserHandle> {
  const context = await chromium.launchPersistentContext(
    "./.benchmark-state/expedia-browser-profile",
    {
      channel: "chrome",
      headless: false,
      viewport: null,
    },
  );

  const pages = context.pages();

  const page =
    pages.length > 0
      ? pages[0]
      : await context.newPage();

  return {
    context,
    page,

    close: async () => {
      await context.close();
    },
  };
}