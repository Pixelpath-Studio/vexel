// HitTestScreen — v0.1.0 painted-area hit testing.
//
// Toggle between 'bounding-box' (legacy, default) and 'visible-painted' to
// see the difference: in painted mode, taps in the empty corner of a
// diagonal arrow no longer trigger it.

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import { hitTestShapes } from '../vexel-runtime/hitTest';
import type { Graph } from '../vexel-runtime';

// A diagonal arrow + a thick horizontal line + a small square. The arrow
// has a huge bounding box covering the entire viewBox; the line covers
// most of the bottom row. With 'bounding-box' mode, taps anywhere in
// these areas trigger the wrong element. With 'visible-painted', only
// the actual painted pixels (+ a 6px tolerance) trigger.
const SVG = `
<svg viewBox="0 0 300 200" xmlns="http://www.w3.org/2000/svg">
  <style>
    .edge { stroke: #475569; stroke-width: 3; fill: none; }
    .label { fill: #0f172a; font-size: 12px; font-family: system-ui; }
    .box   { fill: #fbbf24; stroke: #92400e; stroke-width: 2; }
  </style>
  <g id="diagonal-arrow" class="edge">
    <path d="M20,20 L280,180" />
  </g>
  <g id="horizontal-line" class="edge">
    <path d="M20,180 L280,180" />
  </g>
  <g id="small-square" class="box">
    <rect x="130" y="80" width="40" height="40" />
  </g>
</svg>
`;

type Mode = 'bounding-box' | 'visible-painted';

// Four test points chosen to expose the bbox-vs-painted gap on this SVG:
//   - (150, 100) → INSIDE the yellow square. Both modes hit.
//   - (270, 30)  → empty top-right corner. BBOX hits diagonal-arrow (wrong).
//                  PAINTED falls through (correct).
//   - (150, 100)→ wait same. Let me re-pick: (90, 90) is below the diagonal
//     between (20,20)→(280,180) bbox covers everything from x=20 to 280.
//   - (150, 180) → on horizontal line. Both modes hit (line spans whole bottom).
const TEST_POINTS: Array<{ label: string; x: number; y: number; expectedBbox: string; expectedPainted: string }> = [
  { label: 'inside yellow square (150,100)',        x: 150, y: 100, expectedBbox: 'small-square',     expectedPainted: 'small-square' },
  { label: 'on diagonal arrow (100,70)',            x: 100, y: 70,  expectedBbox: 'diagonal-arrow',   expectedPainted: 'diagonal-arrow' },
  { label: 'EMPTY top-right corner (270,30)',       x: 270, y: 30,  expectedBbox: 'diagonal-arrow',   expectedPainted: 'null (miss)' },
  { label: 'on horizontal line (150,180)',          x: 150, y: 180, expectedBbox: 'horizontal-line',  expectedPainted: 'horizontal-line' },
  { label: 'EMPTY bottom-left (50,150)',            x: 50,  y: 150, expectedBbox: 'diagonal-arrow',   expectedPainted: 'null (miss)' },
];

export function HitTestScreen() {
  const [mode, setMode] = useState<Mode>('visible-painted');
  const [lastTap, setLastTap] = useState<string>('—');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [testResults, setTestResults] = useState<Array<{
    label: string;
    bbox: string;
    painted: string;
    bboxOK: boolean;
    paintedOK: boolean;
  }> | null>(null);

  // Auto-run the synthetic test suite as soon as the graph parses.
  // No clicks required to prove the resolver works against the live graph.
  useEffect(() => {
    if (graph) runTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const runTests = () => {
    if (!graph) return;
    const results = TEST_POINTS.map((p) => {
      const bboxHit = hitTestShapes([p.x, p.y], graph.shapes, 'bounding-box', 6);
      const paintedHit = hitTestShapes([p.x, p.y], graph.shapes, 'visible-painted', 6);
      const bbox = bboxHit?.id ?? 'null (miss)';
      const painted = paintedHit?.id ?? 'null (miss)';
      return {
        label: p.label,
        bbox,
        painted,
        bboxOK: bbox === p.expectedBbox,
        paintedOK: painted === p.expectedPainted,
      };
    });
    setTestResults(results);
  };

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Text style={s.h2}>Painted-area hit testing (v0.1.0)</Text>

      {/* Synthetic test results land at the top so the visual proof is the
          first thing you see when the screen loads. */}
      {testResults ? (
        <View style={s.results}>
          <Text style={s.resultsHeader}>5 test points · bbox vs painted</Text>
          {testResults.map((r, i) => (
            <View key={i} style={s.resultRow}>
              <Text style={s.resultLabel}>{r.label}</Text>
              <View style={s.resultLine}>
                <Text style={[s.resultTag, r.bboxOK ? s.ok : s.bad]}>
                  bbox: {r.bbox} {r.bboxOK ? '✓' : '✗'}
                </Text>
                <Text style={[s.resultTag, r.paintedOK ? s.ok : s.bad]}>
                  painted: {r.painted} {r.paintedOK ? '✓' : '✗'}
                </Text>
              </View>
            </View>
          ))}
          <Text style={s.summary}>
            {testResults.every((r) => r.bboxOK && r.paintedOK)
              ? 'All 10 assertions pass ✓ — painted-area resolver works against the live parsed graph.'
              : 'Some assertions failed — see above.'}
          </Text>
        </View>
      ) : (
        <Text style={s.p}>Waiting for graph to parse…</Text>
      )}

      <View style={s.row}>
        {(['visible-painted', 'bounding-box'] as Mode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            style={[s.chip, mode === m && s.chipActive]}
          >
            <Text style={[s.chipText, mode === m && s.chipTextActive]}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={s.note}>
        Last hit: <Text style={s.code}>{lastTap}</Text>
      </Text>

      <View style={s.canvas}>
        <VexelView
          source={SVG}
          fit="contain"
          padding={16}
          hitTestMode={mode}
          hitTestTolerance={6}
          highlight="single"
          onElementPress={(id) => setLastTap(id)}
          onLoad={(g) => {
            setGraph(g);
            console.log(`shapes=${g.shapes.size} mode=${mode}`);
          }}
          style={{ flex: 1 }}
        />
      </View>

      <Text style={s.guide}>
        Try tapping the **top-right empty corner** above the diagonal arrow.
        {'\n'}• In bounding-box mode → "diagonal-arrow" registers (wrong!)
        {'\n'}• In visible-painted mode → no hit registers, last hit stays unchanged
      </Text>

      <Pressable
        onPress={runTests}
        style={[s.runButton, !graph && { opacity: 0.4 }]}
        disabled={!graph}
      >
        <Text style={s.runButtonText}>Re-run synthetic taps</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  h2: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  p: { fontSize: 12, color: '#475569', lineHeight: 18 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: '#0f172a' },
  chipText: { color: '#0f172a', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#f8fafc' },
  note: { fontSize: 12, color: '#0f172a' },
  code: { fontFamily: 'Menlo', fontSize: 11, color: '#0f172a' },
  canvas: {
    height: 320,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  guide: { fontSize: 11, color: '#64748b', lineHeight: 17 },
  runButton: {
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  runButtonText: { color: '#f8fafc', fontSize: 12, fontWeight: '600' },
  results: { gap: 6, marginTop: 4 },
  resultsHeader: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  resultRow: { gap: 3 },
  resultLabel: { fontSize: 11, color: '#475569', fontFamily: 'Menlo' },
  resultLine: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  resultTag: {
    fontSize: 10,
    fontFamily: 'Menlo',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ok: { backgroundColor: '#d1fae5', color: '#065f46' },
  bad: { backgroundColor: '#fee2e2', color: '#991b1b' },
  summary: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 4,
  },
});
