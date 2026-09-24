<div align="center">

# Clipclean

**See what is hiding in copied content before it reaches the next application.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

Copied text carries more than you can see: zero-width characters, text hidden in invisible Unicode tags, terminal escape codes, tracking parameters, spreadsheet formulas and the occasional API key. Clipclean shows you all of it, applies a named cleaning recipe, and lets you check the before and after before anything goes back on the clipboard.

## What it does

- Finds and labels invisible characters: zero-width and directional characters, unusual spaces, separators and other format characters
- Decodes text hidden in Unicode tag characters or stacked variation selectors, and shows what it says
- Recognises terminal escape sequences, including hyperlinks, title changes and clipboard writes, and shows where they point
- Flags likely secrets from common providers without copying them into the report
- Flags spreadsheet formulas, including ones in later cells of tab-separated rows
- Strips tracking parameters from links without rewriting anything else in the URL
- Applies built-in recipes, like `clean-markdown`, or ones you save yourself
- Shows what each rule changed, line by line, and checks the cleaned output before you copy it
- Writes to the clipboard only when you confirm, never reads it on its own, and keeps no history

Emoji sequences, Arabic-script and Indic joiners, and flag emoji are recognised as normal writing, so they are neither reported nor broken.

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/Clipclean.git
cd Clipclean
npm start
```

Open http://127.0.0.1:4176 and paste something in, or choose **Load synthetic release note**. You can also open or drop a text file; `fixtures/release-note.txt` is a good messy example.

The server only listens on 127.0.0.1, serves nothing but the app's own files, and the page's content security policy blocks every network request, so text you paste never leaves your machine. Use `npm start -- --port 8080` (or the `PORT` environment variable) to choose another port.

## Command line

The same engine works on standard input:

```sh
node src/cli.js --recipe clean-markdown < fixtures/release-note.txt
node src/cli.js --inspect < fixtures/release-note.txt
node src/cli.js --rules remove-zero-width,normalise-line-endings < notes.txt
node src/cli.js --list
```

| Option | Effect |
|---|---|
| `--recipe <id>` | Apply a built-in recipe (default `clean-markdown`) |
| `--rules <ids>` | Apply a comma-separated list of rules, in order |
| `--inspect` | Print the inspection report for the input as JSON |
| `--list` | List the built-in recipes and rules |
| `-h`, `--help` | Show usage |

The cleaned text goes to standard output and a summary goes to standard error, including a warning when the output still contains likely secrets, terminal controls, hidden characters or formula-like lines. The exit code is 0 on success, 1 if processing fails and 2 for a usage error or input over the limit. The CLI never touches the clipboard.

## Recipes

| Recipe | Use it for | Rules |
|---|---|---|
| `plain-text` | Turning HTML into plain text | strip HTML, replace unusual spaces, normalise line endings |
| `clean-markdown` | Pasting into an issue or pull request | strip HTML, remove tracking, remove invisible, directional and hidden-payload characters, replace unusual spaces, normalise line endings, trim trailing whitespace |
| `safe-terminal` | Reviewing a command before running it | strip terminal controls, remove invisible, directional and hidden-payload characters, replace unusual spaces, normalise line endings, trim trailing whitespace |
| `clean-links` | Sharing links | remove tracking parameters |
| `remove-invisible` | Text for another tool or an AI assistant | remove invisible, directional and hidden-payload characters, replace unusual spaces, normalise line endings |
| `normalise-typography` | Code, config and plain-text files | replace unusual spaces, straighten smart quotes, normalise line endings |

In the web app you can build your own recipe from any of the rules. Only its name and rule identifiers are stored in your browser, never any text.

## Limits

- Inputs are limited to 500,000 characters, and each kind of finding lists at most 1,000 records (the rest are counted).
- Pattern checks can produce false positives and can miss secrets or harmful instructions. Treat the report as a prompt to look, not a guarantee.
- Browser text boxes turn carriage returns into line feeds. Clipclean keeps the exact original when a paste replaces the whole box or when you open or drop a file; once you edit the text in the box, the box's version is used.

## Status

v0.1 runs in the browser and on the command line. Next up are a native macOS app with direct pasteboard access, and recipes for specific apps.

## Development

```sh
npm test        # all tests
npm run check   # tests plus syntax checks
```

The engine is `src/core.js`, which has no dependencies and runs unchanged in the browser and in Node. `src/app.js` is the web interface, `src/cli.js` the command line and `server.mjs` the local development server. Tests live in `test/` and use the built-in Node test runner. Source files must spell invisible characters as escape sequences; a test enforces this.

## Licence

[MIT](LICENSE)
