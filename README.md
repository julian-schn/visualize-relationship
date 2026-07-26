# Relationship graph

A private, local-first graph of family lines and social relationships. The data is plain
JSON in git; the viewer is one self-contained `dist/graph.html` that works offline.

Requires Node 20+.

```sh
npm install     # also installs the git hooks
npm test
```

`AGENTS.md` is the spec and the rulebook. Read it before changing anything.

New material enters through `inbox/` and is never written straight into `people/`,
`unions/`, or `relations/`.
