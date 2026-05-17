// PluginsScreen — Phase 7.
//
// Tests the plugin architecture by composing the diagram with built-in plugins:
//   - VexelLegend  (overlays a tappable list of ids)
//   - VexelTooltip (pops a label over the selected element)
//
// Both are VexelPlugin factories that register decorators via the plugin API.

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import type { VexelPlugin } from '../vexel-runtime';
import { VexelLegend, VexelTooltip } from '../plugins';
import { animalSvg } from '../../assets/animalSvg';

export function PluginsScreen() {
  const [legendOn, setLegendOn] = useState(true);
  const [tooltipOn, setTooltipOn] = useState(true);
  const [legendPos, setLegendPos] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('top-right');

  const plugins: VexelPlugin[] = useMemo(() => {
    const ps: VexelPlugin[] = [];
    if (legendOn) ps.push(VexelLegend({ position: legendPos, maxHeight: 200 }));
    if (tooltipOn) ps.push(VexelTooltip());
    return ps;
  }, [legendOn, tooltipOn, legendPos]);

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Switch value={legendOn} onValueChange={setLegendOn} />
        <Text style={styles.swLabel}>VexelLegend</Text>
        <Switch value={tooltipOn} onValueChange={setTooltipOn} style={{ marginLeft: 16 }} />
        <Text style={styles.swLabel}>VexelTooltip</Text>
      </View>

      <Text style={styles.subLabel}>legend position</Text>
      <View style={styles.posRow}>
        {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((p) => (
          <Pressable
            key={p}
            onPress={() => setLegendPos(p)}
            style={[styles.pill, legendPos === p && styles.pillActive]}
          >
            <Text style={[styles.pillText, legendPos === p && styles.pillTextActive]}>{p}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.canvas}>
        <VexelView source={animalSvg} highlight="connected" plugins={plugins} />
      </View>

      <Text style={styles.hint}>
        Plugins are VexelPlugin factories. Each registers decorators that get a
        graph + selection + viewBox→screen projector. Tap a row in the legend to
        drive selection imperatively.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  swLabel: { fontSize: 13, color: '#374151', marginLeft: 6 },
  subLabel: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginTop: 4, marginBottom: 4, textTransform: 'uppercase' },
  posRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 11, color: '#374151' },
  pillTextActive: { color: '#fff' },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 8 },
});
