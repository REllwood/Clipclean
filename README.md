<div align="center">

# Clipclean

**See what is hiding in copied content before it reaches the next application.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

Copied text carries more than you can see: zero-width characters, terminal control codes, tracking parameters, spreadsheet formulas and the occasional API key. Clipclean shows you all of it, applies a named cleaning recipe, and lets you check the before and after before anything goes back on the clipboard.

## What it does

- Finds and labels hidden characters, terminal control sequences, formula-like lines and likely secrets
- Strips tracking parameters from links
- Applies built-in recipes, like `clean-markdown`, or ones you save yourself
- Shows which rule changed each part of the text
- Writes to the clipboard only when you confirm, never reads it on its own, and keeps no history

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/Clipclean.git
cd Clipclean
npm start
```

Open http://127.0.0.1:4176 and paste something in. `fixtures/release-note.txt` is a good messy example.

It also works from the command line:

```sh
cat fixtures/release-note.txt | node src/cli.js --recipe clean-markdown
cat fixtures/release-note.txt | node src/cli.js --inspect
```

## Status

v0.1 runs in the browser and on the command line. Next up are a native macOS app with direct pasteboard access, and recipes for specific apps.

## Development

```sh
npm test        # engine tests
npm run check   # tests plus syntax checks
```

## License

[MIT](LICENSE)
