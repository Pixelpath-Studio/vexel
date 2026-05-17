// EdgeStyleScreen — v0.0.7 edge / arrow customization.
//
// Same flowchart fixture, six different `edges` configs. Each chip
// swaps the prop and the diagram repaints instantly.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import type { EdgesConfig } from '../vexel-runtime';
import { FLOWCHART_COMPLEX } from '../fixtures/realMermaid';

type Preset =
  | 'mermaid-default'
  | 'thick-orange'
  | 'dashed-blue-circle'
  | 'thin-dotted-bar'
  | 'rainbow-by-id'
  | 'custom-resolver';

const PRESETS: Record<Preset, EdgesConfig | undefined> = {
  'mermaid-default': undefined,
  'thick-orange': {
    default: {
      stroke: '#f59e0b',
      strokeWidth: 3,
      arrow: 'triangle',
      arrowColor: '#d97706',
      arrowScale: 1.4,
    },
  },
  'dashed-blue-circle': {
    default: {
      stroke: '#3b82f6',
      strokeWidth: 2,
      strokeDasharray: 'dashed',
      arrow: 'circle',
      arrowScale: 1.2,
    },
  },
  'thin-dotted-bar': {
    default: {
      stroke: '#64748b',
      strokeWidth: 1,
      strokeDasharray: 'dotted',
      arrow: 'bar',
      arrowScale: 1,
    },
  },
  'rainbow-by-id': {
    default: { strokeWidth: 2, arrow: 'arrow' },
    byId: {
      'L_A_B_0': { stroke: '#ef4444', arrowColor: '#ef4444' },
      'L_A_C_0': { stroke: '#10b981', arrowColor: '#10b981' },
      'L_C_E_0': { stroke: '#3b82f6', arrowColor: '#3b82f6' },
      'L_C_F_0': { stroke: '#a855f7', arrowColor: '#a855f7' },
      'L_E_G_0': { stroke: '#f59e0b', arrowColor: '#f59e0b' },
    },
  },
  'custom-resolver': {
    // Programmatic: edges whose id contains "G" get a thick orange diamond
    default: { stroke: '#94a3b8', strokeWidth: 1.5, arrow: 'triangle' },
    resolve: (id) => {
      if (!id) return undefined;
      if (id.includes('G_H') || id.includes('H_'))
        return {
          stroke: '#f97316',
          strokeWidth: 3,
          arrow: 'diamond',
          arrowColor: '#c2410c',
          arrowScale: 1.4,
        };
      return undefined;
    },
  },
};

export function EdgeStyleScreen() {
  const [preset, setPreset] = useState<Preset>('mermaid-default');
  const edges = useMemo(() => PRESETS[preset], [preset]);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Text style={s.h2}>Edge & arrow styling (v0.0.7)</Text>
      <Text style={s.p}>
        The `edges` prop layers line + arrow customization on top of the
        SVG's own CSS: `default` for everything, then `byClass`, then
        {'`byId`, then a `resolve(id, shape)` callback for full programmatic '}
        {'control. Eight built-in arrow shapes (triangle, triangle-open, '}
        {'arrow, circle, circle-open, square, diamond, bar) plus any custom '}
        {'`{ d, viewBox }` path.'}
      </Text>

      <View style={s.row}>
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPreset(p)}
            style={[s.chip, preset === p && s.chipActive]}
          >
            <Text style={[s.chipText, preset === p && s.chipTextActive]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.canvas}>
        <VexelView
          source={FLOWCHART_COMPLEX}
          fit="contain"
          padding={16}
          highlight="none"
          edges={edges}
          onLoad={(g) => console.log(`[${preset}] shapes=${g.shapes.size}`)}
          style={{ flex: 1 }}
        />
      </View>

      <Text style={s.note}>
        {preset === 'mermaid-default' && 'No edges prop — Mermaid styles its own edges.'}
        {preset === 'thick-orange' && 'Single default: thick orange line + larger filled triangle.'}
        {preset === 'dashed-blue-circle' && 'Dashed blue line, circle terminator.'}
        {preset === 'thin-dotted-bar' && 'Thin gray dotted line with bar marker (no arrow head).'}
        {preset === 'rainbow-by-id' && 'Each edge id mapped to a different color via byId.'}
        {preset === 'custom-resolver' && 'resolve() applies orange diamond only to edges touching G/H.'}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  h2: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  p: { fontSize: 12, color: '#475569', lineHeight: 18 },
  row: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: '#0f172a' },
  chipText: { color: '#0f172a', fontSize: 11, fontWeight: '600' },
  chipTextActive: { color: '#f8fafc' },
  canvas: {
    height: 380,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  note: { fontSize: 11, color: '#64748b', fontStyle: 'italic' },
});
