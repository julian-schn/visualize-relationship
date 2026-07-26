# Relationship graph

A private, local-first graph of real people, family lines, and social relationships.
The source data stays as plain JSON in git, and the finished viewer is one self-contained
`dist/graph.html` file that works offline when opened directly.

## Requirements

- Node.js 20 or newer
- npm

## Setup

```sh
npm install
```

Installation also configures the repository-local git hooks.

## Current state

The project is being built milestone by milestone. The scaffold and CI arrive first;
schemas, validation, kinship derivation, the offline build, and the viewer follow in the
order documented in `AGENTS.md`.

## Data safety

Real records eventually live in `people/`, `unions/`, and `relations/`. New unstructured
material must enter through `inbox/`; it is never written directly into the data folders.
The repository and its generated viewer are private.
