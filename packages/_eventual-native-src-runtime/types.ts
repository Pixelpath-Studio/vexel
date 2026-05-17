// Public type surface for @pixelpath/vexel — SPEC §7.2.

import type { ViewStyle } from 'react-native';

export type ViewBox = [x: number, y: number, w: number, h: number];

export type Easing = 'linear' | 'ease-out' | 'ease-in-out' | 'hand-natural';

export interface FragmentAnim {
  strokeDrawMs?: number;
  fillFadeMs?: number;
  startAfter?: 'immediately' | 'previous' | { atMs: number };
  easing?: Easing;
}

export interface ElementPatch {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export type ConvertOptions = {
  generator?: string;
  normalizeMermaidIds?: boolean;
};

export type Backpressure = 'queue' | 'catchUp' | 'drop';

export interface VexelSession {
  /** Append an SVG fragment and schedule its animations. Returns new ids. */
  append(svgFragment: string, anim?: FragmentAnim): string[];
  /** Remove an element by id. */
  remove(id: string): boolean;
  /** Update an element's paint properties. */
  update(id: string, patch: Partial<ElementPatch>): boolean;
  /** Currently known ids (including Mermaid-normalized short forms). */
  ids(): string[];
  /** Reset to an empty session (preserves viewBox). */
  reset(): void;
  /** Monotonic version counter. Bumped by every mutation. */
  version(): number;
  /** Internal — used by VexelView to subscribe to mutations. */
  _subscribe(listener: () => void): () => void;
}

export interface VexelViewProps {
  source: Uint8Array | string | VexelSession;
  highlightedIds?: string[];
  highlightColor?: string;
  onElementPress?: (id: string, x: number, y: number) => void;
  onAnimationFinished?: (id: string | null) => void;
  style?: ViewStyle;
}
