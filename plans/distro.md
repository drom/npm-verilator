# Distributing Verilator as an NPM dependency

## Context & goals

`verilator` (this package) wraps the [Verilator](https://www.veripool.org/projects/verilator) HDL simulator so it can be installed with `npm install` (or `npx`) and used from JS/Node toolchains without a system package manager.

Today the package builds Verilator **from source in the `prepare` script**:

```json
"prepare": "git clone http://git.veripool.org/git/verilator || true && cd verilator && git pull && autoconf && ./configure && make"
```

That works as a proof of concept but is unsuitable for real distribution:

- **Slow** — a full clone + `autoconf`/`configure`/`make` takes several minutes on every install.
- **Fragile** — requires `g++`, `bison`, `flex`, `autoconf`, `make`, `perl`, `python3`, `git` to be present; `|| true` swallows failures.
- **Unpinned** — `git pull` builds whatever is on `master` at install time, so builds are not reproducible.
- **No `bin` mapping** — even after a successful build, npm does not expose `verilator` on `PATH`, so `npx verilator` does not work.
- **Bloated install** — the entire source tree + build artifacts end up under `node_modules`.

The goal of this plan: make `npm install -g verilator` / `npx verilator` work **fast, reliably, and reproducibly** on the supported platforms (Linux x64/arm64, macOS x64/arm64; Windows only via WSL2), using prebuilt binaries.

## Verilator-specific constraints

Verilator is **not** a single self-contained binary, so the usual "one binary per platform package" pattern (esbuild/Biome/Turbo) needs adjustment:

1. **Runtime file tree.** A working Verilator install consists of:
   - `bin/verilator` — entry script (shell/perl) that execs `verilator_bin`
   - `bin/verilator_bin` — the actual compiled C++ executable
   - `bin/verilator_coverage`, `bin/verilator_difftree`, `bin/verilator_ccache_md5`
   - `include/` — C++ headers (`verilated.h`, `verilated_*.h`, `*.sv` system headers, etc.) that generated models `#include` at compile time
   - ~~`share/`~~ (man pages, examples) — **trimmed**; the platform package ships only `bin/` + `include/` to keep size down. Man pages/examples are not needed at runtime.
   The platform package must ship the `bin/` + `include/` tree, not a single executable.
   > **Build note:** `make install --prefix <stage>` puts the headers at `<stage>/share/verilator/include/` (per `pkgdatadir` in `configure.ac`), **not** `<stage>/include/`. The CI build step must relocate `share/verilator/include/` → `<stage>/include/` before deleting `share/`, otherwise the platform package has no headers.
2. **`VERILATOR_ROOT`.** Verilator locates its `include/` via the `VERILATOR_ROOT` env var or by resolving its own executable path relative to `../include`. The npm shim must set `VERILATOR_ROOT` to the unpacked platform package dir so the tool works regardless of where npm linked the `bin`. With the relocation above, `$VERILATOR_ROOT/include/` resolves correctly.
3. **Build prerequisites.** Source builds need `g++`, `bison`, `flex`, `autoconf`, `make`, `perl`, `python3`, `git`. These are reasonable to require for a *fallback* but not for the default install path.
4. **Linux ABI / CentOS 7 baseline.** Target glibc **2.17** (CentOS 7) as the oldest supported Linux. A binary built on a recent glibc distro will not run on CentOS 7, so the Linux build **must** happen inside an old-glibc container. Build inside `quay.io/pypa/manylinux2014_x86_64` (glibc 2.17) for x64, and the `aarch64` manylinux2014 image for arm64. Cross-compiling Verilator is non-trivial (bison/flex run at build time), so build **inside** the target-base container rather than cross-compiling. The resulting binaries then run on CentOS 7 and any newer glibc.
5. **macOS.** Ship separate `darwin-arm64` and `darwin-x64` packages. Minimum deployment target is **macOS 11 (Big Sur)** — 10.15 (Catalina) is EOL since 2022, and Apple Silicon requires 11+, which aligns with the `darwin-arm64` package.
6. **Windows via WSL2 only.** Verilator's native Windows (MinGW/MSYS2) port is not first-class; we do **not** ship a `win32` package. The supported path on Windows is WSL2: the user runs `npm install` inside WSL2 (Linux userland), which pulls the `verilator-linux-x64`/`-arm64` package as normal. Document this in the README; the shim should detect `win32` and print a clear "use WSL2" message rather than a generic "unsupported platform" error.
7. **Versioning.** Verilator tags look like `v5.048` (with release date `2026-04-26`). The npm package version should encode the Verilator version, e.g. `5.048.0` (semver: major.minor.patch where the trailing `.0` is the npm packaging revision). This lets us re-publish the same Verilator release if the packaging changes.

## Distribution options

### Option A — Build from source on install (current, improved)

Keep building in an `install`/`postinstall` script, but make it robust: pin a tag, use the source tarball instead of `git clone`, cache the build under `node_modules/.cache`, surface clear errors, and wire up `bin`.

- **Pros:** works on any platform with a build toolchain; no binary artifacts to host; small publish size.
- **Cons:** slow first install; requires build deps; fails in restricted/CI envs without compilers; hardest to make reproducible.

### Option B — Prebuilt platform packages via `optionalDependencies` (recommended default)

Build Verilator per target on CI, pack the **install tree** (`bin/` + `include/`) into per-platform npm packages, and have the main `verilator` package depend on them as `optionalDependencies`. npm only downloads the one matching `os`/`cpu`.

- **Pros:** fast install; no build tools required; reproducible; `npx verilator` works out of the box.
- **Cons:** only covers platforms we build for; must manage Linux glibc portability; larger publish artifacts (multi-MB per platform).

### Option C — Hybrid (B default, A fallback)

Ship prebuilt packages as in B, but if the matching platform package is absent (e.g. `--no-optional`, or unsupported `os`/`cpu`), the shim triggers a source build from a pinned tarball into a cache dir.

- **Pros:** best coverage; graceful degradation.
- **Cons:** most engineering effort; two code paths to test.

**Decision: Option B.** Ship prebuilt platform packages via `optionalDependencies`. This is the chosen approach — fast install, no build tools required, reproducible, `npx verilator` works out of the box. Option C (source-build fallback behind `--build-from-source` / `VERILATOR_BUILD_FROM_SOURCE=1`) may be added later, but is out of scope for the initial release.

## Package layout (Option B)

```
npm-verilator/                       # main package "verilator"
├── package.json
├── bin/verilator.js                 # Node shim: resolves platform pkg, sets VERILATOR_ROOT, spawns
├── README.md
└── packages/
    ├── verilator-linux-x64/
    │   ├── package.json             # os:["linux"], cpu:["x64"]
    │   ├── bin/  (verilator, verilator_bin, ...)
    │   └── include/  (verilated.h, ...)
    ├── verilator-linux-arm64/
    │   └── ... (same layout)
    ├── verilator-darwin-x64/
    │   └── ...
    └── verilator-darwin-arm64/
        └── ...
```

The built `bin/` + `include/` trees are **not checked in**; CI copies them into `packages/<platform>/` just before `npm publish`.

### Main `package.json` (sketch)

```json
{
  "name": "verilator",
  "version": "5.048.0",
  "description": "Verilator (Verilog HDL simulator) as an npm package",
  "bin": { "verilator": "bin/verilator.js" },
  "optionalDependencies": {
    "verilator-linux-x64":   "5.048.0",
    "verilator-linux-arm64": "5.048.0",
    "verilator-darwin-x64":  "5.048.0",
    "verilator-darwin-arm64":"5.048.0"
  },
  "files": ["bin", "README.md", "LICENSE"]
}
```

### Platform `package.json` (sketch, e.g. `verilator-linux-x64`)

```json
{
  "name": "verilator-linux-x64",
  "version": "5.048.0",
  "description": "Prebuilt Verilator install tree for linux/x64",
  "license": "LGPL-3.0-only",
  "os": ["linux"],
  "cpu": ["x64"],
  "publishConfig": { "access": "public" }
}
```

### Shim `bin/verilator.js` (sketch)

```js
#!/usr/bin/env node
const { platform, arch, env } = process;
const { spawnSync } = require("child_process");
const path = require("path");

const PKG = {
  darwin: { x64: "verilator-darwin-x64", arm64: "verilator-darwin-arm64" },
  linux:  { x64: "verilator-linux-x64",  arm64: "verilator-linux-arm64"  },
};

// Windows is not a native target — guide users to WSL2.
if (platform === "win32") {
  console.error("verilator: native Windows is not supported by this package.");
  console.error("On Windows, install and run Verilator inside WSL2 (Windows Subsystem for Linux),");
  console.error("where the verilator-linux-* prebuilt package will be used automatically.");
  process.exit(1);
}

const pkgName = env.VERILATOR_NPM_BINARY || PKG[platform]?.[arch];
if (!pkgName) {
  console.error(`verilator: no prebuilt package for ${platform}/${arch}.`);
  console.error("Build from source: https://github.com/verilator/verilator");
  process.exit(1);
}

let root;
try { root = path.dirname(require.resolve(`${pkgName}/package.json`)); }
catch { console.error(`verilator: platform package "${pkgName}" missing (run npm install without --no-optional).`); process.exit(1); }

const result = spawnSync(path.join(root, "bin", "verilator"), process.argv.slice(2), {
  stdio: "inherit",
  env: { ...env, VERILATOR_ROOT: root },
});
if (result.error) throw result.error;
process.exitCode = result.status;
```

`VERILATOR_ROOT` is set to the platform package dir so `verilator` finds its `include/` regardless of how npm symlinked `bin/verilator`.

## Build & release CI

A single workflow (`.github/workflows/release.yml`) on tag push builds + publishes:

1. **Matrix** over `[{os: ubuntu, target: linux-x64}, {os: ubuntu, target: linux-arm64}, {os: macos, target: darwin-x64}, {os: macos, target: darwin-arm64}]`. No `windows` job — Windows uses WSL2 with the Linux package.
   - **linux-x64**: run the build **inside** `quay.io/pypa/manylinux2014_x86_64` (glibc 2.17) via a container step, so binaries run on CentOS 7 and newer.
   - **linux-arm64**: run the `aarch64` manylinux2014 container on a native `ubuntu-arm64` GitHub runner (no QEMU binfmt — too slow/flaky for a long C++ build).
   - **darwin-x64 / darwin-arm64**: native `macos` runners; build against the macOS 11 (Big Sur) SDK as the minimum deployment target.
2. **Build steps** per job:
   - `git clone --depth 1 --branch <tag> https://github.com/verilator/verilator`
   - `autoconf && ./configure --prefix <stage> && make -j && make install`
   - strip the `bin/verilator_bin` binaries.
   - **trim `share/`**: after `make install`, delete `<stage>/share/` so the staged tree contains only `bin/` + `include/`.
3. **Stage** the trimmed `bin/` + `include/` tree into `packages/<target>/`.
4. **Publish** each platform package (`npm publish --access public`), then publish the main `verilator` package. Platform packages **must** be published first so the main package's `optionalDependencies` resolve.
5. Requires an `NPM_TOKEN` secret.

Keep all 5 packages at the same version. A `scripts/sync-versions.js` (run in `prepublishOnly`) can copy the root version into every `packages/*/package.json`.

## Versioning policy

- npm version = `<verilator>.<pkg-rev>` → e.g. Verilator `5.048` → npm `5.048.0`; re-package fixes bump to `5.048.1`.
- Optional-dep entries in the main `package.json` always pin the **exact** version being published (no `^`/`~`), so a given main package always maps to one known set of builds.

## Migration steps

1. Restructure `package.json`: add `bin`, `optionalDependencies`, `files`; drop the `prepare` source-build script.
2. Create `bin/verilator.js` shim.
3. Create `packages/<target>/package.json` for the 4 targets (no binaries checked in).
4. Add `.gitignore` entries for `packages/*/bin`, `packages/*/include`, `verilator/` (build dir).
5. Add `.github/workflows/release.yml` build+publish matrix.
6. Add `scripts/sync-versions.js` + `prepublishOnly` hook.
7. Update `README.md` with install/usage (`npm i -g verilator`, `npx verilator --version`, `VERILATOR_NPM_BINARY` override).
8. First release: tag `v5.048.0`, let CI publish the 4 platform packages, then the main package; smoke-test `npx verilator@5.048.0 --version` on each platform.

## Decisions (locked)

- **Approach:** Option B — prebuilt platform packages via `optionalDependencies`. (Option C source-build fallback is future work.)
- **Platform packages:** `verilator-linux-x64`, `verilator-darwin-x64`, `verilator-darwin-arm64`. No `win32` package, no `linux-arm64` package (out of scope).
- **Windows:** supported **only via WSL2**. The shim detects `win32` and instructs the user to install/run inside WSL2 (where the Linux package is used automatically).
- **Package contents:** `bin/` + `include/` only. `share/` (man pages, examples) is trimmed at build time.
- **Linux glibc baseline:** glibc **2.17** (CentOS 7). Linux builds run inside `manylinux2014` containers so binaries run on CentOS 7 and newer.
- **macOS:** native runners, oldest supported SDK; separate `darwin-arm64` and `darwin-x64` packages.
- **macOS minimum deployment target:** **macOS 11 (Big Sur)**. 10.15 (Catalina) is EOL since 2022, and Apple Silicon requires 11+, which aligns with the `darwin-arm64` package.
- **CI container strategy:** do **not** use the GitHub Actions `container:` field with manylinux2014 — the runner's own Node 24 runtime cannot execute inside glibc 2.17 (`GLIBC_2.27 not found`). Instead run on the host runner and invoke the manylinux2014 container only for the build step via `docker run`.

## Open questions

_None — all previously open questions are now resolved (see Decisions above)._

## Release runbook

Steps to go from this repo to published packages on npm. Run once for setup, then per release.

### One-time setup

1. **Create an npm publish token.**
   - https://www.npmjs.com/settings/<your-username>/tokens → **Generate New Token** → **Classic Token** → type **Automation** (bypasses 2FA prompts in CI).
   - Or, more secure: **Granular Access Token** scoped to publish the 5 package names (`verilator`, `verilator-linux-x64`, `verilator-linux-arm64`, `verilator-darwin-x64`, `verilator-darwin-arm64`).
   - Copy the token (starts with `npm_`); not shown again.

2. **Add the token as a GitHub repo secret.**
   - Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
   - Name: `NPM_TOKEN` (must be exactly this). Value: the token.

3. **Confirm Actions permissions.**
   - Repo → **Settings** → **Actions** → **General** → *Workflow permissions*. The workflow only publishes to npm (no repo writes), so the default is fine. No change needed unless Actions has been locked down.

4. **Verify package-name availability.**
   - `verilator` is owned (you published `0.1.0`); the 4 `verilator-<os>-<arch>` names are free. If any is taken, rename and update `optionalDependencies` + the shim's `PKG` map + the CI matrix.

5. **Push the workflow to the remote.**
   - `git push origin master` — ensure `.github/workflows/release.yml` is on the remote before tagging.

### Per release (e.g. Verilator 5.048 → npm 5.048.0)

1. Ensure `package.json` `version` is `5.048.0` (and run `npm run sync-versions` so all 5 packages match — or let `prepublishOnly` do it).
2. Commit and tag:
   ```sh
   git tag v5.048.0
   git push origin v5.048.0
   ```
3. The tag triggers `release.yml`. Watch it: **Actions tab** → `release` run. 4 `build` jobs run in parallel (5–15 min each), then `publish-main` runs after all 4 succeed.
4. When green, smoke-test on a clean machine:
   ```sh
   npx verilator@5.048.0 --version
   npm view verilator version             # 5.048.0
   npm view verilator-linux-x64 version   # 5.048.0
   ```
5. On Windows (PowerShell), confirm the WSL2 guidance prints:
   ```sh
   npm install -g verilator && verilator --version
   ```

### Common first-run failures (and fixes)

- **`npm publish` → `ENEEDAUTH`** — `NPM_TOKEN` secret missing or misnamed. Must be exactly `NPM_TOKEN`.
- **Linux build fails in manylinux2014 container** — the image may lack Verilator's build deps. Add a `yum install -y bison flex` (and `perl`/`python3` if missing) before the build step in the linux jobs.
- **macOS binary won't run on older macOS** — set `MACOSX_DEPLOYMENT_TARGET=11` in the darwin build env so the SDK targets macOS 11.
- **Platform package published but main package fails** — a platform publish failed silently; check the 4 `build` jobs all went green before `publish-main` ran.
- **`npx verilator` after install → "missing platform package"** — user ran `npm install --no-optional`. Documented in README; no fix needed beyond the error message.

### Subsequent releases

- **New Verilator version** (e.g. `5.050`): bump `package.json` to `5.050.0`, run `npm run sync-versions`, commit, `git tag v5.050.0 && git push origin v5.050.0`.
- **Packaging fix to same Verilator release**: bump to `5.048.1`, tag `v5.048.1`, push.

### Optional hardening (not blocking first release)

- Add a smoke-test step to each `build` job: after `make install`, run `stage/bin/verilator --version` (and a tiny Verilog example) before publishing, to catch broken builds.
- Publish with `--provenance` for supply-chain provenance (requires `id-token: write` workflow permission).
- Pin Actions to commit SHAs instead of `@v4`.
- Gate publishes behind a manual `environment: production` approval.
