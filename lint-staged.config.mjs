export default {
  'apps/mobile/**/*.{js,jsx,ts,tsx}': [
    'pnpm --filter @apps/mobile exec eslint --fix',
  ],

  'apps/server/**/*.{js,ts}': [
    'pnpm --filter @apps/server exec eslint --fix',
  ],

  '*.{json,md,yml,yaml}': [
    'pnpm exec prettier --write',
  ],
}