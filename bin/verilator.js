#!/usr/bin/env node
"use strict";

// Shim that resolves the prebuilt, platform-specific Verilator install tree
// (declared as an optionalDependency), sets VERILATOR_ROOT so the tool finds
// its include/ headers, and spawns the real `verilator` entry script.

const { platform, arch, env } = process;
const { spawnSync } = require("child_process");
const path = require("path");

const PKG = {
  darwin: { x64: "verilator-darwin-x64", arm64: "verilator-darwin-arm64" },
  linux: { x64: "verilator-linux-x64" },
};

// Windows is not a native target — guide users to WSL2.
if (platform === "win32") {
  console.error("verilator: native Windows is not supported by this package.");
  console.error(
    "On Windows, install and run Verilator inside WSL2 (Windows Subsystem for Linux),",
  );
  console.error(
    "where the verilator-linux-* prebuilt package will be used automatically.",
  );
  process.exit(1);
}

const pkgName = env.VERILATOR_NPM_BINARY || PKG[platform]?.[arch];
if (!pkgName) {
  console.error(`verilator: no prebuilt package for ${platform}/${arch}.`);
  console.error("Build from source: https://github.com/verilator/verilator");
  process.exit(1);
}

let root;
try {
  root = path.dirname(require.resolve(`${pkgName}/package.json`));
} catch {
  console.error(
    `verilator: platform package "${pkgName}" missing (run npm install without --no-optional).`,
  );
  process.exit(1);
}

const result = spawnSync(path.join(root, "bin", "verilator"), process.argv.slice(2), {
  stdio: "inherit",
  env: { ...env, VERILATOR_ROOT: root },
});
if (result.error) throw result.error;
process.exitCode = result.status;
