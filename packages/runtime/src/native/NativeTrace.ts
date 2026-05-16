// TurboModule spec — codegen input. See SPEC §7.4.

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Synchronous SVG → .trace bytes. Returns the bytes as base64 (codegen has
   * no Uint8Array support yet; the JSI direct binding bypasses this). */
  convert(svg: string, generator: string | null): string;

  /** Inspect a .trace file without instantiating a view. Returns JSON. */
  inspect(b64: string): string;

  // -------- Session lifecycle --------

  /** Create a streaming session. Returns an opaque session handle. */
  createSession(viewBoxX: number, viewBoxY: number, viewBoxW: number, viewBoxH: number): number;

  /** Append an SVG fragment to a session. Returns JSON-encoded {ids: string[]}. */
  sessionAppend(
    sessionHandle: number,
    svgFragment: string,
    strokeDrawMs: number,
    fillFadeMs: number,
    startAfterCode: number, // 0=immediate, 1=previous, 2=atMs
    startAfterAtMs: number,
    easingCode: number,     // 0=linear..3=hand-natural
  ): string;

  sessionRemove(sessionHandle: number, id: string): boolean;
  sessionSnapshot(sessionHandle: number): string; // base64 .trace bytes
  sessionVersion(sessionHandle: number): number;
  sessionRelease(sessionHandle: number): void;
}

export default TurboModuleRegistry.get<Spec>('RNTrace') as Spec | null;
