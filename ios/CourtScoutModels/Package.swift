// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CourtScoutModels",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CourtScoutModels", targets: ["CourtScoutModels"]),
        .executable(name: "verify-models", targets: ["VerifyModels"])
    ],
    targets: [
        .target(name: "CourtScoutModels"),
        // Same checks as the tests, runnable with only the Command Line Tools.
        .executableTarget(name: "VerifyModels", dependencies: ["CourtScoutModels"]),
        .testTarget(name: "CourtScoutModelsTests", dependencies: ["CourtScoutModels"])
    ]
)
