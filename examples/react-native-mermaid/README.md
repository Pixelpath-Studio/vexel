# Vexel Mermaid Demo — React Native iOS

A minimal Expo app that renders a Mermaid-style flowchart on iOS (and Android)
and highlights whichever element you tap. The tap surface uses the same id
shape Mermaid produces (`flowchart-A-1`, `L_A_B_0`), so the same UI code will
work unchanged once the rendering backend is swapped to `@pixelpath/vexel`.

```
flowchart TD
  A[Start] --> B{Decide}
  B -->|yes| C[Ship]
  B -->|no|  D[Wait]
```

## What this demo proves today

| Feature | Today (this demo) | Future (`@pixelpath/vexel`) |
|---|---|---|
| Render Mermaid on iOS | ✅ via `react-native-svg` | ✅ via `<VexelView>` + Skia |
| Tap-to-highlight | ✅ JS state + per-element handler | ✅ Rust hit-test routed to JS |
| Mermaid id convention | ✅ `flowchart-X-N`, `L_A_B_N` | ✅ + normalized short forms (`A`, `A->B`) |
| Pixel parity iOS/Android | ⚠️ uses each platform's SVG renderer | ✅ Skia on both |
| 200-node performance | ⚠️ degrades (JS bridge per element) | ✅ native draw loop |

Today's path uses `react-native-svg`, which is well-tested, has zero native
binary requirements beyond what Expo ships, and gets a working iOS demo in
~5 minutes. Switching the rendering backend to Vexel is a separate step that
requires building `VexelCore.xcframework` + `Vexel.framework` + wiring Skia —
see "Switching to @pixelpath/vexel" at the bottom.

## Prerequisites

- Xcode 15+ with iOS Simulator installed
- Node 20+
- (Already on macOS) Watchman: `brew install watchman`

You do **not** need CocoaPods/Ruby installed up front — Expo handles that the
first time you run `expo run:ios`.

## Run on the iOS Simulator

```bash
cd /Users/souravsingh/Crux/Curo/Vexel/examples/react-native-mermaid

npm install          # one-time
npm run ios          # builds + launches the simulator
```

The first `expo run:ios` will take a few minutes (it installs CocoaPods + the
RN dependencies + builds the iOS project). Subsequent runs are ~10 seconds.

You should see a 4-node flowchart with arrows. Tap any node or edge — its
border turns orange, and the tapped id appears in the subheader. Tap a
different element to switch the highlight.

## Run on a physical iPhone

Same command — connect your iPhone via USB, trust the computer, then:

```bash
npm run ios -- --device
```

You'll need to sign the build with your Apple ID (Xcode walks you through
this the first time).

## Where the diagram lives

- **JSX form** (used by the app): hard-coded as `NODES` and `EDGES` arrays in
  [App.tsx](App.tsx). Edit these to change the layout.
- **Raw Mermaid SVG form**: [assets/sample-mermaid.svg](assets/sample-mermaid.svg) —
  what Mermaid's CLI would output for the same diagram. Useful for showing the
  id pattern (`flowchart-A-1`, `L_A_B_0`) that the app mirrors.

## Verify the Vexel format pipeline (no app needed)

The repo's CLI already converts that exact SVG into a `.vex` file you can
inspect:

```bash
cd /Users/souravsingh/Crux/Curo/Vexel
cargo build -p vexel-cli         # one-time
./target/debug/vexel-cli convert examples/react-native-mermaid/assets/sample-mermaid.svg --out /tmp/mermaid.vex
./target/debug/vexel-cli inspect /tmp/mermaid.vex
```

That proves the **format** + **id normalization** halves of Vexel work
end-to-end for this exact demo's SVG. The remaining gap is wiring the iOS
renderer to consume the bytes — that's the "Switching to @pixelpath/vexel" step.

## Use your own Mermaid diagram

1. Open the Mermaid Live Editor → https://mermaid.live
2. Write your diagram (e.g. `flowchart TD; A-->B`)
3. **Important:** in the Configuration panel, set `flowchart.htmlLabels: false`
   so the SVG contains plain `<text>` instead of `<foreignObject>` (Vexel v1
   doesn't support `<foreignObject>`).
4. Export as SVG and drop it in `assets/`.
5. Either render it via `<SvgXml xml={raw}/>` from `react-native-svg`
   (loses individual tap targets) OR translate it to JSX with explicit ids
   like the existing `NODES`/`EDGES` arrays.

## Switching to @pixelpath/vexel (the v1.0 success gate)

To swap the rendering backend to Vexel — which is what SPEC §15's Artifact A
benchmarks — you need:

1. **iOS native binaries.** From the repo root:
   ```bash
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
   cargo install uniffi-bindgen-swift
   ./platforms/ios/scripts/build-xcframework.sh
   ```
2. **Skia distribution.** `@pixelpath/vexel` declares `@shopify/react-native-skia`
   as a peer dep; install it: `npm install @shopify/react-native-skia`.
3. **`@pixelpath/vexel` itself.** Once `packages/runtime/` is built and
   published (or linked locally with `npm link`), replace the body of `App.tsx`
   with:
   ```tsx
   import { VexelView, convert } from '@pixelpath/vexel';
   import raw from './assets/sample-mermaid.svg';

   const bytes = convert(raw);
   <VexelView
     source={bytes}
     highlightedIds={selectedId ? [selectedId] : []}
     onElementPress={(id) => setSelectedId(id)}
     style={{ flex: 1 }}
   />
   ```
   Everything else (state, layout, the SafeAreaView wrapper) stays the same.

Until those native binaries exist, the `react-native-svg` path is the working
demo.

## Troubleshooting

- **`Unable to resolve module @shopify/react-native-skia`**: ignore — that
  dep is only needed once you switch to `@pixelpath/vexel`.
- **"No bundle URL present"**: stop the simulator, run `npx expo start --clear`,
  then rebuild.
- **Pod install hangs on first `expo run:ios`**: it's downloading ~500 MB of
  RN dependencies. Wait it out; subsequent runs are fast.
- **TypeScript errors before `npm install`**: expected — `npm install` fetches
  the types for `react-native`, `react-native-svg`, etc.
