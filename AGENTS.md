# AGENTS.md

Standing instructions and full build spec for this repository.

This file is both the product spec and the permanent rulebook for any agent working here.
Read it fully before touching anything. Keep it current: if reality diverges from this
document, the document is a bug.

`CLAUDE.md` is a symlink to this file.

Work milestone by milestone through section 17. Small, verifiable, conventional commits;
never build everything in one. Anything you had to decide that this spec left open goes in
the commit body that decided it, per section 16.

---

## 1. What this is

A private, local-first graph of people: family lines and social relationships, with notes
per person and an interactive viewer.

It is a personal knowledge tool. Nothing is published. There is no server, no account, no
telemetry, no hosted site.

**Goals**

- Model family structure accurately, including the messy cases
- Model social relationships, including asymmetric ones
- Keep the data as plain, diffable, hand-editable JSON in git
- Produce one self-contained HTML file that can be opened by double-clicking it
- Let an agent do the tedious authoring, maintenance and documentation work

**Non-goals**

- Multi-user editing, sync, auth
- Any hosted deployment
- A general-purpose graph database
- Genealogical source citation and evidence management (explicitly out of scope; see 5.1)

---

## 2. Hard constraints

1. **Offline.** The built viewer must work from `file://` with no network access.
2. **No fetch at runtime.** `fetch()` against a local JSON file over `file://` is blocked by
   CORS. The build step must inline the compiled graph into the HTML as a `<script type="application/json">`
   block. This is not optional and it is the single most common way this kind of tool breaks.
3. **No runtime agent.** The viewer never calls an LLM. All logic the viewer needs at runtime
   (kinship derivation, path finding, layout) is ordinary code that ships in the bundle.
   Agent involvement stops at authoring time. See section 9.
4. **Private.** Assume the repo is private and stays private. Never add anything that phones home.
5. **Data is the product.** Code can be rewritten. The JSON in `people/` is the thing worth
   protecting. Never destructively edit it without validation passing first.

---

## 3. Stack

Keep the dependency count low. Justify any addition in a commit body.

- TypeScript, Node 20+
- `esbuild` for bundling, and for running the TypeScript behind the npm scripts via
  `src/build/run.mjs`. Node 20 cannot execute TypeScript, and reusing a dependency the
  viewer already needs beats adding a second one. The runner goes away if the minimum Node
  version ever rises to one with native type stripping.
- `ajv` for JSON Schema validation
- `cytoscape` + `cytoscape-dagre` + `cytoscape-fcose` for the viewer
- `vitest` for tests
- No UI framework. The viewer is one page. Vanilla DOM is enough and keeps the bundle small.

If you want to swap any of these, write a proposal (section 13.3) first.

---

## 4. Repo layout

```
AGENTS.md              this file
CLAUDE.md              symlink to AGENTS.md
README.md              short human-facing intro, generated-ish, keep it current
package.json

people/                one JSON file per person, filename = <id>.json
unions/                one JSON file per union, filename = <id>.json
relations/             one JSON file per social relation, filename = <id>.json
notes/                 optional markdown sidecars, filename = <person-id>.md
vocab.json             controlled vocabulary for every enum-ish field

schema/                JSON Schema files
  person.schema.json
  union.schema.json
  relation.schema.json
  vocab.schema.json

src/
  model/               types, loaders, id helpers
  kinship/             derivation engine (see section 8)
  validate/            validation rules (see section 10)
  viewer/              the single-page app
  build/               compile + inline pipeline
  agent/               maintenance, dedup, report generators

inbox/                 raw unstructured input dropped by the human
  processed/           raw input after it has been ingested
  staged/              agent-produced patch files awaiting apply

suggestions/           agent-authored maintenance findings, dated markdown
proposals/             schema/vocab change proposals, numbered markdown
migrations/            versioned, reversible data migrations

.githooks/             git hooks (section 15)
.github/workflows/     CI (section 15)
dist/                  committed build output; see 12.3
```

---

## 5. Data model

Three record types. Everything else is derived.

### 5.0 The core rule

**Never store a relationship that can be computed.**

No `sibling`, `cousin`, `uncle`, `grandparent`, `nephew`, `in-law`, `step-sibling`,
`half-brother` records. Ever. You store parentage and partnerships; the kinship engine
computes the rest.

If you find yourself wanting to store a derived kin link, the engine is missing a case.
Fix the engine, do not corrupt the data.

### 5.1 Person

`people/<id>.json`

```json
{
  "id": "agnes-vogt",
  "names": {
    "display": "Agnes Vogt",
    "given": "Agnes",
    "family": "Vogt",
    "nicknames": ["Aggie"],
    "aka": ["Agnes V."],
    "former": [{ "display": "Agnes Bauer", "until": "2014" }]
  },
  "pronouns": ["she/her"],
  "birth": { "date": "1962-03-04", "place": "Stuttgart" },
  "death": { "date": null, "place": null },
  "status": "living",
  "parents": [
    { "id": "karl-vogt", "kind": "birth", "confidence": "certain" },
    { "id": "marie-vogt", "kind": "adoptive", "confidence": "certain" }
  ],
  "tags": ["maternal-side"],
  "links": { "obsidian": "People/Agnes.md" },
  "notes": "Free markdown. Or omit and use notes/agnes-vogt.md.",
  "meta": { "created": "2026-07-26", "updated": "2026-07-26", "author": "agent" }
}
```

Field notes:

- `names.nicknames` contains familiar or shortened personal names. `names.aka` is reserved
  for other aliases, public names or identities that are neither nicknames nor former names.
  Both are optional arrays of unique, non-empty strings and both participate in search.
- `pronouns` is an optional ordered array of free, non-empty strings such as `["she/her"]`
  or `["she/her", "they/them"]`. Order expresses preference. Pronouns are displayed exactly
  as written and are not controlled vocabulary. They are the only gender a record carries,
  they are shown rather than interpreted, and they never pick a kinship term (see section 8).
- `status`: `living` | `deceased` | `unknown` | `merged`. `merged` is reserved for
  duplicate tombstones and requires `mergedInto`; it is never used for an active person.
- `parents` is an array of 0..n. Order is not meaningful. `kind` comes from `vocab.parentKind`:
  `birth`, `adoptive`, `step`, `foster`, `guardian`, `donor`, `unknown`.
- `confidence`: `certain` | `probable` | `uncertain`. Rendering dashes uncertain edges.
  This is the only provenance-ish field we keep. There is deliberately no `sources` field.
- `notes` is markdown. If the note is longer than roughly 20 lines, move it to
  `notes/<id>.md` and drop the inline field. The loader merges both, sidecar wins.
- `meta.author` is `human` or `agent`. Agents must set it honestly.

### 5.2 Union

`unions/<id>.json`

Partnerships only. Children are **not** listed here; parentage lives on the child. This
diverges from GEDCOM on purpose: it survives messy and partial data much better.

```json
{
  "id": "u-0001",
  "partners": ["agnes-vogt", "karl-hoffmann"],
  "type": "marriage",
  "from": "1988-06-11",
  "to": "2004",
  "endReason": "divorce",
  "note": ""
}
```

- `partners` is 1..n. One partner is legal (single parent, unknown other party). Three or
  more is legal (polyamorous or communal arrangements). No special-casing anywhere.
- `type` from `vocab.unionType`: `marriage`, `civil-partnership`, `partnership`,
  `engagement`, `liaison`, `unknown`.
- `endReason` from `vocab.unionEnd`: `divorce`, `separation`, `death`, `annulment`,
  `drift`, `unknown`, or `null` while ongoing.

Step-relations, half-siblings and in-laws all fall out of unions plus parentage. Do not
store them.

### 5.3 Relation

`relations/<id>.json`

Elective and social ties. This is where the interesting data lives.

```json
{
  "id": "r-0132",
  "type": "friend",
  "from": "julian",
  "to": "pat",
  "symmetric": true,
  "closeness": 4,
  "since": "2019",
  "until": null,
  "status": "active",
  "context": ["discord"],
  "note": ""
}
```

- `symmetric: true` means the tie is mutual and direction is meaningless. Render undirected.
- `symmetric: false` means `from` holds the role toward `to`. Mentor, rival, admirer,
  benefactor, one-sided attachment. **Asymmetry is a feature.** Two people can hold different
  views of the same tie: model that as two separate relations with different `type` and
  `closeness`, both `symmetric: false`. The validator must not complain about this.
- `closeness` is 0..5, optional. Drives edge weight in the force layout.
- `status` from `vocab.relationStatus`: `active`, `dormant`, `estranged`, `ended`, `unknown`.
  **Never delete a relation because it ended.** People fall out and come back. Set the status
  and the `until` date. An ex-friend is `status: ended` with an `until`, exactly as an
  ex-partner is a union with a `to` and an `endReason`.
- `endReason` from `vocab.relationEnd`, or `null` while ongoing. Separate from `status`,
  which records only *that* a tie ended. It has its own vocabulary rather than sharing
  `unionEnd`, because a friendship does not end by divorce or annulment.
- `context` is free-ish tags from `vocab.context`: `school`, `work`, `discord`, `music`,
  `childhood`, and so on. Additions are allowed under the provisional rule in 5.4.

### 5.4 Vocabulary

`vocab.json` is the single source of truth for every constrained string in the data.

The collections are `relationType`, `parentKind`, `unionType`, `unionEnd`, `relationStatus`,
`context` and `tag`, plus an integer `version`. Read the file for the current keys; it is
short, and a copy here would be wrong within a week.

**Why this exists:** without it an agent invents `buddy`, `pal`, `good friend` and
`close friend` inside a week and every filter in the viewer becomes useless.

All vocabulary collections contain descriptor objects with at least `key` and `label`.
Code compares and stores `key`; labels are for display and generated documentation.

**Provisional additions.** An agent may add a new vocabulary entry mid-ingestion if nothing
existing fits, but it must be marked `"provisional": true`, include an ISO `added` date,
and have a proposal filed the same run (section 13.3). `validate` warns about provisional
entries older than 30 days, which is what stops them becoming permanent by neglect.
An agent may never add a provisional entry that is a near-synonym of an existing key. Check
first. If in doubt, use the closest existing key and note the nuance in the relation's `note`.

---

## 6. IDs and names

- IDs are lowercase kebab slugs derived from the display name at creation time:
  `agnes-vogt`. Collisions get a numeric suffix: `karl-vogt-2`.
- **IDs are permanent.** If someone changes their name, update `names`, never the id.
  Renaming an id breaks every reference and every git blame. Do not do it.
- Union ids: `u-NNNN`. Relation ids: `r-NNNN`. Zero-padded, monotonic, never reused.
- Filenames always equal the id. The validator enforces this.
- Deleting a person is forbidden. If a person turns out to be a duplicate, keep the file,
  set `"status": "merged"` and `"mergedInto": "<other-id>"`, move the real content across,
  and let the loader transparently redirect references. A tombstone costs nothing and
  prevents silent data loss.
- A merged tombstone keeps `id`, `names` and `meta` so searches and history stay intelligible.
  The validator rejects self-merges, dangling targets and merge cycles. The loader flattens
  merge chains and excludes tombstones from the visible graph.

---

## 7. Dates

Plain ISO 8601 is not sufficient. Real family data is full of "around 1890" and "before the war".

Use a small EDTF subset. One string field, one parser in `src/model/date.ts`:

| Form          | Meaning                    |
| ------------- | -------------------------- |
| `1962-03-04`  | exact day                  |
| `1962-03`     | month only                 |
| `1962`        | year only                  |
| `1890~`       | approximately              |
| `1890/1895`   | somewhere in that range    |
| `..1900`      | before                     |
| `1900..`      | after                      |
| `null`        | unknown                    |

The parser returns `{ earliest, latest, display, precision }`. Everything downstream
(sorting, the timeline scrubber, validation) uses the interval, never the raw string.
An approximate year spans one calendar year on either side: `1890~` has earliest
`1889-01-01`, latest `1891-12-31`, and display `c. 1890`. Wider uncertainty must use an
explicit range.

---

## 8. Kinship engine

`src/kinship/`. Pure functions, no I/O, heavily tested. This is the brain of the tool.

**Derivation.** Build the parentage DAG. For any two people, find the lowest common
ancestors, compute the (up, down) distance pair, then map that pair to a term:

- `(1,0)` parent, `(0,1)` child
- `(1,1)` sibling; full if both parents shared, half if one
- `(2,0)` grandparent, `(2,2)` first cousin, `(3,2)` first cousin once removed, and so on
- `(2,1)` parent's sibling, `(1,2)` sibling's child

Then layer on the non-blood cases:

- **Step**: connected through a union rather than shared parentage
- **In-law**: connected through a partner's blood line
- **Adoptive / foster / guardian**: parentage edges whose `kind` is not `birth`. These are
  full kin for term purposes. Only mark the distinction when the human explicitly asks for it
  via a display toggle.
- **Chosen family**: a social relation, never a computed kin term, but it should show up in
  the "how are we related" answer as a separate line

**Terms are gender-neutral.** A record carries no gender except `pronouns`, which is free
text meant to be displayed rather than interpreted, so there is nothing to derive a gendered
term from and the engine does not try. `(1,1)` is *sibling*, never brother or sister.

**Term tables** live in `src/kinship/terms.<lang>.ts`. Ship `en` and `de`; do not
machine-translate the English table, write it properly. German has no neutral singular for
parts of the collateral line, so where a neutral form exists it is used (`Elternteil`,
`Geschwisterteil`, `Enkelkind`) and where none does the paired form stands in
(`Tante oder Onkel`). Never guess a gender to avoid the pairing.

**Path finding.** Shortest path between two nodes across all edge types, with type-weighted
costs so blood lines are preferred over "friend of a friend of a cousin". Returns an ordered
list of hops with per-hop labels plus one summary term when the path is pure parentage.

**Cycle safety.** The parentage graph must be acyclic. Every traversal must be depth-capped
and cycle-guarded anyway, because bad data will exist at some point and the viewer should
degrade rather than hang.

---

## 9. What is code and what is agent judgment

Draw this line clearly and keep it drawn.

**Must be code** (the viewer runs offline, an agent cannot help it):

- kinship derivation and term labelling
- path finding
- validation
- layout
- date parsing
- build and inline

**Should be agent** (fuzzy, one-off, or judgement-heavy; simplifies the codebase a lot):

- turning prose into records
- deciding whether two similarly named people are the same person
- picking the least-wrong vocabulary key for an odd relationship
- writing and rewriting notes
- spotting that the data has drifted and proposing a fix
- keeping docs, README and changelog honest
- authoring migrations

**Never agent**: anything the viewer needs at runtime, anything destructive, anything that
rewrites git history.

Where this spec is ambiguous, prefer moving work to the agent side. Less code is better.
But if a rule can be expressed as a validator, make it a validator rather than relying on
agent diligence. Agents forget; CI does not.

---

## 10. Validation

`npm run validate`. Exits non-zero on any error. Runs in the pre-commit hook and in CI.

**Errors** (block the commit):

- File does not match its JSON Schema
- Filename does not equal `id`
- Dangling reference: any `parents[].id`, `partners[]`, `from`, `to`, `mergedInto` pointing at
  a nonexistent record
- Duplicate id anywhere
- Cycle in the parentage graph (nobody is their own ancestor)
- A person listed as their own parent or their own partner
- Value not present in `vocab.json`
- A relation's `symmetric` value disagrees with its vocabulary entry
- Union with zero partners
- Unparseable date string

**Warnings** (report, do not block; the agent should work through these over time):

- Child's earliest birth is before a parent's latest birth, or less than 12 years after
- Death before birth; union start after union end
- A relation that names an end reason while still marked active
- Union or relation dated after a participant's death
- `status: living` but birth is more than 110 years ago
- Person with no relations of any kind (an island)
- Graph has more than one disconnected component
- Provisional vocabulary entries older than 30 days with no resolved proposal
- Notes sidecar with no matching person, or vice versa when `notes` is referenced

Warnings print to stdout, grouped by rule, with a count line at the end. `validate` still
exits zero when only warnings are present.

---

## 11. Viewer

`src/viewer/`. One page, two layout modes over the same data.

### 11.1 The rule that makes it usable

**Never render the whole graph.** Default view is an ego graph: one focus person, a depth
slider (1 to 3, default 2), everything outside the shell hidden or heavily faded. A
force-directed hairball of 400 people is a screenshot, not a tool.

### 11.2 Modes

- **Lineage mode**: layered DAG via `cytoscape-dagre`, rank = generation, top to bottom.
  This is what a family tree is supposed to look like. Force layouts butcher it.
- **Social mode**: `cytoscape-fcose`, edge weight from `closeness`, clusters by shared context.

Switching modes keeps the focus person and animates between layouts.

### 11.3 Features

- Fuzzy search by any name form including `nicknames`, `aka` and `former`
- Click to focus, breadcrumb trail of previously focused people
- **Relate two people**: pick A and B, get the path plus the derived term
- Timeline scrubber: show the graph as it stood in year Y (hide unborn, grey the dead,
  hide unions and relations outside their date range)
- Filters: relation type, status, tag, context, branch
- Hover card: name, pronouns, dates, tags, first lines of notes. Click opens the full note
  in a panel
- Toggles: show uncertain edges, show ended relations, distinguish adoptive kin, language en/de
- Export the current view as PNG and SVG
- Keyboard: `/` search, `f` focus, `r` relate, `esc` clear, arrows to walk edges

### 11.4 Visual direction

Do not ship the default graph-library look. The subject is a hand-kept kinship chart, so the
reference is drafting and field notation, not a dashboard.

Tokens:

```
--ground:  #E3E5DC   pale lichen, the paper
--ink:     #1E211C   near-black with a green cast, all structural line work
--rule:    #A8AC9C   hairlines, grid, inactive labels
--signal:  #7A2E3A   oxblood, focus person and the active path only
--dormant: #6E7166   the dead, the ended, the faded
```

Dark mode inverts ground and ink, keeps signal.

Type: `Fraunces` for the few display moments (kinship terms, the focus person's name),
`IBM Plex Sans Condensed` for node labels, `IBM Plex Mono` for dates and ids. All three
self-hosted in `src/viewer/fonts/`, because there is no network at runtime.

Line work encodes meaning rather than decorating:

- parentage: solid ink
- parentage with `confidence` below certain: dashed
- non-birth parentage: solid with a small notch glyph at the child end
- union: doubled hairline, broken once where the union ended
- social: single line, thickness from `closeness`
- ended or estranged: dotted, in `--dormant`

**Signature element.** When two people are related, the path draws as one continuous ribbon
in `--signal` that eases in hop by hop, with the derived kinship term set large in Fraunces
at the midpoint. That single moment is the thing this tool is remembered for. Keep everything
around it quiet: no gradients, no shadows, no rounded card chrome, no animated background.

Quality floor without announcing it: keyboard focus is always visible, `prefers-reduced-motion`
kills the ribbon animation and the layout transitions, the panel is usable down to a phone width.

---

## 12. Build

### 12.1 Pipeline

`npm run build`:

1. Load every record from `people/`, `unions/`, `relations/`, `vocab.json`, `notes/`
2. Validate (abort on error)
3. Resolve merged tombstones, parse dates, precompute the parentage adjacency
4. Emit a single compiled graph object
5. Bundle the viewer with esbuild, inlining CSS and fonts as base64
6. Inject the compiled graph as `<script type="application/json" id="graph">`
7. Write `dist/graph.html`

### 12.2 Verify

The build must end by asserting `dist/graph.html` contains no `fetch(`, no external `src=`,
and no `http://` or `https://` references outside of comments. If it does, the build failed,
regardless of what esbuild said.

### 12.3 Output in git

`dist/graph.html` is committed so the graph can be opened straight from a clone. The build
is deterministic. CI rebuilds it and fails when the committed output is stale.

---

## 13. Agent duties

### 13.1 Ingestion

Never write directly to `people/` from raw input. The flow:

1. Human drops prose into `inbox/whatever.md`. Voice-note transcripts, half-sentences,
   a photo caption, anything.
2. Agent reads it. **Before creating any person, search for them**:
   `npm run find -- "karl"` matches ids, all name forms, and notes. Duplicate people are the
   number one failure mode of this kind of tool and they are very hard to unpick later.
3. Agent writes a patch file to `inbox/staged/<timestamp>.patch.json`:
   ```json
   {
     "creates": [{ "type": "person", "record": { } }],
     "updates": [{ "type": "person", "id": "agnes-vogt", "set": { } }],
     "notes": "what I inferred and why, in plain language",
     "uncertain": ["Is 'Uncle Karl' the same Karl as karl-vogt?"]
   }
   ```
4. `npm run inbox:apply` validates the patch against the schemas, applies it, runs full
   validation, and refuses everything if anything fails. Atomic: all or nothing.
5. Agent commits, then moves the raw file to `inbox/processed/`.
6. Anything in `uncertain` goes to `suggestions/` and gets surfaced to the human. Do not guess
   silently. Guessing wrong and writing it down is worse than leaving a gap.

### 13.2 Maintenance

`npm run agent:maintenance` produces a machine-readable report. The agent then acts on it.
With `--format json`, the command writes one JSON object to stdout with a top-level
`findings` array; the weekly workflow uses that stable interface to decide whether to open
an issue.

Run it when asked, and at the start of any session that touches data.

**Auto-fix without asking** (mechanical, reversible, obviously right):

- Normalise formatting, key order and whitespace in record files
- Fill `meta.updated`
- Fix a filename that does not match its id
- Move an oversized inline `notes` field to a sidecar

**Propose, never auto-apply** (judgement or destructive):

- Merging suspected duplicate people
- Changing anyone's `parents`
- Deleting anything at all
- Schema changes, vocabulary promotions, migrations
- Anything that touches more than 10 records at once

Duplicate detection: name similarity, plus shared relations, plus overlapping dates. Report
a score and the evidence, never a verdict.

### 13.3 Suggestions and proposals

- `suggestions/YYYY-MM-DD-topic.md`: findings from a maintenance run. Free-form, short,
  actionable. Delete once resolved.
- `proposals/NNN-short-title.md`: anything that changes the schema, the vocabulary or the
  stack. Front matter with `status: draft | accepted | rejected | superseded`. Structure:
  context, proposed change, migration path, what breaks, what it costs to reverse.

An agent may write proposals freely. An agent may not accept its own proposal. Schema changes
land only after the human says so, and only with a script in `migrations/` that has both an
`up` and a `down`.

### 13.4 Safety rails

Never, under any circumstances:

- Delete a person, union or relation file
- Rewrite git history, amend a pushed commit, or force-push
- Bypass hooks with `--no-verify`
- Commit with validation failing
- Change an existing id
- Edit anything under `inbox/processed/`
- Touch git config beyond the hooks path install

---

## 14. Git conventions

Conventional Commits, enforced by the `commit-msg` hook.

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: `feat`, `fix`, `data`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`.

**Scopes**: `schema`, `data`, `people`, `unions`, `relations`, `model`, `kinship`, `viewer`,
`validate`, `build`, `agent`, `vocab`, `migrations`, `fixtures`, `docs`, `ci`, `hooks`, `deps`.

Rules:

1. **One logical step per commit.** Not one per session, not one per file.
2. **Never mix data and code** in the same commit. If a schema change needs a data migration,
   that is at minimum three commits: `feat(schema):`, then `chore(migrations):`, then `data:`.
3. Commit as soon as validation is green. Do not accumulate a giant uncommitted working tree.
4. Data commits name the people: `data(people): add Agnes Vogt and her parents`.
5. Every agent-authored commit carries the footer `Agent-Run: <short id>` so the human can
   see at a glance what was machine-written.
6. Subject line: imperative, lowercase after the colon, no trailing period, under 72 chars.
7. Body explains *why*, never *what*. The diff already says what.
8. Breaking schema changes use `!` and a `BREAKING CHANGE:` footer.

Examples:

```
data(people): add Agnes Vogt and link maternal line

Three people from inbox/2026-07-26-reunion.md. Karl's birth year is
approximate, the note only said "just after the war".

Agent-Run: a7f3
```

```
feat(kinship): derive step and in-law terms

Previously only blood relations resolved to a term, so anything through
a union fell back to "related". Adds union traversal with a separate
cost so blood paths still win.

Agent-Run: a7f3
```

**Branching**: work on `main` directly for data. Use `agent/<topic>` branches for anything
touching schema or more than 10 records, and let the human merge.

---

## 15. Hooks and CI

### 15.1 Hooks

Plain shell in `.githooks/`, no husky, no dependency. Installed by
`npm run hooks:install`, which runs `git config core.hooksPath .githooks`. The install must
be idempotent and must run as part of `npm install` via a `prepare` script.

- **pre-commit**: run `typecheck` and `validate`. Fail if either fails.
- **commit-msg**: reject anything that is not a valid Conventional Commit with a known scope.
- **pre-push**: full `build` plus `test`. This is the last gate before anything leaves the
  machine.

Hooks must be fast. If pre-commit exceeds about two seconds, cache the parse.

**Bootstrap rule.** A gate becomes unconditional as soon as its real implementation exists:
typechecking and commit-message enforcement in milestone 0, tests in milestone 2, validation
in milestone 3, and build verification in milestone 5. Before then, hooks may use
`npm run --if-present`; the commit that implements a gate removes the corresponding
conditional. Do not create no-op scripts merely to make a gate look green.

### 15.2 CI

Hooks are local and skippable, so `.github/workflows/check.yml` is the real enforcement:
on every push and PR, run `typecheck`, `validate`, `test`, and `build`, then fail if the
committed `dist/graph.html` is stale.

A second scheduled workflow runs `agent:maintenance` weekly and opens an issue if the report
is non-empty. It must never commit.

CI follows the same bootstrap rule as hooks. During early milestones it runs every available
gate; from milestone 5 on, `typecheck`, `validate`, `test`, and `build` are all mandatory.

---

## 16. Documentation

There are exactly two documentation files and there is no documentation build.

- `AGENTS.md`: this file, the spec and the rulebook. **If you change how the system works,
  change this file in the same commit.** A spec that lags the code is worse than no spec.
- `README.md`: what this is and how to build it. Under 30 lines.

Nothing else. No generated schema reference, no vocabulary table, no stats page, no
changelog, no decision log. Every one of those restates something the reader can already
get from the source it was generated from, and each needs a generator, a gate, and a
regeneration step in the hook to keep it from lying.

Where the artefacts went instead:

| Was going to be   | Lives in                                                    |
| ----------------- | ----------------------------------------------------------- |
| schema reference  | `description` on the fields in `schema/*.json`               |
| vocabulary table  | `vocab.json`, which already has a label per key              |
| stats and warnings| `npm run validate` output                                    |
| changelog         | `git log`, which is why section 14 requires real subjects    |
| decision log      | the commit body that made the decision, per section 14 rule 7|

**The standing rule.** Documentation is a liability that has to be maintained. Prefer a
`description` in a schema, a name that does not need explaining, or a commit body over a
new markdown file. Do not add a documentation file without being asked for it, and delete
one whose content has moved into code or into a commit.

---

## 17. Build order

Each milestone ends with green validation, green tests and one or more commits.

0. **Scaffold**: package.json, tsconfig, gitignore, hooks, CI, empty dirs, README stub.
1. **Schemas and vocab**: the three JSON Schemas and `vocab.json`. No code yet.
2. **Model layer**: loader, id helpers, EDTF date parser, merged-tombstone resolution. Tests.
3. **Validation**: every error and warning in section 10. Tests with deliberately broken fixtures.
4. **Kinship engine**: derivation, terms in en and de, path finding. Covers the nasty cases:
   adoption, remarriage, half-siblings, a three-person union, an ended union, an estranged
   friendship, an asymmetric mentorship, an uncertain parent, unknown parents. Its test
   corpus is built in the tests, not committed as records.
5. **Build pipeline**: compile, inline, the section 12.2 assertions.
6. **Viewer, lineage mode**: dagre layout, ego focus, hover cards, search.
7. **Viewer, social mode**: fcose, filters, closeness weighting.
8. **Relate and the ribbon**: the signature interaction.
9. **Timeline scrubber.**
10. **Agent tooling**: `find`, `inbox:apply`, `agent:maintenance`, report generators.
11. **Polish**: keyboard shortcuts, exports, dark mode, reduced motion.

Milestones 0 through 3 are done.
