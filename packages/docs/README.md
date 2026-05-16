# @trace/docs

Source for the Trace documentation site. v1.0 wires Nextra
(Next.js + MDX) and serves from `pages/`. The bulk of v1.0 documentation
already lives in [../../SPEC.md](../../SPEC.md); this package's role is to
publish it as a navigable site at `https://trace.dev` (TBD domain).

## Phase 8 status

The site is intentionally a stub right now — copy points to SPEC.md until the
Nextra build is wired up. See the 12-week plan in
[/Users/souravsingh/.claude/plans/trace-final-quirky-sonnet.md](../../../.claude/plans/trace-final-quirky-sonnet.md)
phase 8d.

Suggested page tree:

```
pages/
├── index.mdx                # Quick start (install + minimal example)
├── why.mdx                  # Why a new format; cross-platform pixel parity
├── api/
│   ├── trace-view.mdx       # <TraceView /> reference
│   ├── use-session.mdx      # useTraceSession() reference
│   └── convert.mdx          # convert / inspect
├── format/
│   ├── overview.mdx         # SPEC §3 condensed
│   └── sections/{geom,idix,hitx,strs,anim,meta}.mdx
├── streaming.mdx            # SPEC §8 (wire protocol)
├── animation.mdx            # SPEC §9 (drawing-motion model)
├── conformance.mdx          # How to run the suite, how to add a fixture
└── examples/{mermaid,whiteboard,native-ios,native-android}.mdx
```
