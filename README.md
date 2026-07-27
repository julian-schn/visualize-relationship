# Relationship graph

A private, local-first graph of family lines and social relationships, kept as plain JSON in
git and read through one self-contained `dist/graph.html`: committed, so a clone opens it by
double-clicking, and inlined end to end, so it never touches the network. Built to be
maintained by an AI agent — `AGENTS.md` is the rulebook and `CLAUDE.md` symlinks to it, so
Claude Code loads it automatically. Needs Node 20+.

```sh
npm install       # also installs the git hooks
npm test
npm run build     # writes dist/graph.html
```

## Adding people

Don't write to `people/` by hand. Drop whatever you have into `inbox/` — a voice-note
transcript, half a sentence, a photo caption — and ask your agent to ingest it. What it
wasn't sure about lands in `suggestions/` as a question, never as a guess in your records.

```sh
npm run find -- "karl"    # every id, name form and note that might already be this person
npm run inbox:apply       # validate the staged patch and apply it, or refuse the lot
npm run validate          # schemas, references, dates, vocabulary
npm run agent:maintenance # duplicates, drift, formatting; --fix applies only the safe ones
```

Real people only. Invented records live on an unmerged branch or in the tests, never on
`main` — nothing marks a record as fictional, so a merged one cannot be found again.
