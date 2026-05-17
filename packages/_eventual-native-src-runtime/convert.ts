// SVG → .vex conversion entry point. Synchronous via TurboModule.
import NativeTrace from './native/NativeTrace';
import type { ConvertOptions } from './types';
import { base64ToBytes } from './internal/base64';

export function convert(svg: string, opts: ConvertOptions = {}): Uint8Array {
  if (!NativeTrace) {
    throw new Error('@pixelpath/vexel: TurboModule RNTrace not registered. ' +
      'Did you forget to rebuild the native app after install?');
  }
  const b64 = NativeTrace.convert(svg, opts.generator ?? null);
  return base64ToBytes(b64);
}

export function inspect(bytes: Uint8Array): {
  viewBox: [number, number, number, number];
  ids: string[];
  metadata: Record<string, string>;
} {
  if (!NativeTrace) throw new Error('@pixelpath/vexel: TurboModule not registered.');
  const b64 = bytesToBase64(bytes);
  return JSON.parse(NativeTrace.inspect(b64));
}

function bytesToBase64(bytes: Uint8Array): string {
  // Browser-free base64 encoder for the bridge boundary.
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
