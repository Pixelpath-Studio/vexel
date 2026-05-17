// BasicScreen — minimal TraceView usage. Zero customization beyond a source.
// Proves the smallest meaningful integration shape.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TraceView } from '../trace-runtime';
import { animalSvg } from '../../assets/animalSvg';

export function BasicScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.code}>{`<TraceView source={animalSvg} />`}</Text>
      <View style={styles.canvas}>
        <TraceView source={animalSvg} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 12 },
  code: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: '#1f2937',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 10,
  },
  canvas: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 8,
  },
});
