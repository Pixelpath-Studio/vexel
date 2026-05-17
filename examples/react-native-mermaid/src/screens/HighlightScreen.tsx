// HighlightScreen — Phase 2 + existing highlight modes.
//
// Tests: highlight 'none' | 'single' | 'connected' | 'custom' (BFS resolver),
// selectionMode 'single' | 'multiple' | 'toggle', longPress, onElementPress.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TraceView } from '../trace-runtime';
import type {
  HighlightMode,
  Graph,
  SelectionMode,
  SelectionResolver,
  SelectionState,
} from '../trace-runtime';
import { animalSvg } from '../../assets/animalSvg';

const MODES: HighlightMode[] = ['none', 'single', 'connected', 'custom'];
const SELS: SelectionMode[] = ['single', 'multiple', 'toggle'];

// Walk every transitively reachable id from `start` (BFS over adjacency).
const reachableResolver: SelectionResolver = (start, graph: Graph) => {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    const adj = graph.adjacency.get(n);
    if (adj) {
      for (const x of adj.nodes) queue.push(x);
      for (const x of adj.edges) queue.push(x);
    }
  }
  return Array.from(seen);
};

export function HighlightScreen() {
  const [highlight, setHighlight] = useState<HighlightMode>('connected');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('single');
  const [longPressOn, setLongPressOn] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [longPressLog, setLongPressLog] = useState<string>('—');

  return (
    <View style={styles.root}>
      <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ paddingBottom: 4 }}>
        <Section title="highlight">
          <PillRow value={highlight} options={MODES} onChange={setHighlight as any} />
        </Section>
        <Section title="selectionMode">
          <PillRow value={selectionMode} options={SELS} onChange={setSelectionMode as any} />
        </Section>
        <Section title="gestures.longPress">
          <PillRow value={longPressOn ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setLongPressOn(v === 'on')} />
          <Text style={styles.hint}>longPress fires after 500ms hold. Log → {longPressLog}</Text>
        </Section>
      </ScrollView>

      <Text style={styles.status}>
        {selection
          ? `${selection.id} → ${selection.highlightedIds.length} highlighted (${selection.connectedNodes.length} nodes, ${selection.connectedEdges.length} edges)`
          : `mode=${highlight} sel=${selectionMode} — tap any element`}
      </Text>

      <View style={styles.canvas}>
        <TraceView
          source={animalSvg}
          highlight={highlight}
          customResolver={highlight === 'custom' ? reachableResolver : undefined}
          selectionMode={selectionMode}
          gestures={{ tap: true, longPress: longPressOn }}
          onElementLongPress={(id) => setLongPressLog(`${id} @ ${new Date().toLocaleTimeString()}`)}
          onSelectionChange={setSelection}
        />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function PillRow({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.pill, value === o && styles.pillActive]}>
          <Text style={[styles.pillText, value === o && styles.pillTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginBottom: 5, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 12, color: '#374151' },
  pillTextActive: { color: '#fff' },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  status: { fontSize: 11, color: '#374151', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginVertical: 6 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
});
