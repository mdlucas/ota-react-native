require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

folly_compiler_flags = "-DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1 -Wno-comma -Wno-shorten-64-to-32"

Pod::Spec.new do |s|
  s.name         = "react-native-ota"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/example/ota-monorepo"
  s.license      = package["license"]
  s.authors      = { "ota" => "ota@example.com" }
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/example/ota-monorepo.git", :tag => "v#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm}"
  s.compiler_flags = folly_compiler_flags + " -DRCT_NEW_ARCH_ENABLED=1"
  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/build/generated/ios\"",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  install_modules_dependencies(s)
end
