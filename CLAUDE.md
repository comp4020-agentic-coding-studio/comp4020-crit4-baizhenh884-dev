# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so look at the deployed head when you add pages.

## The checks

`pnpm check` runs them (`pnpm check:evidence` is the extra gate before you
ship); CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out (a
linter, say), a fact about the stack that is easy to get wrong --- write it down
here and wire it into `check`. Growing this file is the work.

## Harness maintenance protocol

When we hit a repeated correction, a failed test, an incorrect assumption, an
issue caught in manual review, or a decision to throw out an implementation ---
pause before moving on. Ask whether it reveals a reusable working rule, not
just a one-off mistake.

If it does, propose one of:

- a change to an existing rule in this file, or
- a new automated check (a test, a lint rule, a script).

The proposal must state three things: the specific problem that triggered it
(what happened, where), the rule being proposed, and how we'll know the rule
is working (a check that fails if it's violated, or a concrete situation to
watch for next time).

Never edit this file to add or change a rule without my approval first --- show
the proposed diff and wait, every time, for every future change. This file can
hold both durable working constraints and current-project facts or contracts
--- a project-specific rule belongs here when it's explicit, testable, and
useful for directing the agent. It must not hold task lists or page-by-page
implementation plans; those live elsewhere. Because the course carries this
harness forward into next week's deliverable, review every project-specific
rule at that point --- update it, generalize it, or remove it if it no longer
applies --- rather than letting it silently persist. Once a change is
approved, commit it on its own, separate from unrelated work, so it can be
cited individually in `PROCESS.md`.

There are no project-specific contracts yet for this deliverable --- they'll be
added here as they're approved.
