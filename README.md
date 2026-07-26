# Relationship graph

A private, local-first graph of family lines and social relationships, kept as plain JSON in
git and read through one self-contained `dist/graph.html` that works offline.

It is built to be maintained by an AI agent. The data is small, hand-editable and diffable
on purpose: the tedious parts — turning prose into records, spotting duplicates, keeping the
docs honest — are the agent's job, and everything the viewer needs at runtime is ordinary
code that ships in the page. `AGENTS.md` is the agent's rulebook, and `CLAUDE.md` symlinks to
it so Claude Code loads it automatically.

Requires Node 20+.

```sh
npm install       # also installs the git hooks
npm test
npm run build     # writes dist/graph.html
```

## Adding people

Don't write to `people/` by hand. Drop whatever you have into `inbox/` — a voice-note
transcript, half a sentence, a photo caption — and ask your agent to ingest it. It will:

```sh
npm run find -- "karl"    # every id, name form and note that might already be this person
npm run inbox:apply       # validate the staged patch, apply it, or refuse the lot
```

`inbox:apply` is all or nothing. It validates the graph as it *would* become and writes
nothing if anything fails, so a patch that would dangle a reference leaves your data alone.
Anything the agent wasn't sure about lands in `suggestions/` as a question rather than a
guess in your records.

## Checking it

```sh
npm run validate          # schemas, references, dates, vocabulary
npm run agent:maintenance # duplicates, drift, formatting; --fix applies only the safe ones
```

Maintenance reports evidence and never a verdict — merging two people is destructive and
stays a human decision.

## Notes

`dist/graph.html` is committed, so a fresh clone opens the graph by double-clicking it. It
makes no network requests of any kind: the graph, the styles and the fonts are all inlined,
because `fetch()` on `file://` is blocked by CORS and the build fails if anything reaches out.

Real people only. Invented records live on an unmerged branch or in the tests, never on
`main` — nothing in a record marks a person as fictional, so once one is merged it cannot be
found again.
