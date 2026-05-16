// Fabric component spec — codegen input. See SPEC §7.3.
//
// The actual rendering surface is a react-native-skia <Canvas> wrapped by the
// native view manager; this spec declares the JS↔native bridge that TraceView.tsx
// drives.

import type { HostComponent, ViewProps } from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  Int32,
  WithDefault,
  DirectEventHandler,
  Float,
} from 'react-native/Libraries/Types/CodegenTypes';

interface ElementPressEvent {
  id: string;
  x: Float;
  y: Float;
}
interface AnimationFinishedEvent {
  id: string | null;
}

export interface NativeProps extends ViewProps {
  /** Base64-encoded .trace bytes (Fabric strings ferry binary data). */
  sourceBytesB64: string;
  /** Session handle (if `source` was a streaming session). 0 = none. */
  sessionHandle: WithDefault<Int32, 0>;
  highlightedIdsCsv?: string;
  highlightColor?: string;
  highlightStrokeBoost?: WithDefault<Float, 1.5>;
  onElementPress?: DirectEventHandler<ElementPressEvent>;
  onAnimationFinished?: DirectEventHandler<AnimationFinishedEvent>;
}

export default codegenNativeComponent<NativeProps>('TraceView') as HostComponent<NativeProps>;
