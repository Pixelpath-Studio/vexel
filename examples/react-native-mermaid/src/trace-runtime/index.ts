// @trace/runtime — public surface (preview JS implementation).

export { TraceView, buildGraph } from './TraceView';
export { TraceError } from './types';
export type {
  // Core
  HighlightMode,
  HighlightColors,
  SelectionState,
  TraceViewProps,
  TraceSource,
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
  TracePlugin,
  TracePluginAPI,
  TraceDecorator,
  DecoratorContext,
  SelectionResolver,
  // Internals exposed for advanced consumers
  Graph,
  IndexedShape,
  ShapeKind,
  RenderStatus,
} from './types';
