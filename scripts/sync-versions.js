#!/usr/bin/env node
"use strict";

// Copy the root package version into every packages/<target>/package.json so
// all 5 packages (main + 4 platform) share one version. Run from prepublishOnly.
// The optionalDependencies entries in the root package.json are also rewritten
// to pin the exact same version (no ^/~), per the versioning policy.

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const rootPkgPath = path.join(rootDir, "package.json");
const packagesDir = path.join(rootDir, "packages");

const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf8"));
const version = rootPkg.version;

if (!version) {
  console.error("sync-versions: root package.json has no version");
  process.exit(1);
}

// Pin optionalDependencies to the exact version being published.
if (rootPkg.optionalDependencies) {
  for (const name of Object.keys(rootPkg.optionalDependencies)) {
    rootPkg.optionalDependencies[name] = version;
  }
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
}

// Update every platform package to match.
const targets = fs
  .readdirSync(packagesDir)
  .filter((entry) => fs.statSync(path.join(packagesDir, entry)).isDirectory());

for (const target of targets) {
  const pkgPath = path.join(packagesDir, target, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.version === version) continue;
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`sync-versions: ${target} -> ${version}`);
}

console.log(`sync-versions: all packages at ${version}`);
