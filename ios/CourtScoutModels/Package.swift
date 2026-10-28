// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CourtScoutModels",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CourtScoutModels", targets: ["CourtScoutModels"])
    ],
    targets: [
        .target(name: "CourtScoutModels"),
        .testTarget(name: "CourtScoutModelsTests", dependencies: ["CourtScoutModels"])
    ]
)
