// TraceTooltip — built-in plugin.
//
// Pops a tooltip over the currently-selected element, anchored to its bbox.
// Proves decorator coordinate projection (viewBox → screen) works.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TracePlugin } from '../trace-runtime';

export interface TraceTooltipOptions {
  /** Build the tooltip label. Default: just shows the id. */
  label?: (id: string) => string;
  /** Pixel offset above the element. Default 8. */
  offsetY?: number;
}

export function TraceTooltip(options: TraceTooltipOptions = {}): TracePlugin {
  const labelOf = options.label ?? ((id) => id);
  const offsetY = options.offsetY ?? 8;
  return {
    name: 'trace-tooltip',
    install(api) {
      api.registerDecorator((ctx) => {
        if (!ctx.selectedId) return null;
        const shape = ctx.shape(ctx.selectedId);
        if (!shape?.bbox) return null;
        const cx = (shape.bbox.minX + shape.bbox.maxX) / 2;
        const top = shape.bbox.minY;
        const pt = ctx.project(cx, top);
        return (
          <View
            style={[
              styles.tip,
              { left: pt.x - 60, top: pt.y - offsetY - 30, width: 120 },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.tipText} numberOfLines={1}>
              {labelOf(ctx.selectedId)}
            </Text>
            <View style={styles.tipArrow} />
          </View>
        );
      });
    },
  };
}

const styles = StyleSheet.create({
  tip: {
    position: 'absolute',
    backgroundColor: '#111827',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  tipText: { color: '#fff', fontSize: 11, fontFamily: 'Menlo' },
  tipArrow: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#111827',
    position: 'absolute', bottom: -5,
  },
});
