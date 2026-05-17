// <VexelView> — the public component.
//
// All customization documented in `types.ts`. Source is loaded async (so the
// caller can render a placeholder while it's in flight); when ready, the SVG
// is parsed into a Graph and rendered via react-native-svg primitives.
//
// Identity invariants (mirroring SPEC Implementation notes for the eventual
// native runtime):
//   1. Hit-testing uses the parsed graph + DOM-style hit handlers, never an
//      opaque image. Each addressable <g id="..."> has its own onPress.
//   2. Per-element overrides (highlight color, fill opacity, reveal progress)
//      are applied at render time without mutating the parsed tree.
//   3. The identity-to-handle map lives in this component, in JS — outside
//      any rendering surface's internals.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo, View, Text } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { attrs, buildGraph, children } from './parseSvgGraph';
import { loadSource } from './loadSource';
import { DEFAULT_COLORS, renderDefs, renderGroup, renderShape, type ResolveStyleFn } from './renderer';
import { collectMarkerSpecsFromCss, makeMarkerId, type MarkerSpec } from './arrowMarkers';
import type { EdgeStyle, EdgesConfig } from './types';
import {
  resolveCascade,
  type ElementContext,
  type ParsedStylesheet,
  type ResolveContext,
} from './cssRules';
import { ZoomLayer } from './ZoomLayer';
import type {
  Alignment,
  DecoratorContext,
  Easing,
  Fit,
  Graph,
  HighlightColors,
  IndexedShape,
  Padding,
  RenderStatus,
  StreamOrder,
  VexelDecorator,
  VexelError,
  VexelPluginAPI,
  VexelSource,
  VexelViewProps,
} from './types';

const ALIGNMENT_TO_PAR: Record<Alignment, string> = {
  'top-left': 'xMinYMin',
  top: 'xMidYMin',
  'top-right': 'xMaxYMin',
  left: 'xMinYMid',
  center: 'xMidYMid',
  right: 'xMaxYMid',
  'bottom-left': 'xMinYMax',
  bottom: 'xMidYMax',
  'bottom-right': 'xMaxYMax',
};

export function VexelView(props: VexelViewProps) {
  const {
    source,
    fit = 'contain',
    alignment = 'center',
    padding = 0,
    highlight = 'single',
    customResolver,
    selectionMode = 'single',
    gestures = { tap: true, longPress: false, hover: false },
    longPressDelayMs = 500,
    onElementPress,
    onElementLongPress,
    onSelectionChange,
    colors,
    streamReveal = false,
    streamElementMs = 800,
    streamPauseMs = 80,
    streamEasing = 'hand-natural',
    streamSpeed = 1,
    streamOrder = 'document',
    loop = false,
    onStreamProgress,
    onStreamComplete,
    accessibilityLabel,
    accessibilityHint,
    respectReducedMotion = true,
    onLoad,
    onError,
    placeholder,
    errorFallback,
    decorators,
    plugins,
    zoom,
    pan,
    onZoomChange,
    onViewportChange,
    rendering,
    style,
    testID,
  } = props;

  // Canvas size — used by scale-down to decide whether to up-scale.
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Zoom defaults
  const zoomEnabled = !!zoom?.enabled;
  const zoomMin = zoom?.min ?? 1;
  const zoomMax = zoom?.max ?? 4;
  const zoomInitial = zoom?.initial ?? 1;
  const doubleTapToZoom = zoom?.doubleTapToZoom ?? true;
  const panEnabled = pan?.enabled ?? zoomEnabled;
  const panBounded = pan?.bounded ?? true;

  // ---------- Source loading ----------

  type LoadState =
    | { kind: 'loading' }
    | {
        kind: 'ready';
        tree: any;
        svgRoot: any;
        graph: Graph;
        parsedCss: ParsedStylesheet;
      }
    | { kind: 'error'; error: VexelError };

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setLoadState({ kind: 'loading' });
    (async () => {
      try {
        const text = await loadSource(source);
        const parsed = buildGraph(text);
        if (cancelled) return;
        setLoadState({
          kind: 'ready',
          tree: parsed.tree,
          svgRoot: parsed.svgRoot,
          graph: parsed.graph,
          parsedCss: parsed.parsedCss,
        });
        // Surface CSS warnings + @font-face declarations to the host app.
        if (props.onCSSWarning) {
          for (const w of parsed.parsedCss.warnings) props.onCSSWarning(w);
        }
        if (props.onFontFace && parsed.parsedCss.fontFaces.length) {
          props.onFontFace(parsed.parsedCss.fontFaces);
        }
        onLoad?.(parsed.graph);
      } catch (e: any) {
        if (cancelled) return;
        const err: VexelError =
          e?.name === 'VexelError'
            ? e
            : (Object.assign(new Error(String(e?.message ?? e)), {
                name: 'VexelError',
                kind: 'parse-failed' as const,
              }) as VexelError);
        setLoadState({ kind: 'error', error: err });
        onError?.(err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey(source)]);

  // ---------- Reduced motion (auto-detect) ----------

  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setReduceMotion(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      // @ts-ignore — some RN versions return EmitterSubscription with .remove()
      sub?.remove?.();
    };
  }, []);
  const effectiveStream = streamReveal && !(respectReducedMotion && reduceMotion);

  // ---------- Plugin registry ----------
  //
  // Decorators are tracked in state (not a ref) so registration triggers a
  // re-render of the DecoratorOverlay.

  const [pluginDecorators, setPluginDecorators] = useState<VexelDecorator[]>([]);
  const pluginResolversRef = useRef<Map<string, (id: string, graph: Graph) => string[]>>(new Map());
  const pluginCommandsRef = useRef<Map<string, (...args: any[]) => void>>(new Map());

  // ---------- Selection state ----------

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastTappedRef = useRef<string | null>(null);
  const [lastTapped, setLastTapped] = useState<string | null>(null);

  const setSelectedIdImperative = useCallback((id: string | null) => {
    if (id == null) {
      setSelectedIds(new Set());
      lastTappedRef.current = null;
      setLastTapped(null);
    } else {
      setSelectedIds(new Set([id]));
      lastTappedRef.current = id;
      setLastTapped(id);
    }
  }, []);

  // ---------- Plugin install/teardown ----------

  const pluginsKey = useMemo(() => (plugins ?? []).map((p) => p.name).join('|'), [plugins]);
  useEffect(() => {
    if (loadState.kind !== 'ready' || !plugins?.length) {
      setPluginDecorators([]);
      pluginResolversRef.current = new Map();
      pluginCommandsRef.current = new Map();
      return;
    }
    const collected: VexelDecorator[] = [];
    pluginResolversRef.current = new Map();
    pluginCommandsRef.current = new Map();
    const teardowns: Array<void | (() => void)> = [];
    const api: VexelPluginAPI = {
      registerDecorator: (d) => collected.push(d),
      registerSelectionResolver: (name, r) => pluginResolversRef.current.set(name, r),
      registerCommand: (name, fn) => pluginCommandsRef.current.set(name, fn),
      graph: () => (loadState.kind === 'ready' ? loadState.graph : ({} as Graph)),
      setSelectedId: setSelectedIdImperative,
    };
    for (const p of plugins) teardowns.push(p.install(api));
    setPluginDecorators(collected);
    return () => {
      for (const t of teardowns) typeof t === 'function' && t();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginsKey, loadState.kind]);

  // ---------- Highlight resolution ----------

  const palette: Required<HighlightColors> = {
    selected: colors?.selected ?? DEFAULT_COLORS.selected,
    connectedNode: colors?.connectedNode ?? DEFAULT_COLORS.connectedNode,
    connectedEdge: colors?.connectedEdge ?? DEFAULT_COLORS.connectedEdge,
  };

  const highlightedIds = useMemo(() => {
    if (loadState.kind !== 'ready') return new Set<string>();
    const graph = loadState.graph;
    const out = new Set<string>(selectedIds);
    if (highlight === 'none' || highlight === 'single' || selectedIds.size === 0) return out;
    for (const sel of selectedIds) {
      if (highlight === 'connected') {
        const adj = graph.adjacency.get(sel);
        if (adj) {
          for (const n of adj.nodes) out.add(n);
          for (const e of adj.edges) out.add(e);
        }
      } else if (highlight === 'custom' && customResolver) {
        for (const x of customResolver(sel, graph)) out.add(x);
      }
    }
    return out;
  }, [loadState, selectedIds, highlight, customResolver]);

  const statusOf = useCallback(
    (id: string): RenderStatus => {
      if (loadState.kind !== 'ready') return 'normal';
      if (selectedIds.has(id)) return 'selected';
      if (!highlightedIds.has(id)) return 'normal';
      const target = loadState.graph.shapes.get(id);
      return target?.kind === 'edge' ? 'connected-edge' : 'connected-node';
    },
    [loadState, selectedIds, highlightedIds],
  );

  // ---------- Tap handling ----------

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);

  const handlePress = useCallback(
    (id: string) => {
      if (!gestures.tap) return;
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      onElementPress?.(id, { x: 0, y: 0 });
      if (highlight === 'none') return;
      setSelectedIds((prev) => {
        if (selectionMode === 'single') return new Set([id]);
        if (selectionMode === 'multiple') {
          const next = new Set(prev);
          next.add(id);
          return next;
        }
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastTappedRef.current = id;
      setLastTapped(id);
    },
    [gestures.tap, highlight, selectionMode, onElementPress],
  );

  const handlePressIn = useCallback(
    (id: string) => {
      if (!gestures.longPress) return;
      longPressFiredRef.current = false;
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        onElementLongPress?.(id);
      }, longPressDelayMs);
    },
    [gestures.longPress, longPressDelayMs, onElementLongPress],
  );

  const handlePressOut = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleClearBackground = useCallback(() => {
    if (highlight === 'none') return;
    setSelectedIds(new Set());
    lastTappedRef.current = null;
    setLastTapped(null);
  }, [highlight]);

  // ---------- onSelectionChange ----------

  useEffect(() => {
    if (loadState.kind !== 'ready') return;
    if (!onSelectionChange) return;
    if (selectedIds.size === 0) {
      onSelectionChange(null);
      return;
    }
    const last = lastTappedRef.current ?? Array.from(selectedIds)[0];
    const adj = loadState.graph.adjacency.get(last);
    onSelectionChange({
      id: last,
      highlightedIds: Array.from(highlightedIds),
      connectedNodes: adj?.nodes ?? [],
      connectedEdges: adj?.edges ?? [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, highlightedIds, loadState]);

  // ---------- Streaming ----------

  const orderedIds = useMemo(() => {
    if (loadState.kind !== 'ready') return [] as string[];
    // graph.shapes is populated by `walk()` in DOM order — the right answer
    // regardless of how deep the `<g id="...">` lives in the tree. Mermaid
    // wraps node groups several levels under `<svg>`, so only checking direct
    // children misses them entirely.
    const docOrder = Array.from(loadState.graph.shapes.keys());
    return applyStreamOrder(docOrder, streamOrder, loadState.graph);
  }, [loadState, streamOrder]);

  const [streamTick, setStreamTick] = useState(0);
  const streamRunIdRef = useRef(0);
  const totalDuration = orderedIds.length * (streamElementMs + streamPauseMs);

  useEffect(() => {
    if (!effectiveStream || loadState.kind !== 'ready') return;
    streamRunIdRef.current += 1;
    const myRunId = streamRunIdRef.current;
    let start: number | null = null;
    let raf = 0;
    const speed = Math.max(0.05, streamSpeed);
    const loopMode = !!loop;
    const tick = (now: number) => {
      if (myRunId !== streamRunIdRef.current) return;
      if (start == null) start = now;
      const elapsedReal = now - start;
      const elapsed = elapsedReal * speed;
      setStreamTick(elapsed);
      onStreamProgress?.(Math.min(1, elapsed / totalDuration));
      if (elapsed < totalDuration) {
        raf = requestAnimationFrame(tick);
      } else if (loopMode) {
        start = now;
        raf = requestAnimationFrame(tick);
      } else {
        onStreamComplete?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      streamRunIdRef.current += 1;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveStream, totalDuration, loop, streamSpeed]);

  const revealOf = useCallback(
    (id: string): number => {
      if (!effectiveStream) return 1;
      const idx = orderedIds.indexOf(id);
      if (idx < 0) return 1;
      const startMs = idx * (streamElementMs + streamPauseMs);
      const localT = streamTick - startMs;
      if (localT < 0) return 0;
      if (localT >= streamElementMs) return 1;
      return applyEasing(streamEasing, localT / streamElementMs);
    },
    [effectiveStream, orderedIds, streamElementMs, streamPauseMs, streamEasing, streamTick],
  );

  // ---------- CSS cascade resolver ----------
  //
  // Build a `resolveStyle(elementContext, ancestorStack) -> resolvedProps`
  // closure that the renderer calls per element. The closure captures the
  // parsed CSS rules + current consumer-provided variables + media context +
  // selection state (drives :hover/:focus pseudo-classes). It's memoized on
  // those inputs so a child re-render doesn't burn CPU re-cascading.

  const userCssVariables = props.cssVariables;
  const userMediaContext = props.mediaContext;

  const mediaContextResolved = useMemo<NonNullable<typeof userMediaContext>>(() => {
    return {
      darkMode: userMediaContext?.darkMode ?? false,
      reducedMotion: userMediaContext?.reducedMotion ?? reduceMotion,
      viewportWidth: userMediaContext?.viewportWidth ?? (canvasSize.w || undefined),
      viewportHeight: userMediaContext?.viewportHeight ?? (canvasSize.h || undefined),
    };
  }, [userMediaContext, reduceMotion, canvasSize.w, canvasSize.h]);

  const resolveStyle = useMemo<ResolveStyleFn | undefined>(() => {
    if (loadState.kind !== 'ready') return undefined;
    const parsed = loadState.parsedCss;
    if (parsed.rules.length === 0 && Object.keys(parsed.rootVariables).length === 0) {
      // No CSS at all — skip building the closure to avoid per-element overhead.
      return undefined;
    }
    const variables: Record<string, string> = {
      ...(userCssVariables ?? {}),
      // SVG :root vars win over consumer-provided defaults (matches browser
      // cascade — :root is author-origin, consumer-provided is treated as
      // user-origin defaults).
      ...parsed.rootVariables,
    };
    const ctx: ResolveContext = {
      cssVariables: variables,
      mediaContext: mediaContextResolved,
      selectedIds,
      activeId: lastTapped,
    };

    // No memoization: inherited values vary per render path (same .label
    // class inside .cluster vs inside .panel inherits different colors),
    // so a class+ancestor-signature cache would be incorrect.
    return (
      element: ElementContext,
      ancestors: ElementContext[],
      inherited: Record<string, string>,
    ) => {
      const stack = [...ancestors, element];
      return resolveCascade({
        rules: parsed.rules,
        stack,
        inherited,
        ctx,
      });
    };
  }, [
    loadState,
    userCssVariables,
    mediaContextResolved,
    selectedIds,
    lastTapped,
  ]);

  // ---------- Edge styling ----------
  //
  // Build the per-element `edgeStyleOf(name, id, classes)` closure and the
  // set of unique marker specs (one synthetic <Marker> per shape+color+scale)
  // that needs to land in <Defs>. Both depend only on `edges` + the graph,
  // so they're memoized across re-renders for free.

  const edgesProp = props.edges;

  type EdgeStyleFn = (
    name: string,
    id: string | undefined,
    classes: string[] | undefined,
  ) => EdgeStyle | undefined;
  const edgeStyleOf = useMemo<EdgeStyleFn | undefined>(() => {
    if (!edgesProp) return undefined;
    if (loadState.kind !== 'ready') return undefined;
    const graph = loadState.graph;
    return (name, id, classes) => {
      // Only path/line/polyline are edges-ish. Caller already filters.
      let merged: EdgeStyle | undefined;
      const add = (s: EdgeStyle | undefined) => {
        if (!s) return;
        merged = merged ? { ...merged, ...s } : { ...s };
      };
      add(edgesProp.default);
      if (classes && edgesProp.byClass) {
        for (const c of classes) add(edgesProp.byClass[c]);
      }
      if (id && edgesProp.byId) add(edgesProp.byId[id]);
      if (edgesProp.resolve) {
        const shape = id ? graph.shapes.get(id) : undefined;
        add(edgesProp.resolve(id, shape));
      }
      return merged;
    };
  }, [edgesProp, loadState]);

  const markerSpecs = useMemo<MarkerSpec[]>(() => {
    if (loadState.kind !== 'ready') return [];
    const specs: MarkerSpec[] = [];
    const seen = new Set<string>();
    const push = (spec: MarkerSpec) => {
      const id = makeMarkerId(spec);
      if (!id || seen.has(id)) return;
      seen.add(id);
      specs.push(spec);
    };

    // 1) Imperative — from the `edges` prop.
    const harvest = (style: EdgeStyle | undefined) => {
      if (!style?.arrow) return;
      const color = style.arrowColor ?? style.stroke ?? '#000000';
      const scale = style.arrowScale ?? 1;
      const arrows =
        typeof style.arrow === 'string' || (style.arrow as any).d
          ? { end: style.arrow as any }
          : (style.arrow as { start?: any; end?: any });
      for (const pos of ['start', 'end'] as const) {
        const shape = arrows[pos];
        if (!shape || shape === 'none') continue;
        push({ shape, color, scale });
      }
    };
    if (edgesProp) {
      harvest(edgesProp.default);
      if (edgesProp.byId) for (const s of Object.values(edgesProp.byId)) harvest(s);
      if (edgesProp.byClass) for (const s of Object.values(edgesProp.byClass)) harvest(s);
      if (edgesProp.resolve) {
        for (const [id, shape] of loadState.graph.shapes) {
          harvest(edgesProp.resolve(id, shape));
        }
      }
    }

    // 2) CSS-driven — scan the SVG's <style> block for --vexel-arrow* decls.
    const cssSpecs = collectMarkerSpecsFromCss(
      loadState.parsedCss.rules,
      loadState.parsedCss.rootVariables,
      userCssVariables ?? {},
    );
    for (const s of cssSpecs) push(s);

    return specs;
  }, [edgesProp, loadState, userCssVariables]);

  // ---------- Padding box ----------

  const pad = normalizePadding(padding);

  // ---------- Render ----------

  if (loadState.kind === 'loading') {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center' }, style]} testID={testID}>
        {typeof placeholder === 'function'
          ? placeholder()
          : placeholder ?? <DefaultPlaceholder />}
      </View>
    );
  }
  if (loadState.kind === 'error') {
    return (
      <View
        style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }, style]}
        testID={testID}
      >
        {typeof errorFallback === 'function'
          ? errorFallback(loadState.error)
          : errorFallback ?? <DefaultErrorFallback error={loadState.error} />}
      </View>
    );
  }

  const { svgRoot, graph } = loadState;

  // CSS ancestor seed: the <svg> root is itself the ancestor of every
  // rendered element. Selectors that key off the root (e.g. Mermaid's
  // `#diagram .node rect`) only match if it's in the ancestor stack and
  // its inheritable styles flow into descendants.
  const svgRootAttrs = attrs(svgRoot);
  const svgRootElCtx: ElementContext = {
    tag: 'svg',
    id: svgRootAttrs?.id,
    classes: svgRootAttrs?.class
      ? svgRootAttrs.class.split(/\s+/).filter(Boolean)
      : undefined,
    attributes: svgRootAttrs,
  };
  const svgRootInherited = resolveStyle
    ? resolveStyle(svgRootElCtx, [], {})
    : {};

  // scale-down semantics (matches CSS object-fit:scale-down):
  //   - if content natural size <= canvas → render at natural size (no scale)
  //   - else behave like 'contain' (meet)
  // We approximate "natural size" with the viewBox dimensions and compare
  // against the measured canvas (canvasSize, set onLayout below). When the
  // measurement hasn't arrived yet, default to 'contain'.
  const effectiveFit: Fit =
    fit !== 'scale-down'
      ? fit
      : !canvasSize.w || !canvasSize.h
      ? 'contain'
      : graph.viewBoxRect.w <= canvasSize.w && graph.viewBoxRect.h <= canvasSize.h
      ? 'none'
      : 'contain';

  // For 'none' (no scaling), render the SVG at its natural pixel size and let
  // the parent View clip overflow. preserveAspectRatio='xMinYMin meet' with
  // explicit width/height matches the viewBox does the trick.
  const par =
    effectiveFit === 'fill'
      ? 'none'
      : effectiveFit === 'none'
      ? `${ALIGNMENT_TO_PAR[alignment]} meet`
      : `${ALIGNMENT_TO_PAR[alignment]} ${effectiveFit === 'cover' ? 'slice' : 'meet'}`;

  const svgWidth = effectiveFit === 'none' ? graph.viewBoxRect.w : '100%';
  const svgHeight = effectiveFit === 'none' ? graph.viewBoxRect.h : '100%';

  return (
    <View
      style={[{ flex: 1 }, style]}
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      <View
        style={{
          flex: 1,
          paddingTop: pad.top,
          paddingRight: pad.right,
          paddingBottom: pad.bottom,
          paddingLeft: pad.left,
          overflow: 'hidden',
        }}
        onLayout={(e) =>
          setCanvasSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        <ZoomLayer
          enabled={zoomEnabled}
          panEnabled={panEnabled}
          bounded={panBounded}
          min={zoomMin}
          max={zoomMax}
          initial={zoomInitial}
          doubleTapToZoom={doubleTapToZoom}
          onChange={(s) => {
            onZoomChange?.(s.scale);
            onViewportChange?.(s);
          }}
        >
          <Svg viewBox={graph.viewBox} width={svgWidth} height={svgHeight} preserveAspectRatio={par}>
            {renderDefs(svgRoot, markerSpecs)}
            <Rect
              x={graph.viewBoxRect.x}
              y={graph.viewBoxRect.y}
              width={graph.viewBoxRect.w}
              height={graph.viewBoxRect.h}
              fill="transparent"
              onPress={handleClearBackground}
            />
            {children(svgRoot)
              .filter(([name]) => name !== 'style' && name !== 'defs' && name !== 'title' && name !== 'desc')
              .map(([name, child], i) => {
                const opts = {
                  graph,
                  selectedId: lastTapped,
                  onPress: handlePress,
                  onPressIn: handlePressIn,
                  onPressOut: handlePressOut,
                  colors: palette,
                  customColors: colors,
                  colorFilter: props.colorFilter,
                  statusOf,
                  revealOf,
                  skipText: rendering?.skipText,
                  interactiveBudget: rendering?.interactiveBudget,
                  resolveStyle,
                  edgeStyleOf,
                };
                if (name === 'g') {
                  return renderGroup(child, opts, `top-${i}`, {
                    reveal: 1,
                    ancestors: [svgRootElCtx],
                    cssInherited: svgRootInherited,
                  });
                }
                // Mermaid (and other generators) sometimes emit renderable
                // shapes (<text>, <line>, <path>, <rect>, etc.) as direct
                // children of <svg> with no wrapping <g>. They're real, and
                // must render — skipping them was a v0.0.3 regression.
                return renderShape(name, child, 'normal', 1, `top-${i}`, {
                  colors: palette,
                  ownerId: undefined,
                  ownerClasses: undefined,
                  ownerKind: 'node',
                  customColors: colors,
                  colorFilter: props.colorFilter,
                  resolveStyle,
                  edgeStyleOf,
                  ancestors: [svgRootElCtx],
                  cssInherited: svgRootInherited,
                });
              })}
          </Svg>
        </ZoomLayer>
      </View>
      <DecoratorOverlay
        decorators={[...(decorators ?? []), ...pluginDecorators]}
        graph={graph}
        selectedId={lastTapped}
        highlightedIds={Array.from(highlightedIds)}
        padding={pad}
        setSelectedId={setSelectedIdImperative}
      />
    </View>
  );
}

// ---------- Default placeholder/error ----------

function DefaultPlaceholder() {
  return <Text style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</Text>;
}

function DefaultErrorFallback({ error }: { error: VexelError }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: '#dc2626', fontSize: 14, fontWeight: '600' }}>
        Failed to load diagram
      </Text>
      <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 6, textAlign: 'center' }}>
        {error.kind}: {error.message}
      </Text>
    </View>
  );
}

// ---------- Decorator overlay ----------

function DecoratorOverlay(props: {
  decorators: VexelDecorator[];
  graph: Graph;
  selectedId: string | null;
  highlightedIds: string[];
  padding: { top: number; right: number; bottom: number; left: number };
  setSelectedId: (id: string | null) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  if (props.decorators.length === 0) return null;

  const onLayout = (e: any) => {
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  };

  const vb = props.graph.viewBoxRect;
  const innerW = Math.max(0, size.w - props.padding.left - props.padding.right);
  const innerH = Math.max(0, size.h - props.padding.top - props.padding.bottom);
  const sx = innerW / vb.w;
  const sy = innerH / vb.h;
  const s = Math.min(sx, sy);
  const offsetX = props.padding.left + (innerW - vb.w * s) * 0.5;
  const offsetY = props.padding.top + (innerH - vb.h * s) * 0.5;

  const ctx: DecoratorContext = {
    graph: props.graph,
    selectedId: props.selectedId,
    highlightedIds: props.highlightedIds,
    viewport: { x: 0, y: 0, scale: s },
    project: (x, y) => ({ x: offsetX + (x - vb.x) * s, y: offsetY + (y - vb.y) * s }),
    unproject: (x, y) => ({ x: vb.x + (x - offsetX) / s, y: vb.y + (y - offsetY) / s }),
    shape: (id) => props.graph.shapes.get(id),
    setSelectedId: props.setSelectedId,
  };

  return (
    <View
      onLayout={onLayout}
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {props.decorators.map((d, i) => (
        <React.Fragment key={`dec-${i}`}>{d(ctx)}</React.Fragment>
      ))}
    </View>
  );
}

// ---------- helpers ----------

function sourceKey(source: VexelSource): string {
  if (typeof source === 'string') return `str:${source.length}:${hashCode(source)}`;
  if (source instanceof Uint8Array) return `bin:${source.byteLength}`;
  return `uri:${source.uri}`;
}
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function normalizePadding(p: Padding): { top: number; right: number; bottom: number; left: number } {
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return { top: p.top ?? 0, right: p.right ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0 };
}

function applyStreamOrder(docOrder: string[], order: StreamOrder, graph: Graph): string[] {
  if (typeof order === 'function') {
    const shapes = docOrder.map((id) => graph.shapes.get(id)).filter(Boolean) as IndexedShape[];
    return order(shapes);
  }
  if (order === 'document') return docOrder;
  if (order === 'random') {
    const a = docOrder.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const nodes: string[] = [];
  const edges: string[] = [];
  const notes: string[] = [];
  for (const id of docOrder) {
    const k = graph.shapes.get(id)?.kind;
    if (k === 'edge') edges.push(id);
    else if (k === 'note') notes.push(id);
    else nodes.push(id);
  }
  return [...nodes, ...edges, ...notes];
}

function applyEasing(kind: Easing, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (kind) {
    case 'linear':
      return x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x);
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case 'hand-natural':
      return handNatural(x);
  }
}
const HAND_SAMPLES: [number, number][] = [
  [0.0, 0.0], [0.12, 0.02], [0.4, 0.55], [0.7, 0.92], [1.0, 1.0],
];
function handNatural(x: number): number {
  for (let i = 1; i < HAND_SAMPLES.length; i++) {
    const [x0, y0] = HAND_SAMPLES[i - 1];
    const [x1, y1] = HAND_SAMPLES[i];
    if (x <= x1) {
      const k = (x - x0) / Math.max(x1 - x0, 1e-6);
      return y0 + (y1 - y0) * k;
    }
  }
  return 1;
}

export { buildGraph } from './parseSvgGraph';
export type { Graph, SelectionState, HighlightMode, Easing, VexelPlugin, VexelDecorator } from './types';
