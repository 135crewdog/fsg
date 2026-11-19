# FSG: Flight Sim Game

A flight sim game for the iPhone: a home-screen web app at <https://135crewdog.github.io/fsg/>. The flight model is JSBSim, compiled to WebAssembly and run unmodified. `CLAUDE.md` says what the game is and the rules it's built under.

## Where things are

- `CLAUDE.md`: the project's rules. Read it first.
- `docs/milestones/`: each milestone's approved plan, its "done" lines and its results. Milestone 0 (setup) is under way: `docs/milestones/0.md`.
- `docs/ideas.md`: ideas, not built until the owner picks one.
- `tests/`: the tests.

## Running the tests

You need Node 22 or later and nothing else: there are no dependencies to install.

```
npm test
```

The same command runs in GitHub Actions on every push and pull request (`.github/workflows/test.yml`).

## How the tools are connected

- **GitHub Actions** runs the tests on every push and pull request.
- **Codex** reviews every pull request when it opens. Claude Code fixes what it finds, or says in the pull request why a finding is wrong. The owner authorizes each merge.
