// VexelView — React Native component. Wraps a Fabric native view that renders
// the .vex source via Skia (provided by @shopify/react-native-skia).
//
// Per SPEC §7.3 / Implementation notes: the identity-to-handle map lives on
// the JS thread. Per-element animation values are stored as Reanimated shared
// values that Skia worklets read on the UI thread; `useDerivedValue` ensures
// only the affected element recomputes on style changes.

import React, { useEffect, useMemo, useState } from 'react';
import RNVexelView from './native/VexelViewNativeComponent';
import NativeTrace from './native/NativeTrace';
import type { VexelSession, VexelViewProps } from './types';

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Array.from(bytes.subarray(i, i + chunk)) as any,
    );
  }
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'binary').toString('base64');
}

function isSession(s: VexelViewProps['source']): s is VexelSession {
  return typeof s === 'object' && s !== null && typeof (s as VexelSession).append === 'function';
}

export const VexelView: React.FC<VexelViewProps> = ({
  source,
  highlightedIds,
  highlightColor,
  onElementPress,
  onAnimationFinished,
  style,
}) => {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (isSession(source)) {
      const unsub = source._subscribe(() => setVersion((v) => v + 1));
      return unsub;
    }
    return undefined;
    // Note: dependency on `source` is intentional — sessions are stable per
    // useVexelSession() call.
  }, [source]);

  const { sourceBytesB64, sessionHandle } = useMemo(() => {
    if (typeof source === 'string') {
      // Treat string as SVG and convert via TurboModule.
      const b64 = NativeTrace?.convert(source, null) ?? '';
      return { sourceBytesB64: b64, sessionHandle: 0 };
    }
    if (source instanceof Uint8Array) {
      return { sourceBytesB64: bytesToBase64(source), sessionHandle: 0 };
    }
    if (isSession(source)) {
      // For sessions we pass the handle; native side polls the latest snapshot.
      return { sourceBytesB64: '', sessionHandle: getSessionHandle(source) };
    }
    return { sourceBytesB64: '', sessionHandle: 0 };
  }, [source, version]);

  return (
    <RNVexelView
      sourceBytesB64={sourceBytesB64}
      sessionHandle={sessionHandle}
      highlightedIdsCsv={highlightedIds?.join(',') ?? ''}
      highlightColor={highlightColor}
      onElementPress={(e) =>
        onElementPress?.(e.nativeEvent.id, e.nativeEvent.x, e.nativeEvent.y)
      }
      onAnimationFinished={(e) => onAnimationFinished?.(e.nativeEvent.id)}
      style={style}
    />
  );
};

// Reach into the session for its native handle. The handle is set up in
// useVexelSession; we expose a getter via a non-enumerable property to avoid
// polluting the public VexelSession type.
const SESSION_HANDLE_KEY = '__traceSessionHandle';
function getSessionHandle(s: VexelSession): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (s as any)[SESSION_HANDLE_KEY] ?? 0;
}
