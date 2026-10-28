// swift-tools-version: 5.9

// iPhone app wrapper. Open this folder in Xcode (File > Open… > CourtScout.swiftpm)
// and run it on an iOS Simulator or your iPhone. `AppleProductTypes` exists
// only in Xcode and Swift Playgrounds, so this package does not build with
// `swift build`; all app code lives in ../CourtScoutKit, which does.

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "CourtScout",
    platforms: [
        .iOS("17.0")
    ],
    products: [
        .iOSApplication(
            name: "Court Scout",
            targets: ["AppModule"],
            bundleIdentifier: "com.courtscout.app",
            teamIdentifier: "",
            displayVersion: "0.1",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .calendar),
            accentColor: .presetColor(.blue),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    dependencies: [
        .package(path: "../CourtScoutKit")
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            dependencies: [
                .product(name: "CourtScoutKit", package: "CourtScoutKit")
            ],
            path: "App"
        )
    ]
)
