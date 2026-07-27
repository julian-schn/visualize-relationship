# Relationship graph

A local-first graph of family lines and social relationships, kept as plain JSON in git and
read through one self-contained `dist/graph.html`: committed, so a clone opens it by
double-clicking, and inlined end to end, so it never touches the network. You store parentage
and partnerships; the kinship engine derives sibling, cousin, step-parent, in-law and the rest,
in English or German. Built to be maintained by an AI agent — `AGENTS.md` is the full spec and
rulebook, `CLAUDE.md` symlinks to it. Needs Node 20+.

> **Your own data goes in a private clone.** This repo is the tool and holds no real people.
> A graph of relatives' names, dates and private notes does not belong anywhere public, and
> nothing in a record marks a person as real or invented. A pre-push hook refuses to send
> records here, but it is a seatbelt: keep the clone that holds your family private.

```sh
npm install       # also installs the git hooks
npm test
npm run build     # writes dist/graph.html
```

`main` carries no records, so the page opens to "No people yet". For a populated one, check out
`agent/test-corpus` and rebuild: sixteen invented people, four unions, eight ties.

## Adding people

Don't write to `people/` by hand. Drop whatever you have into `inbox/` — a voice-note
transcript, half a sentence, a photo caption — and ask your agent to ingest it. What it wasn't
sure about lands in `suggestions/` as a question, never as a guess in your records.

```sh
npm run find -- "karl"    # every id, name form and note that might already be this person
npm run inbox:apply       # validate the staged patch and apply it, or refuse the lot
npm run validate          # schemas, references, dates, vocabulary
npm run agent:maintenance # duplicates, drift, formatting; --fix applies only the safe ones
```

MIT, except the three typefaces in `src/viewer/fonts/`, which are under the SIL Open Font
License 1.1 and carry their own notices.
