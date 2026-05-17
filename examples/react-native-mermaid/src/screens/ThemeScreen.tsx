// ThemeScreen — Phase 3.
//
// Tests: colors.byId, colors.byClass, theme (light/dark/auto), colorFilter.

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import type { ShapeKind } from '../vexel-runtime';
import { animalSvg } from '../../assets/animalSvg';

type Mode = 'plain' | 'byId' | 'byClass' | 'invert' | 'monochrome';

const BY_ID = {
  'classGroup-Duck':  { fill: '#fef3c7', stroke: '#d97706' },
  'classGroup-Fish':  { fill: '#dbeafe', stroke: '#1d4ed8' },
  'classGroup-Zebra': { fill: '#fce7f3', stroke: '#be185d' },
};

const BY_CLASS = {
  classGroup: { fill: '#ffe4e6', stroke: '#9f1239' },
  edge:       { stroke: '#0891b2' },
};

const MONOCHROME = (orig: string, ctx: { id?: string; kind: ShapeKind; attr: 'fill' | 'stroke' }) => {
  if (ctx.attr === 'fill' && orig !== 'none' && orig !== 'transparent') return '#f1f5f9';
  return '#0f172a';
};

const INVERT = (orig: string, ctx: { id?: string; kind: ShapeKind; attr: 'fill' | 'stroke' }) => {
  // crude hex inversion
  if (!orig.startsWith('#')) return orig;
  const hex = orig.slice(1);
  const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const num = parseInt(h, 16);
  const inv = 0xffffff - num;
  return `#${inv.toString(16).padStart(6, '0')}`;
};

export function ThemeScreen() {
  const [mode, setMode] = useState<Mode>('plain');

  const colors = useMemo(() => {
    if (mode === 'byId') return { byId: BY_ID };
    if (mode === 'byClass') return { byClass: BY_CLASS };
    return undefined;
  }, [mode]);

  const colorFilter =
    mode === 'monochrome' ? MONOCHROME : mode === 'invert' ? INVERT : undefined;

  return (
    <View style={styles.root}>
      <Text style={styles.label}>theme mode</Text>
      <PillRow value={mode} options={['plain', 'byId', 'byClass', 'invert', 'monochrome']} onChange={(v) => setMode(v as Mode)} />

      <View style={styles.canvas}>
        <VexelView source={animalSvg} highlight="single" colors={colors} colorFilter={colorFilter} />
      </View>

      <Text style={styles.hint}>
        {mode === 'byId' && 'Duck → amber, Fish → blue, Zebra → pink (via colors.byId).'}
        {mode === 'byClass' && 'every classGroup → rose, every edge → cyan (via colors.byClass).'}
        {mode === 'plain' && 'no overrides — original SVG colors.'}
        {mode === 'invert' && 'colorFilter inverts every hex color.'}
        {mode === 'monochrome' && 'colorFilter forces slate-gray monochrome.'}
      </Text>
    </View>
  );
}

function PillRow({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingVertical: 4, alignItems: 'center' }}
      style={{ flexGrow: 0, height: 40 }}
    >
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
  label: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginBottom: 2, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 12, color: '#374151' },
  pillTextActive: { color: '#fff' },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8, marginVertical: 8 },
  hint: { fontSize: 11, color: '#6b7280' },
});
