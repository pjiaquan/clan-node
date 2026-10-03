## 2024-05-19 - Translating text impacts locators
**Learning:** This app uses `useI18n` with Traditional Chinese as the default language. Playwright scripts looking for English text like `name="Create user"` will fail due to translation changes.
**Action:** Always use IDs, specific CSS classes, or generic `getByRole` without English text matching when creating UI tests.
