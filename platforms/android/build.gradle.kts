// Android library for Trace.
//
// Build prerequisites (SPEC §13.3):
//   1. Cross-compile trace-core for Android targets via cargo-ndk:
//        cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -t x86 \
//          --release build -p trace-core
//      That writes libtrace_core.so into target/<triple>/release/.
//   2. Run scripts/copy-jni-libs.sh to stage them under src/main/jniLibs/.
//   3. Generate Kotlin bindings:
//        uniffi-bindgen-kotlin crates/trace-core/src/api/api.udl \
//          --out-dir platforms/android/src/main/kotlin/co/trace/generated/
//   4. ./gradlew :trace:assembleRelease
//
// Skia is provided by the host app's react-native-skia dependency, or by
// vendoring Skia.aar for non-RN apps.

plugins {
    id("com.android.library") version "8.5.0"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

android {
    namespace = "co.trace"
    compileSdk = 34
    defaultConfig {
        minSdk = 24  // Vulkan availability + Skia floor.
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    sourceSets {
        getByName("main") {
            kotlin.srcDirs("src/main/kotlin")
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }
    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    // Skia is provided at runtime by the host app's react-native-skia or a
    // vendored Skia.aar — we declare the API surface as compileOnly so this
    // library can be packaged independently.
    compileOnly("io.github.shopify:react-native-skia-android:1.4.2")
    implementation("net.java.dev.jna:jna:5.14.0@aar")  // UniFFI runtime dep
}
