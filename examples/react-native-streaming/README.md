# examples/react-native-streaming

Streaming AI-whiteboard demo using `useTraceSession`. This is the source for
**Artifact B** from SPEC §15 — the live AI-drawing demo.

```tsx
import { TraceView, useTraceSession } from '@trace/runtime';

export default function Whiteboard() {
  const session = useTraceSession({ viewBox: [0, 0, 800, 600] });
  useEffect(() => {
    const ws = new WebSocket(process.env.EXPO_PUBLIC_TRACE_WS!);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'fragment') session.append(m.svg, m.anim);
    };
    return () => ws.close();
  }, [session]);
  return <TraceView source={session} style={{ flex: 1 }} />;
}
```

For local development without a server, the demo includes
`fixtures/recorded-feed.json` — a captured fragment sequence that drives the
session offline at the same cadence the AI would emit.
