// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "MLXStudioApp",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(
            name: "MLXStudioApp",
            targets: ["MLXStudioApp"]
        ),
    ],
    targets: [
        .executableTarget(
            name: "MLXStudioApp",
            path: "Sources/MLXStudioApp"
        ),
    ]
)
