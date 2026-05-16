Pod::Spec.new do |s|
  s.name             = 'Trace'
  s.version          = '0.1.0'
  s.summary          = 'Render .trace vector graphics natively on iOS via Skia.'
  s.description      = <<-DESC
    Trace is an open-source binary vector graphics format with a cross-platform
    rendering runtime. This pod provides the native iOS framework. It wraps the
    Rust core (trace-core) for parsing and hit-testing, and renders via Skia
    (provided by the host app's react-native-skia dependency, or via a vendored
    Skia.xcframework for non-RN apps).
  DESC
  s.homepage         = 'https://github.com/curo-trace/trace'
  s.license          = { :type => 'Apache-2.0', :file => '../../LICENSE' }
  s.author           = 'Curo'
  s.source           = { :git => 'https://github.com/curo-trace/trace.git', :tag => "v#{s.version}" }

  s.ios.deployment_target = '14.0'
  s.swift_version = '5.9'

  s.source_files = 'Sources/Trace/**/*.swift'
  s.vendored_frameworks = 'TraceCore.xcframework'

  # When used inside a React Native app, react-native-skia provides Skia.
  # For native-iOS apps, Skia.xcframework must be added to the host project.
  s.weak_frameworks = ['Metal', 'MetalKit', 'QuartzCore']
end
