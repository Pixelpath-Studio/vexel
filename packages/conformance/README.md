# @trace/conformance

The Trace conformance suite. Each fixture is a self-contained `(input, output.trace,
queries.json)` triple that defines a single point of conformance. Any implementation
of the Trace format — the reference Rust runtime today, a hypothetical web/Flutter/Qt
port tomorrow — can run against this suite and prove that it produces the same bytes
and answers the same queries.

## Fixture layout

```
fixtures/
  001-empty/
    input.json          # canonical IR description (or input.svg for converter fixtures)
    output.trace        # the canonical byte representation
    queries.json        # expected results for viewBox, ids, element_count, hit-test points
  002-...
```

## Adding a fixture

1. Pick the next free number.
2. Write `input.json` (or `input.svg`).
3. Run the matching generator from `crates/trace-core/examples/` to produce
   `output.trace`. The Rust core is the source of truth for canonical bytes.
4. Write `queries.json` describing every property the suite should verify.

## Running the suite

The Node runner lands in week 8. Today, the only mechanical check is `cmp` against
the canonical bytes — run by `.github/workflows/ci.yml` for fixture 001.
