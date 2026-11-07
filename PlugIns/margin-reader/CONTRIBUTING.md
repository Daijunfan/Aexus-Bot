# Contributing

Use Node >=22.13.0 and npm with the committed lockfile. Keep changes inside this project. The enclosing Toolbox repository includes unrelated user work: do not stage, commit, reset, clean or stash the parent repository for this project. Do not commit downloaded books, private workspaces, credentials or generated artifacts.

Read AGENTS.md and API.md. The public runtime contract is shared by CLI, TUI, optional browser and optional host. Persistent capabilities belong in runtime.request and the contract generator. Do not implement a second data model in the terminal, bypass workspace checks, remove conflict assertions or retry stale writes silently. Keep MOBI parser 0.4.6 compatibility fixtures.

## Safe local checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:release
npm run test:package
```

The release checks create an isolated temporary source copy and temporary HOME. Package verification uses synthetic Chinese/English HTML and PDF, installs the real tarball into a fresh consumer directory and runs outside the checkout. Native dependencies are installed by npm on the test platform. Local installed business workflows are tested under macOS process sandbox network denial. Do not call a live model or use a user's library as a fixture.

Use tests/cli-product*.test.cjs for CLI behavior and the TUI suites for terminal input/geometry. Package verification is an additional integration gate, not a replacement for unit or interaction tests. No skip or unavailable dependency is a pass. Retain logs and failed runs in artifacts/cli-product-20261018/.

## Legacy suites

AGENTS.md requires agent-acceptance after changes and deep-audit after browser geometry changes. Before execution, inspect host entrypoints, protocol fixtures, Electron and Playwright. If the old host is missing or retired, record exact missing paths and mark the relevant suites blocked; do not rewrite them to pass or launch another installed user application. Historic test:acceptance scans Downloads and test:pdf-modes reads a default-library book: do not run those defaults. Network live tests and large backup benchmarks are outside this CLI/TUI release scope.

## Releases

Follow docs/RELEASING.md. A local tarball and integrity manifest are reviewable artifacts. Publishing, pushing remotely and replacing any running user application require separate explicit instructions. Do not infer package-name ownership from local npm pack success.
