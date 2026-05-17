// VexelView demo app — tabbed navigator across feature phases.
//
// Each tab demos one phase of the library's customization API. As phases land
// they fill in fully; placeholder banners mark the ones still in flight.

import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BasicScreen } from './src/screens/BasicScreen';
import { LayoutScreen } from './src/screens/LayoutScreen';
import { HighlightScreen } from './src/screens/HighlightScreen';
import { StreamScreen } from './src/screens/StreamScreen';
import { ThemeScreen } from './src/screens/ThemeScreen';
import { ZoomScreen } from './src/screens/ZoomScreen';
import { PluginsScreen } from './src/screens/PluginsScreen';
import { A11yScreen } from './src/screens/A11yScreen';
import { PerfScreen } from './src/screens/PerfScreen';
import { CssScreen } from './src/screens/CssScreen';
import { MermaidRealScreen } from './src/screens/MermaidRealScreen';

type Tab =
  | 'Basic'
  | 'Layout'
  | 'Highlight'
  | 'Stream'
  | 'Theme'
  | 'Zoom'
  | 'Plugins'
  | 'A11y'
  | 'Perf'
  | 'CSS'
  | 'Mermaid';

const TABS: Tab[] = ['Basic', 'Layout', 'Highlight', 'Stream', 'Theme', 'Zoom', 'Plugins', 'A11y', 'Perf', 'CSS', 'Mermaid'];

export default function App() {
  const [tab, setTab] = useState<Tab>('Basic');

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.header}>VexelView</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
        style={styles.tabScroll}
      >
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flex: 1 }}>{renderTab(tab)}</View>
    </SafeAreaView>
  );
}

function renderTab(tab: Tab) {
  switch (tab) {
    case 'Basic':     return <BasicScreen />;
    case 'Layout':    return <LayoutScreen />;
    case 'Highlight': return <HighlightScreen />;
    case 'Stream':    return <StreamScreen />;
    case 'Theme':     return <ThemeScreen />;
    case 'Zoom':      return <ZoomScreen />;
    case 'Plugins':   return <PluginsScreen />;
    case 'A11y':      return <A11yScreen />;
    case 'Perf':      return <PerfScreen />;
    case 'CSS':       return <CssScreen />;
    case 'Mermaid':   return <MermaidRealScreen />;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9fafb' },
  header: { fontSize: 22, fontWeight: '700', color: '#111827', paddingHorizontal: 16, paddingTop: 8 },
  tabScroll: { flexGrow: 0, maxHeight: 48 },
  tabRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 6, alignItems: 'center' },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  tabActive: { backgroundColor: '#111827', borderColor: '#111827' },
  tabText: { fontSize: 12, color: '#374151' },
  tabTextActive: { color: '#fff' },
});
