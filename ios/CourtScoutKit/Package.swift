// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CourtScoutKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CourtScoutKit", targets: ["CourtScoutCore", "CourtScoutUI"]),
        .executable(name: "court-scout-mac", targets: ["CourtScoutMac"]),
        .executable(name: "verify-kit", targets: ["VerifyKit"])
    ],
    dependencies: [
        .package(path: "../CourtScoutModels")
    ],
    targets: [
        .target(
            name: "CourtScoutCore",
            dependencies: [.product(name: "CourtScoutModels", package: "CourtScoutModels")]
        ),
        .target(name: "CourtScoutUI", dependencies: ["CourtScoutCore"]),
        // Runs the iPhone UI in a phone-sized Mac window; needs no Xcode.
        .executableTarget(name: "CourtScoutMac", dependencies: ["CourtScoutUI"]),
        // Checks the API client and offline cache against a running server.
        .executableTarget(name: "VerifyKit", dependencies: ["CourtScoutCore"])
    ]
)
