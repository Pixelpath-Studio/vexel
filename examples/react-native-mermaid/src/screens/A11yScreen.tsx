// A11yScreen — Phase 5.
//
// Tests: accessibilityLabel, accessibilityHint, respectReducedMotion.
// (Per-element resolveAccessibilityLabel + focusOrder are wired in the type
//  surface and will surface in the native runtime where iOS/Android a11y APIs
//  reach individual draw calls — the JS-only preview can't traverse focus
//  inside an SVG primitive.)

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Switch, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';
import { animalSvg } from '../../assets/animalSvg';

export function A11yScreen() {
  const [streaming, setStreaming] = useState(false);
  const [respectRM, setRespectRM] = useState(true);
  const [systemRM, setSystemRM] = useState(false);
  const [hintsOn, setHintsOn] = useState(true);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setSystemRM).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemRM);
    // @ts-ignore
    return () => sub?.remove?.();
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Switch value={hintsOn} onValueChange={setHintsOn} />
        <Text style={styles.swLabel}>a11y label + hint</Text>
      </View>
      <View style={styles.row}>
        <Switch value={respectRM} onValueChange={setRespectRM} />
        <Text style={styles.swLabel}>respectReducedMotion</Text>
      </View>
      <View style={styles.row}>
        <Switch value={streaming} onValueChange={setStreaming} />
        <Text style={styles.swLabel}>streamReveal (toggle to test RM)</Text>
      </View>

      <Text style={styles.status}>
        System Reduce Motion: <Text style={{ fontWeight: '700' }}>{systemRM ? 'ON' : 'OFF'}</Text>
        {' · '}When RM is on AND respectReducedMotion=true, stream skips animation.
      </Text>

      <View style={styles.canvas}>
        <VexelView
          key={`a11y-${streaming}-${respectRM}`}
          source={animalSvg}
          highlight="single"
          accessibilityLabel={hintsOn ? 'Animal classDiagram with 4 classes' : undefined}
          accessibilityHint={hintsOn ? 'Tap any class or edge to see its id' : undefined}
          respectReducedMotion={respectRM}
          streamReveal={streaming}
          streamElementMs={600}
        />
      </View>

      <Text style={styles.hint}>
        To verify on iOS Simulator: Settings → Accessibility → Motion → Reduce Motion.
        With it on, toggle streamReveal — animation is skipped (instant render).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  swLabel: { fontSize: 13, color: '#374151', marginLeft: 6 },
  status: { fontSize: 11, color: '#374151', backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginVertical: 8 },
  canvas: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 8 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 8 },
});
