# examples/react-native-mermaid

Renders a Mermaid flowchart in React Native using `@trace/runtime`. This is
the source for **Artifact A** from SPEC §15 — the side-by-side benchmark video
that's the v1.0 success gate.

## What it does

1. Mermaid CLI generates a 200-node org chart SVG at build time.
2. `npx @trace/cli convert org-chart.svg --out org-chart.trace` runs in the
   metro build pipeline.
3. The app loads the `.trace` and renders via `<TraceView>` next to the same
   chart rendered by `react-native-svg`.
4. Both panels share scrolling input so visible perf differences are obvious.

## Run (when phase 4/5/6 binaries land)

```bash
cd examples/react-native-mermaid
npm install
npm run ios   # or: npm run android
```

## Status

Source ships; the app wires the published `@trace/runtime` and
`@shopify/react-native-skia` packages — those need the prebuilt native binaries
from a real GitHub release to function. See [SPEC.md §13.4](../../SPEC.md#134-npm-package-distribution).
