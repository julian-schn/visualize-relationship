# Decisions

## 2026-07-26 — Keep one private graph of real people

The graph contains real people only, so the data model has no realm discriminator. Living
people's birth dates may remain in the private git history. There is no existing import
corpus; new information enters through `inbox/`.

## 2026-07-26 — Default to English

English is the default kinship language. German terms remain a viewer toggle and are
authored independently rather than machine-translated.

## 2026-07-26 — Separate nicknames, aliases, and pronouns

`names.nicknames` stores familiar names, while `names.aka` remains available for other
aliases. Optional pronouns are an ordered array of free strings, displayed exactly as
written and never inferred from the pedigree-oriented `sex` field. All name forms are
searchable, and pronouns appear in person details.

## 2026-07-26 — Preserve duplicate IDs as merged tombstones

`merged` is a person status that requires `mergedInto`. Tombstones keep their ID, names,
and metadata, while loaders flatten merge chains and omit tombstones from the visible graph.

## 2026-07-26 — Use structured vocabulary entries

Every controlled-vocabulary entry is an object with a key and label. Provisional entries
also carry a flag and an added date, making their age mechanically checkable.

## 2026-07-26 — Store symmetric relations once

A symmetric social tie is one undirected record. Its `symmetric` field must agree with its
vocabulary entry. Inverse labels on asymmetric types describe the opposite viewpoint and
do not imply another stored relation.

## 2026-07-26 — Interpret approximate years as plus or minus one year

An EDTF-subset value such as `1890~` spans `1889-01-01` through `1891-12-31`. Wider
uncertainty is represented as an explicit range.

## 2026-07-26 — Commit the offline viewer

`dist/graph.html` is versioned so a fresh clone is immediately usable. Once the build exists,
CI regenerates the file and fails when the committed output is stale.

## 2026-07-26 — Activate quality gates progressively

Bootstrap commits cannot run validators and generators that do not exist yet. Hooks and CI
run each real gate as soon as its milestone implements it, then make that gate unconditional.
No-op scripts are not used to simulate successful checks.

## 2026-07-26 — Defer GEDCOM and report maintenance through issues

GEDCOM export waits for a concrete need. Weekly maintenance runs in GitHub Actions and opens
an issue only when its machine-readable report contains findings; it never commits changes.
