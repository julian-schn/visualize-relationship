# Relationship graph

A private, local-first graph of family lines and social relationships. The data is plain
JSON in git; the viewer is one self-contained `dist/graph.html` that works offline.

Requires Node 20+.

```sh
npm install       # also installs the git hooks
npm run validate  # schema, references, dates, vocabulary
npm test
npm run build     # writes dist/graph.html
```

`dist/graph.html` is committed, so a fresh clone opens the graph by double-clicking it. It
has no network dependencies at all: the graph is inlined into the page rather than fetched,
because `fetch()` on `file://` is blocked by CORS.

`AGENTS.md` is the spec and the rulebook. Read it before changing anything.

Real people only, and never written straight into `people/`. New material goes through
`inbox/`, which arrives with the ingestion tooling.
