[![NPM version](https://img.shields.io/npm/v/verilator.svg)](https://www.npmjs.org/package/verilator)

# verilator

[Verilator](https://www.veripool.org/projects/verilator/wiki/Intro) — the fast
free Verilog HDL simulator — as an npm package.

This package ships prebuilt Verilator install trees for the common platforms and
exposes a `verilator` bin, so `npx verilator` and `npm install -g verilator` work
without a compiler toolchain.

## Install

```sh
npm install -g verilator      # global
npx verilator --version       # one-off
```

npm only downloads the platform package matching your `os`/`cpu`:

| Package                  | `os`     | `cpu`   |
| ------------------------ | -------- | ------- |
| `verilator-linux-x64`    | `linux`  | `x64`   |
| `verilator-darwin-x64`   | `darwin` | `x64`   |
| `verilator-darwin-arm64` | `darwin` | `arm64` |

## Windows

Native Windows is **not** supported. Run Verilator inside
[WSL2](https://learn.microsoft.com/en-us/windows/wsl/) (Windows Subsystem for
Linux), where `npm install` will pull the `verilator-linux-*` prebuilt package
automatically:

```sh
# inside WSL2
npm install -g verilator
verilator --version
```

## Environment variables

- `VERILATOR_ROOT` — set automatically by the shim to the unpacked platform
  package dir, so Verilator finds its `include/` headers. Override only if you
  know you have a different install tree.
- `VERILATOR_NPM_BINARY` — force a specific platform package name, e.g.
  `VERILATOR_NPM_BINARY=verilator-linux-x64 verilator --version`. Useful for
  testing.

## Versioning

The npm version encodes the upstream Verilator version plus a packaging
revision: Verilator `5.048` → npm `5.048.0`; a re-package of the same Verilator
release bumps to `5.048.1`.

## License

Verilator is licensed under the LGPL-3.0-only. This npm packaging is maintained
at https://github.com/drom/npm-verilator.
