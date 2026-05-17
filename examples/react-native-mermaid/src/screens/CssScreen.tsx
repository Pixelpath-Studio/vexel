// CssScreen — Phase 11 (v0.0.3).
//
// Demonstrates Vexel's CSS support:
//   - <style> blocks with class selectors
//   - @media (prefers-color-scheme) toggled via mediaContext
//   - CSS variables (:root + consumer-provided)
//   - var() / currentColor / !important
//   - :hover via Vexel selection state

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VexelView } from '../vexel-runtime';

type Variant = 'mermaid' | 'vars' | 'media' | 'pseudo';

const MERMAID_SVG = `
<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg">
  <style>
    .node rect { fill: #ECECFF; stroke: #9370DB; stroke-width: 1.5; }
    .node .label { fill: #333; font-size: 14px; }
    .edgePath path { stroke: #555; stroke-width: 1.5; fill: none; }
    .edgeLabel { fill: #555; font-size: 12px; }
  </style>
  <g id="A" class="node">
    <rect x="20" y="80" width="100" height="50" rx="6"/>
    <text class="label" x="70" y="110" text-anchor="middle">Source</text>
  </g>
  <g id="edge-A-B" class="edgePath">
    <path d="M120,105 L240,105"/>
  </g>
  <g id="edge-label" class="edgeLabel">
    <text x="180" y="98" text-anchor="middle">flows to</text>
  </g>
  <g id="B" class="node">
    <rect x="240" y="80" width="100" height="50" rx="6"/>
    <text class="label" x="290" y="110" text-anchor="middle">Sink</text>
  </g>
</svg>`;

const VARS_SVG = `
<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root { --brand: #f59e0b; --brand-dark: #d97706; }
    .box { fill: var(--brand); stroke: var(--brand-dark); stroke-width: 2; }
    .box-fallback { fill: var(--missing, #06b6d4); stroke: var(--brand-dark); stroke-width: 2; }
    .calc-box { fill: var(--brand); stroke-width: calc(1px + 1px); stroke: var(--brand-dark); }
  </style>
  <g id="box1" class="box"><rect x="20" y="40" width="80" height="80" rx="8"/></g>
  <g id="box2" class="box-fallback"><rect x="120" y="40" width="80" height="80" rx="8"/></g>
  <g id="box3" class="calc-box"><rect x="220" y="40" width="80" height="80" rx="8"/></g>
  <g id="lbl1"><text x="60" y="145" text-anchor="middle" font-size="11" fill="#333">var(--brand)</text></g>
  <g id="lbl2"><text x="160" y="145" text-anchor="middle" font-size="11" fill="#333">var(--missing, cyan)</text></g>
  <g id="lbl3"><text x="260" y="145" text-anchor="middle" font-size="11" fill="#333">calc() stroke</text></g>
</svg>`;

const MEDIA_SVG = `
<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <style>
    .panel rect { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.5; }
    .panel .label { fill: #0f172a; font-size: 14px; }
    @media (prefers-color-scheme: dark) {
      .panel rect { fill: #1e293b; stroke: #475569; }
      .panel .label { fill: #f1f5f9; }
    }
  </style>
  <g id="card1" class="panel">
    <rect x="20" y="40" width="120" height="80" rx="10"/>
    <text class="label" x="80" y="85" text-anchor="middle">Card A</text>
  </g>
  <g id="card2" class="panel">
    <rect x="180" y="40" width="120" height="80" rx="10"/>
    <text class="label" x="240" y="85" text-anchor="middle">Card B</text>
  </g>
</svg>`;

const PSEUDO_SVG = `
<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <style>
    .pill rect { fill: #e0e7ff; stroke: #6366f1; stroke-width: 1.5; }
    .pill:hover rect { fill: #6366f1 !important; stroke: #312e81 !important; }
    .pill .label { fill: #312e81; }
    .pill:hover .label { fill: #ffffff !important; }
  </style>
  <g id="p1" class="pill">
    <rect x="20" y="40" width="80" height="40" rx="20"/>
    <text class="label" x="60" y="65" text-anchor="middle" font-size="14">One</text>
  </g>
  <g id="p2" class="pill">
    <rect x="120" y="40" width="80" height="40" rx="20"/>
    <text class="label" x="160" y="65" text-anchor="middle" font-size="14">Two</text>
  </g>
  <g id="p3" class="pill">
    <rect x="220" y="40" width="80" height="40" rx="20"/>
    <text class="label" x="260" y="65" text-anchor="middle" font-size="14">Three</text>
  </g>
  <g><text x="160" y="130" text-anchor="middle" font-size="12" fill="#475569">tap a pill — :hover via Vexel selection state</text></g>
</svg>`;

export function CssScreen() {
  const [variant, setVariant] = useState<Variant>('mermaid');
  const [darkMode, setDarkMode] = useState(false);

  const source = useMemo(() => {
    switch (variant) {
      case 'mermaid': return MERMAID_SVG;
      case 'vars': return VARS_SVG;
      case 'media': return MEDIA_SVG;
      case 'pseudo': return PSEUDO_SVG;
    }
  }, [variant]);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Text style={s.h2}>CSS support (v0.0.3)</Text>
      <Text style={s.p}>
        Vexel parses the SVG's <Text style={s.mono}>{'<style>'}</Text> blocks
        and applies the CSS cascade (selectors, specificity, !important,
        @media, var(), calc(), inheritance). Below: same selectors a browser
        uses, rendered natively via react-native-svg.
      </Text>

      <View style={s.row}>
        {(['mermaid', 'vars', 'media', 'pseudo'] as Variant[]).map((v) => (
          <Pressable
            key={v}
            onPress={() => setVariant(v)}
            style={[s.chip, variant === v && s.chipActive]}
          >
            <Text style={[s.chipText, variant === v && s.chipTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>

      {variant === 'media' ? (
        <View style={s.row}>
          <Pressable
            onPress={() => setDarkMode((d) => !d)}
            style={[s.chip, darkMode && s.chipActive]}
          >
            <Text style={[s.chipText, darkMode && s.chipTextActive]}>
              {darkMode ? 'darkMode: on' : 'darkMode: off'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View
        style={[
          s.canvas,
          variant === 'media' && darkMode ? { backgroundColor: '#0f172a' } : null,
        ]}
      >
        <VexelView
          source={source}
          fit="contain"
          padding={12}
          highlight={variant === 'pseudo' ? 'single' : 'none'}
          mediaContext={variant === 'media' ? { darkMode } : undefined}
          onCSSWarning={(w) => console.warn('[Vexel CSS]', w.kind, w.message)}
          style={{ flex: 1 }}
        />
      </View>

      <Text style={s.note}>
        {variant === 'mermaid' &&
          'Classic Mermaid-style stylesheet: .node rect / .edgePath path. No flatten step, no WebView — Vexel resolves the cascade directly.'}
        {variant === 'vars' &&
          ':root variables, var() with fallback, calc(1px + 1px) for stroke-width.'}
        {variant === 'media' &&
          'Toggle to switch prefers-color-scheme. Vexel re-evaluates the @media query and the cards repaint instantly.'}
        {variant === 'pseudo' &&
          ':hover is mapped to Vexel selection — tap a pill to toggle. !important demonstrates the higher cascade tier.'}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  h2: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  p: { fontSize: 13, color: '#475569', lineHeight: 18 },
  mono: { fontFamily: 'Menlo', fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: '#0f172a' },
  chipText: { color: '#0f172a', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#f8fafc' },
  canvas: {
    height: 260,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  note: { fontSize: 12, color: '#64748b', fontStyle: 'italic' },
});
