// @pixelpath/vexel — public surface (v0.x preview, pure-JS via react-native-svg).
//
// v1.0 will swap the rendering surface to Skia (via @shopify/react-native-skia)
// and the hit-test path to the Rust core, without changing the public API
// surface below. Consumers can upgrade transparently.

export { VexelView, buildGraph } from './VexelView';
export { VexelError } from './types';

// Built-in plugins.
export { VexelLegend, VexelTooltip } from './plugins';
export type { VexelLegendOptions, VexelTooltipOptions } from './plugins';
export type {
  // Core
  HighlightMode,
  HighlightColors,
  SelectionState,
  VexelViewProps,
  VexelSource,
  RemoteSource,
  // Layout
  Fit,
  Alignment,
  Padding,
  // Interaction
  SelectionMode,
  HitTestMode,
  // Theming
  Theme,
  ThemeOverrides,
  // Streaming
  Easing,
  StreamOrder,
  // Plugins
  VexelPlugin,
  VexelPluginAPI,
  VexelDecorator,
  DecoratorContext,
  SelectionResolver,
  // Internals exposed for advanced consumers
  Graph,
  IndexedShape,
  ShapeKind,
  RenderStatus,
} from './types';
