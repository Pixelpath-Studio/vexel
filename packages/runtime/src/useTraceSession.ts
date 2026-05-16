import { useEffect, useMemo, useRef } from 'react';
import NativeTrace from './native/NativeTrace';
import type { FragmentAnim, TraceSession, ViewBox, Backpressure } from './types';

interface UseTraceSessionOptions {
  viewBox: ViewBox;
  backpressure?: Backpressure;
}

const EASING_CODE: Record<string, number> = {
  linear: 0,
  'ease-out': 1,
  'ease-in-out': 2,
  'hand-natural': 3,
};

/**
 * React hook that returns a TraceSession backed by the Rust core's `Session`.
 *
 * The Rust session itself runs on the native side. The hook's job is to
 * (a) own the lifecycle (create/release), (b) expose the JS-side mutation
 * API, and (c) notify subscribers (TraceView) on every mutation so the view
 * re-snapshots.
 *
 * Per SPEC §7.3, the identity-to-handle map lives on the JS thread; this
 * session merely brokers fragment text and animation parameters.
 */
export function useTraceSession(opts: UseTraceSessionOptions): TraceSession {
  const handleRef = useRef<number | null>(null);
  const listenersRef = useRef<Set<() => void>>(new Set());

  if (handleRef.current == null) {
    if (!NativeTrace) {
      throw new Error('@trace/runtime: native module not registered.');
    }
    handleRef.current = NativeTrace.createSession(
      opts.viewBox[0], opts.viewBox[1], opts.viewBox[2], opts.viewBox[3],
    );
  }

  useEffect(() => {
    return () => {
      if (handleRef.current != null) {
        NativeTrace?.sessionRelease(handleRef.current);
        handleRef.current = null;
      }
    };
  }, []);

  return useMemo<TraceSession>(() => {
    const notify = () => listenersRef.current.forEach((l) => l());

    return {
      append(svgFragment, anim) {
        const a: FragmentAnim = anim ?? {};
        const startAfter = a.startAfter ?? 'previous';
        let startAfterCode = 0;
        let startAfterAtMs = 0;
        if (startAfter === 'immediately') startAfterCode = 0;
        else if (startAfter === 'previous') startAfterCode = 1;
        else { startAfterCode = 2; startAfterAtMs = startAfter.atMs; }
        const result = NativeTrace!.sessionAppend(
          handleRef.current!,
          svgFragment,
          a.strokeDrawMs ?? 0,
          a.fillFadeMs ?? 0,
          startAfterCode,
          startAfterAtMs,
          EASING_CODE[a.easing ?? 'hand-natural'] ?? 3,
        );
        notify();
        return (JSON.parse(result) as { ids: string[] }).ids;
      },
      remove(id) {
        const ok = NativeTrace!.sessionRemove(handleRef.current!, id);
        if (ok) notify();
        return ok;
      },
      update(_id, _patch) {
        // v1.1: routed via a future sessionUpdate TurboModule method.
        return false;
      },
      ids() {
        // ids are returned from append; for a separate accessor we'd add a
        // sessionIds() TurboModule method. v1 keeps this minimal.
        return [];
      },
      reset() {
        if (handleRef.current != null) {
          NativeTrace?.sessionRelease(handleRef.current);
          handleRef.current = NativeTrace!.createSession(
            opts.viewBox[0], opts.viewBox[1], opts.viewBox[2], opts.viewBox[3],
          );
          notify();
        }
      },
      version() {
        return NativeTrace!.sessionVersion(handleRef.current!);
      },
      _subscribe(listener) {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
    };
  }, [opts.viewBox[0], opts.viewBox[1], opts.viewBox[2], opts.viewBox[3]]);
}
