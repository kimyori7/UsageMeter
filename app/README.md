# app

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

### Native module note (better-sqlite3)

`better-sqlite3` is a native module compiled against a specific ABI. `npm install` runs this
project's `postinstall` (`electron-builder install-app-deps`), which rebuilds native modules
against **Electron's** ABI — but `vitest` runs on the **system Node** ABI, so the two rebuild
states can conflict.

- Before running tests: `npm rebuild better-sqlite3` (rebuilds for system Node so `vitest` can load it)
- Before running/packaging the app: `npx electron-builder install-app-deps` (rebuilds for Electron)

If you just ran `npm install` and `npm test` fails to load `better-sqlite3`, run
`npm rebuild better-sqlite3` and try again.
