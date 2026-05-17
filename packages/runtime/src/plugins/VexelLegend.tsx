// VexelLegend — built-in plugin.
//
// Renders a floating list of every addressable id. Tap an id → that element
// becomes selected (drives the same highlight pipeline as in-canvas taps).
//
// Demonstrates the plugin API:
//   - registers a decorator that reads the graph + position-projector
//   - calls ctx.setSelectedId to drive selection imperatively

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { VexelPlugin } from '../';

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface VexelLegendOptions {
  position?: Position;
  maxHeight?: number;
  title?: string;
}

export function VexelLegend(options: VexelLegendOptions = {}): VexelPlugin {
  const pos = options.position ?? 'top-right';
  const maxHeight = options.maxHeight ?? 220;
  const title = options.title ?? 'Elements';

  return {
    name: `trace-legend@${pos}`,
    install(api) {
      api.registerDecorator((ctx) => {
        const ids = Array.from(ctx.graph.shapes.keys()).sort();
        const placement = positionStyle(pos);
        return (
          <View style={[styles.panel, placement, { maxHeight }]}>
            <Text style={styles.title}>{title} · {ids.length}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {ids.map((id) => {
                const selected = ctx.selectedId === id;
                const highlighted = ctx.highlightedIds.includes(id);
                return (
                  <Pressable key={id} onPress={() => ctx.setSelectedId(id)}>
                    <Text
                      style={[
                        styles.row,
                        highlighted && styles.rowHighlighted,
                        selected && styles.rowSelected,
                      ]}
                    >
                      {id}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        );
      });
    },
  };
}

function positionStyle(p: Position) {
  switch (p) {
    case 'top-left':     return { top: 8,    left: 8 };
    case 'top-right':    return { top: 8,    right: 8 };
    case 'bottom-left':  return { bottom: 8, left: 8 };
    case 'bottom-right': return { bottom: 8, right: 8 };
  }
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 140,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
  },
  title: { fontSize: 10, fontWeight: '700', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' },
  row: { fontSize: 11, color: '#374151', paddingVertical: 3, fontFamily: 'Menlo' },
  rowHighlighted: { color: '#0f172a', backgroundColor: '#dcfce7' },
  rowSelected: { color: '#fff', backgroundColor: '#f59e0b' },
});
