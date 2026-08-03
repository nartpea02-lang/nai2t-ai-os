const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4321',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
    // Grant mic so Web Speech init paths don't throw permission errors.
    permissions: ['microphone'],
  },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
