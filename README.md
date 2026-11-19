# FSG: Flight Sim Game

A flight sim game for the iPhone: a home-screen web app at <https://135crewdog.github.io/fsg/>. The flight model is JSBSim, compiled to WebAssembly and run unmodified. `CLAUDE.md` says what the game is and the rules it's built under.

## Where things are

- `CLAUDE.md`: the project's rules. Read it first.
- `docs/milestones/`: each milestone's approved plan, its "done" lines and its results. Milestone 0 (setup) is under way: `docs/milestones/0.md`.
- `docs/ideas.md`: ideas, not built until the owner picks one.
- `index.html`, `style.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `src/`: the app. Plain HTML, CSS and JavaScript; nothing is built.
- `jsbsim/`: everything about JSBSim, copied from `135crewdog/FDM`. Its `README.md` says where each piece came from.
- `tools/from-fdm.mjs` and `provenance.json`: the script that copied pieces in from FDM and Wings, and the record of what it copied.
- `tests/`, `jsbsim/tests/`: the tests.

## Running the tests

You need Node 22 or later and nothing else: there are no dependencies to install.

```
npm test
```

The same command runs in GitHub Actions on every push and pull request (`.github/workflows/test.yml`).

One check is not part of `npm test` because it needs a browser: `node tests/browser/app.chromium.mjs` runs the app in headless Chromium (start screen, service worker, offline reload, rotate screen, the update offer). Claude Code runs it before each pull request that changes the app and puts its output in the pull request.

## Running it locally

Any static file server works. From the repo's folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Versions

`APP_VERSION` in `src/version.js`, `VERSION` in `sw.js` and the newest entry in `CHANGELOG.md` change together on every deploy a player would notice. The tests fail if they disagree. Every file the app needs is listed in `sw.js`, so it works offline.

## How the tools are connected

- **GitHub Actions** runs the tests on every push and pull request. On `main`, it publishes the site to GitHub Pages only if they pass (`.github/workflows/pages.yml`).
- **Codex** reviews every pull request when it opens. Claude Code fixes what it finds, or says in the pull request why a finding is wrong. The owner authorizes each merge.
