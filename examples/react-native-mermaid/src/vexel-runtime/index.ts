// @pixelpath/vexel — public surface (preview JS implementation).

export { VexelView, buildGraph } from './VexelView';
export { VexelError } from './types';
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
