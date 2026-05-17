// StreamScreen — Phase 4 + existing streaming.
//
// Tests: streamReveal, streamSpeed (0.25x / 0.5x / 1x / 2x / 4x),
// streamEasing (linear / ease-out / ease-in-out / hand-natural),
// streamOrder (document / random / topological), loop, onStreamProgress.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import type { Easing, StreamOrder } from '../vexel-runtime';
import { animalSvg } from '../../assets/animalSvg';

const EASINGS: Easing[] = ['linear', 'ease-out', 'ease-in-out', 'hand-natural'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const ORDERS: StreamOrder[] = ['document', 'random', 'topological'];

export function StreamScreen() {
  const [streaming, setStreaming] = useState(false);
  const [runId, setRunId] = useState(0);
  const [easing, setEasing] = useState<Easing>('hand-natural');
  const [speed, setSpeed] = useState(1);
  const [order, setOrder] = useState<StreamOrder>('document');
  const [loop, setLoop] = useState(false);
  const [progress, setProgress] = useState(0);

  const start = () => {
    setStreaming(false);
    setRunId((n) => n + 1);
    setTimeout(() => setStreaming(true), 16);
  };

  return (
    <View style={styles.root}>
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ paddingBottom: 4 }}>
        <Section title="streamEasing">
          <PillRow value={easing} options={EASINGS} onChange={(v) => setEasing(v as Easing)} />
        </Section>
        <Section title="streamSpeed">
          <PillRow value={`${speed}x`} options={SPEEDS.map((s) => `${s}x`)} onChange={(v) => setSpeed(Number(v.replace('x','')))} />
        </Section>
        <Section title="streamOrder">
          <PillRow value={order as string} options={ORDERS as string[]} onChange={(v) => setOrder(v as StreamOrder)} />
        </Section>
        <Section title="loop">
          <PillRow value={loop ? 'on' : 'off'} options={['off', 'on']} onChange={(v) => setLoop(v === 'on')} />
        </Section>
      </ScrollView>

      <View style={styles.controlRow}>
        <Pressable
          onPress={start}
          disabled={streaming && !loop}
          style={[styles.streamBtn, streaming && !loop && { backgroundColor: '#9ca3af' }]}
        >
          <Text style={styles.streamBtnText}>{streaming ? (loop ? '⟲ Looping' : '◐ Streaming') : '▶ Stream'}</Text>
        </Pressable>
        <Pressable
          onPress={() => { setStreaming(false); setProgress(0); }}
          style={[styles.streamBtn, { backgroundColor: '#374151' }]}
        >
          <Text style={styles.streamBtnText}>■ Stop</Text>
        </Pressable>
      </View>

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.status}>run #{runId} progress {Math.round(progress * 100)}%</Text>

      <View style={styles.canvas}>
        <VexelView
          key={`stream-${runId}`}
          source={animalSvg}
          highlight="connected"
          streamReveal={streaming}
          streamElementMs={700}
          streamPauseMs={120}
          streamEasing={easing}
          streamSpeed={speed}
          streamOrder={order}
          loop={loop}
          onStreamProgress={setProgress}
          onStreamComplete={() => { if (!loop) setStreaming(false); }}
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
  controlRow: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  streamBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#3b82f6' },
  streamBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  progressBar: { height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3b82f6' },
  status: { fontSize: 11, color: '#374151', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, marginVertical: 4 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
});
