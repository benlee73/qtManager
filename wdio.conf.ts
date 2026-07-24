import type {} from "@wdio/types";

const appBinary =
  process.platform === "win32"
    ? "./target/release/qt-manager.exe"
    : "./target/release/qt-manager";

declare global {
  // WebdriverIO exposes vendor capabilities through an augmentable global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace WebdriverIO {
    interface Capabilities {
      "tauri:options"?: {
        application: string;
      };
      "wdio:tauriServiceOptions"?: {
        driverProvider: "embedded";
      };
    }
  }
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/e2e/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinary,
      },
      "wdio:tauriServiceOptions": {
        driverProvider: "embedded",
      },
    },
  ],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: appBinary,
        driverProvider: "embedded",
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],
};
