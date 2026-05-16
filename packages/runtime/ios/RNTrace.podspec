require 'json'

package = JSON.parse(File.read(File.join(__dir__, '../package.json')))

Pod::Spec.new do |s|
  s.name             = '@trace/runtime'
  s.version          = package['version']
  s.summary          = 'Render .trace vector graphics in React Native via Skia.'
  s.license          = 'Apache-2.0'
  s.author           = 'Curo'
  s.homepage         = package['repository']['url']
  s.source           = { :git => package['repository']['url'], :tag => "v#{s.version}" }
  s.ios.deployment_target = '14.0'
  s.swift_version    = '5.9'

  s.source_files = '*.swift'
  s.dependency 'Trace', "= #{s.version}"
  s.dependency 'React-Core'
  # react-native-skia provides Skia binaries that Trace.framework links against.
  s.dependency 'react-native-skia'
end
