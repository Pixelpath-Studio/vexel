// Public types for the VexelView library.
//
// This local copy mirrors what `@pixelpath/vexel` will export from
// packages/runtime/src/types.ts once the iOS/Android binaries ship. The shape
// is identical so a one-line import swap is the only change.

import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

// ---------- Highlight ----------

/**
 * Tap behavior:
 *
 *   `'none'`      — purely presentational; taps are ignored.
 *   `'single'`    — tap an element to highlight just that element (default).
 *   `'connected'` — tap an element to highlight it AND every node/edge
 *                   connected to it (1-hop neighborhood, derived from id
 *                   patterns + path geometry).
 *   `'custom'`    — caller supplies a `customResolver` that takes an id and
 *                   the parsed graph, returns the ids that should highlight.
 */
export type HighlightMode = 'none' | 'single' | 'connected' | 'custom';

export interface SelectionState {
  /** Most recently tapped element. */
  id: string;
  /** Every id currently highlighted (includes `id`, plus neighbors per mode). */
  highlightedIds: string[];
  /** Neighborhood breakdown (filled for `connected` / `custom` modes). */
  connectedNodes: string[];
  connectedEdges: string[];
}

export interface HighlightColors {
  selected?: string;
  connectedNode?: string;
  connectedEdge?: string;
}

// ---------- Layout ----------

export type Fit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type Alignment =
  | 'top-left' | 'top' | 'top-right'
  | 'left'     | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

export type Padding = number | { top?: number; right?: number; bottom?: number; left?: number };

// ---------- Source ----------

export interface RemoteSource {
  uri: string;
  expectedSha256?: string;
  headers?: Record<string, string>;
}
export type VexelSource = string | Uint8Array | RemoteSource;

// ---------- Streaming ----------

export type Easing = 'linear' | 'ease-out' | 'ease-in-out' | 'hand-natural';
export type StreamOrder =
  | 'document'
  | 'random'
  | 'topological'
  | ((shapes: IndexedShape[]) => string[]);

// ---------- Interaction ----------

export type SelectionMode = 'single' | 'multiple' | 'toggle';
export type HitTestMode = 'visible-painted' | 'bounding-box' | 'stroke-only' | 'fill-only';

// ---------- Theming ----------

export type Theme = 'light' | 'dark' | 'auto' | ThemeOverrides;
export interface ThemeOverrides {
  background?: string;
  defaultStroke?: string;
  defaultFill?: string;
}

// ---------- Errors ----------

export class VexelError extends Error {
  readonly kind:
    | 'load-failed'
    | 'parse-failed'
    | 'unsupported-version'
    | 'hash-mismatch'
    | 'invalid-source';
  constructor(kind: VexelError['kind'], message: string) {
    super(message);
    this.kind = kind;
    this.name = 'VexelError';
  }
}

// ---------- Plugin / decorator extensibility ----------

export interface DecoratorContext {
  graph: Graph;
  selectedId: string | null;
  highlightedIds: string[];
  /** Current rendering viewport in viewBox-space. */
  viewport: { x: number; y: number; scale: number };
  /** Convert viewBox coordinates → screen (View) coordinates. */
  project: (x: number, y: number) => { x: number; y: number };
  /** Reverse projection. */
  unproject: (x: number, y: number) => { x: number; y: number };
  /** Inspect any shape. */
  shape: (id: string) => IndexedShape | undefined;
  /** Imperatively set the selected element. */
  setSelectedId: (id: string | null) => void;
}

export type VexelDecorator = (ctx: DecoratorContext) => ReactNode;

export interface VexelPluginAPI {
  registerDecorator(decorator: VexelDecorator): void;
  registerSelectionResolver(name: string, resolver: SelectionResolver): void;
  registerCommand(name: string, handler: (...args: any[]) => void): void;
  graph: () => Graph;
  setSelectedId: (id: string | null) => void;
}

export interface VexelPlugin {
  name: string;
  install(api: VexelPluginAPI): void | (() => void);
}

export type SelectionResolver = (id: string, graph: Graph) => string[];

// ---------- Main props ----------

export interface VexelViewProps {
  // -------- SOURCE --------
  source: VexelSource;

  // -------- LAYOUT --------
  fit?: Fit;
  alignment?: Alignment;
  padding?: Padding;

  // -------- INTERACTION --------
  highlight?: HighlightMode;
  customResolver?: SelectionResolver;
  selectionMode?: SelectionMode;
  hitTestMode?: HitTestMode;
  hitTestTolerance?: number;
  gestures?: {
    tap?: boolean;
    longPress?: boolean;
    hover?: boolean;
  };
  longPressDelayMs?: number;
  onElementPress?: (id: string, point: { x: number; y: number }) => void;
  onElementLongPress?: (id: string) => void;
  onSelectionChange?: (selection: SelectionState | null) => void;

  // -------- THEMING --------
  colors?: HighlightColors & {
    byId?: Record<string, { fill?: string; stroke?: string }>;
    byClass?: Record<string, { fill?: string; stroke?: string }>;
  };
  theme?: Theme;
  colorFilter?: (originalColor: string, ctx: { id?: string; kind: ShapeKind; attr: 'fill' | 'stroke' }) => string;

  // -------- STREAMING --------
  streamReveal?: boolean;
  streamElementMs?: number;
  streamPauseMs?: number;
  streamEasing?: Easing;
  streamSpeed?: number;
  streamOrder?: StreamOrder;
  loop?: boolean;
  onStreamProgress?: (progress: number) => void;
  onStreamComplete?: () => void;

  // -------- ACCESSIBILITY --------
  accessibilityLabel?: string;
  accessibilityHint?: string;
  resolveAccessibilityLabel?: (id: string, shape: IndexedShape) => string;
  focusOrder?: string[] | ((graph: Graph) => string[]);
  respectReducedMotion?: boolean;

  // -------- ZOOM / PAN --------
  zoom?: {
    enabled?: boolean;
    min?: number;
    max?: number;
    initial?: number;
    doubleTapToZoom?: boolean;
    fitOnLoad?: boolean;
  };
  pan?: {
    enabled?: boolean;
    bounded?: boolean;
  };
  onZoomChange?: (scale: number) => void;
  onViewportChange?: (viewport: { x: number; y: number; scale: number }) => void;

  // -------- PERFORMANCE --------
  rendering?: {
    batchDecorative?: boolean;
    viewportCulling?: boolean;
    skipText?: boolean;
    interactiveBudget?: number;
  };

  // -------- LIFECYCLE --------
  onLoad?: (graph: Graph) => void;
  onError?: (error: VexelError) => void;

  // -------- PLACEHOLDER / ERROR UI --------
  placeholder?: ReactNode | (() => ReactNode);
  errorFallback?: ReactNode | ((error: VexelError) => ReactNode);

  // -------- EXTENSIBILITY --------
  decorators?: VexelDecorator[];
  plugins?: VexelPlugin[];

  // -------- STANDARD --------
  style?: ViewStyle;
  testID?: string;
}

// ---------- Internal graph types ----------

export type ShapeKind = 'node' | 'edge' | 'note';

export interface IndexedShape {
  id: string;
  kind: ShapeKind;
  bbox?: { minX: number; minY: number; maxX: number; maxY: number };
  endpoints?: { start: [number, number]; end: [number, number] };
  classes?: string[];
}

export interface Graph {
  viewBox: string;
  viewBoxRect: { x: number; y: number; w: number; h: number };
  shapes: Map<string, IndexedShape>;
  adjacency: Map<string, { nodes: string[]; edges: string[] }>;
}

export type RenderStatus = 'selected' | 'connected-node' | 'connected-edge' | 'normal';
