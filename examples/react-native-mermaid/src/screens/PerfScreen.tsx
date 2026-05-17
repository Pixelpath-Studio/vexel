// PerfScreen — Phase 8.
//
// Stress-test with synthetic grid SVGs (25 / 100 / 400 / 1000 cells), plus
// live toggles for rendering.skipText and rendering.interactiveBudget so you
// can feel the difference when scaling.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { TraceView } from '../trace-runtime';
import type { Graph } from '../trace-runtime';

const SIZES = [25, 100, 400, 1000];

function generateGridSvg(n: number): string {
  const side = Math.ceil(Math.sqrt(n));
  const cell = 30;
  const margin = 10;
  const w = side * cell + margin * 2;
  const h = side * cell + margin * 2;
  const cells: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / side);
    const c = i % side;
    const x = margin + c * cell;
    const y = margin + r * cell;
    const hue = (i * 7) % 360;
    cells.push(
      `<g id="cell-${i}"><rect x="${x}" y="${y}" width="${cell - 3}" height="${cell - 3}" rx="2" fill="hsl(${hue}, 60%, 88%)" stroke="hsl(${hue}, 60%, 40%)" stroke-width="1"/><text x="${x + cell / 2}" y="${y + cell / 2 + 3}" font-size="9" fill="#111827" text-anchor="middle">${i}</text></g>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${cells.join('')}</svg>`;
}

export function PerfScreen() {
  const [n, setN] = useState(100);
  const svg = useMemo(() => generateGridSvg(n), [n]);
  const [shapeCount, setShapeCount] = useState<number | null>(null);
  const [t0, setT0] = useState<number | null>(Date.now());
  const [parseMs, setParseMs] = useState<number | null>(null);

  const [skipText, setSkipText] = useState(false);
  const [budgetOn, setBudgetOn] = useState(false);
  const budget = budgetOn ? 300 : undefined;

  const handleSize = (s: number) => {
    setN(s);
    setShapeCount(null);
    setParseMs(null);
    setT0(Date.now());
  };

  return (
    <View style={styles.root}>
      <Text style={styles.label}>cell count</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingVertical: 4, alignItems: 'center' }}
        style={{ flexGrow: 0, height: 40 }}
      >
        {SIZES.map((s) => (
          <Pressable key={s} onPress={() => handleSize(s)} style={[styles.pill, n === s && styles.pillActive]}>
            <Text style={[styles.pillText, n === s && styles.pillTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.row}>
        <Switch value={skipText} onValueChange={setSkipText} />
        <Text style={styles.swLabel}>rendering.skipText</Text>
      </View>
      <View style={styles.row}>
        <Switch value={budgetOn} onValueChange={setBudgetOn} />
        <Text style={styles.swLabel}>rendering.interactiveBudget = 300 (drop onPress past 300 shapes)</Text>
      </View>

      <Text style={styles.status}>
        {shapeCount != null
          ? `parsed ${shapeCount} shapes in ~${parseMs ?? '?'}ms · interactive: ${budget == null || shapeCount < budget ? 'yes' : 'no'}`
          : 'loading…'}
      </Text>

      <View style={styles.canvas}>
        <TraceView
          key={`perf-${n}-${skipText}-${budgetOn}`}
          source={svg}
          highlight="single"
          rendering={{ skipText, interactiveBudget: budget }}
          onLoad={(g: Graph) => {
            setShapeCount(g.shapes.size);
            setParseMs(t0 ? Date.now() - t0 : null);
          }}
        />
      </View>

      <Text style={styles.hint}>
        At 1000 cells with text on, scrolling can stutter — that's the per-element React-Native-SVG bridge cost.
        Toggle skipText OR interactiveBudget=300 to see latency drop.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  label: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginBottom: 2, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 12, color: '#374151' },
  pillTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  swLabel: { fontSize: 12, color: '#374151', marginLeft: 6, flexShrink: 1 },
  status: { fontSize: 11, color: '#374151', fontFamily: 'Menlo', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginVertical: 8 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 8 },
});
