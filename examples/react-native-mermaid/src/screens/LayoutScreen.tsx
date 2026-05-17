// LayoutScreen — Phase 1.
//
// Tests:
//   - source types: raw string + base64-decoded Uint8Array + bad SVG (error path)
//   - fit: contain / cover / fill / none / scale-down
//   - alignment: 9-way grid
//   - padding: 0 / 16 / 32
//   - onLoad, onError, placeholder, errorFallback

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import type { Alignment, Fit, Graph, VexelError, VexelSource } from '../vexel-runtime';
import { animalSvg } from '../../assets/animalSvg';

const FITS: Fit[] = ['contain', 'cover', 'fill', 'none', 'scale-down'];
const ALIGNMENTS: Alignment[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right',
];
const PADDINGS = [0, 16, 32];
type SourceMode = 'string' | 'uint8array' | 'error';

export function LayoutScreen() {
  const [fit, setFit] = useState<Fit>('contain');
  const [alignment, setAlignment] = useState<Alignment>('center');
  const [padding, setPadding] = useState(0);
  const [sourceMode, setSourceMode] = useState<SourceMode>('string');
  const [statusLine, setStatusLine] = useState('idle');

  const source: VexelSource = useMemo(() => {
    if (sourceMode === 'string') return animalSvg;
    if (sourceMode === 'uint8array') {
      return new TextEncoder().encode(animalSvg);
    }
    return '<svg this is intentionally malformed';
  }, [sourceMode]);

  return (
    <View style={styles.root}>
      <ScrollView style={{ maxHeight: 230 }} contentContainerStyle={styles.controls}>
        <Section title="source">
          <PillRow value={sourceMode} options={['string', 'uint8array', 'error']} onChange={setSourceMode as any} />
        </Section>
        <Section title="fit">
          <PillRow value={fit} options={FITS} onChange={setFit as any} />
        </Section>
        <Section title="alignment">
          <View style={styles.alignGrid}>
            {ALIGNMENTS.map((a) => (
              <Pressable
                key={a}
                onPress={() => setAlignment(a)}
                style={[styles.alignCell, alignment === a && styles.alignCellActive]}
              >
                <View style={[styles.alignDot, alignment === a && styles.alignDotActive]} />
              </Pressable>
            ))}
          </View>
          <Text style={styles.alignLabel}>{alignment}</Text>
        </Section>
        <Section title="padding">
          <PillRow value={String(padding)} options={PADDINGS.map(String)} onChange={(v) => setPadding(Number(v))} />
        </Section>
      </ScrollView>

      <Text style={styles.status} numberOfLines={1}>{statusLine}</Text>

      <View style={styles.canvas}>
        <VexelView
          key={`${sourceMode}-${fit}-${alignment}-${padding}`}
          source={source}
          fit={fit}
          alignment={alignment}
          padding={padding}
          highlight="none"
          onLoad={(g: Graph) => setStatusLine(`onLoad → ${g.shapes.size} shapes`)}
          onError={(e: VexelError) => setStatusLine(`onError → ${e.kind}: ${e.message.slice(0, 40)}`)}
          placeholder={() => <Text style={{ color: '#9ca3af' }}>parsing…</Text>}
          errorFallback={(e) => (
            <View style={{ alignItems: 'center' }}>
              <Text style={{ color: '#dc2626', fontWeight: '600' }}>custom error UI</Text>
              <Text style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{e.kind}</Text>
            </View>
          )}
          style={{ borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, backgroundColor: '#f8fafc' }}
        />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PillRow({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.pill, value === o && styles.pillActive]}
        >
          <Text style={[styles.pillText, value === o && styles.pillTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  controls: { paddingBottom: 8 },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginBottom: 5, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 12, color: '#374151' },
  pillTextActive: { color: '#fff' },
  alignGrid: { width: 90, gap: 3, flexDirection: 'row', flexWrap: 'wrap' },
  alignCell: {
    width: 28, height: 28, borderRadius: 4, borderWidth: 1, borderColor: '#d1d5db',
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  alignCellActive: { backgroundColor: '#111827', borderColor: '#111827' },
  alignDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9ca3af' },
  alignDotActive: { backgroundColor: '#fff' },
  alignLabel: { fontSize: 11, color: '#6b7280', marginTop: 4 },
  status: { fontSize: 11, color: '#374151', fontFamily: 'Menlo', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#fef3c7', borderRadius: 4, marginVertical: 6 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
});
