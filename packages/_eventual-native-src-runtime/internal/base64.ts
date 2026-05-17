// Bridge-boundary base64. The TurboModule codegen has no Uint8Array support
// yet, so binary payloads ferry as base64 strings. JSI direct bindings
// (introduced in a future spec rev) will bypass this.

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node.js fallback (used by CLI tests).
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
