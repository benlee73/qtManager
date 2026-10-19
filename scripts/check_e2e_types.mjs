import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cliRequire = createRequire(import.meta.resolve("@wdio/cli"));
const mochaRequire = createRequire(
  import.meta.resolve("@wdio/mocha-framework"),
);
const globals = join(
  dirname(dirname(cliRequire.resolve("@wdio/globals"))),
  "types.d.ts",
);
const mocha = join(
  dirname(mochaRequire.resolve("@types/mocha/package.json")),
  "index.d.ts",
);
const directory = join(root, "target", "e2e-types");
mkdirSync(directory, { recursive: true });
const config = join(directory, "tsconfig.json");
writeFileSync(
  config,
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2023",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        types: ["node"],
        typeRoots: [join(root, "node_modules", "@types")],
        baseUrl: root,
        paths: { mocha: [mocha] },
      },
      include: [join(root, "tests", "e2e", "**", "*.ts"), globals, mocha],
    },
    null,
    2,
  ),
);
const result = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", config],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
