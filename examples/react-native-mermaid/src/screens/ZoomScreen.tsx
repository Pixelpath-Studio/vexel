// ZoomScreen — Phase 6.
//
// Tests: zoom.enabled / min / max / doubleTapToZoom, pan.enabled / bounded,
// onZoomChange. Pure-RN implementation (Animated + PanResponder), no native
// rebuild needed.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { TraceView } from '../trace-runtime';
import { animalSvg } from '../../assets/animalSvg';

export function ZoomScreen() {
  const [enabled, setEnabled] = useState(true);
  const [panEnabled, setPanEnabled] = useState(true);
  const [bounded, setBounded] = useState(true);
  const [doubleTap, setDoubleTap] = useState(true);
  const [max, setMax] = useState(4);
  const [scale, setScale] = useState(1);

  return (
    <View style={styles.root}>
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ paddingBottom: 4 }}>
        <Row label="zoom.enabled" value={enabled} onValueChange={setEnabled} />
        <Row label="pan.enabled" value={panEnabled} onValueChange={setPanEnabled} />
        <Row label="pan.bounded" value={bounded} onValueChange={setBounded} />
        <Row label="doubleTapToZoom" value={doubleTap} onValueChange={setDoubleTap} />
        <Text style={styles.label}>max scale</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[2, 4, 8].map((m) => (
            <Pressable key={m} onPress={() => setMax(m)} style={[styles.pill, max === m && styles.pillActive]}>
              <Text style={[styles.pillText, max === m && styles.pillTextActive]}>{m}x</Text>
            </Pressable>
          ))}
        </ScrollView>
      </ScrollView>

      <Text style={styles.status}>
        scale: <Text style={{ fontWeight: '700' }}>{scale.toFixed(2)}x</Text>
        {' · '}pinch with 2 fingers · drag with 1 · double-tap to toggle
      </Text>

      <View style={styles.canvas}>
        <TraceView
          source={animalSvg}
          highlight="connected"
          zoom={{
            enabled,
            min: 1,
            max,
            initial: 1,
            doubleTapToZoom: doubleTap,
          }}
          pan={{ enabled: panEnabled, bounded }}
          onZoomChange={setScale}
        />
      </View>

      <Text style={styles.hint}>
        Simulator note: hold Option + drag to simulate two-finger pinch.
        Or test on a real device for natural pinch/pan.
      </Text>
    </View>
  );
}

function Row({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Switch value={value} onValueChange={onValueChange} />
      <Text style={styles.swLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  swLabel: { fontSize: 13, color: '#374151', marginLeft: 6 },
  label: { fontSize: 11, fontWeight: '600', color: '#6b7280', marginTop: 4, marginBottom: 4, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  pillActive: { backgroundColor: '#111827', borderColor: '#111827' },
  pillText: { fontSize: 12, color: '#374151' },
  pillTextActive: { color: '#fff' },
  status: { fontSize: 11, color: '#374151', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginVertical: 6 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 8 },
});
