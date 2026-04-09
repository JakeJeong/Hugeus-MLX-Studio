import Foundation

// The native shell controls a local backend process, but the presentation layer
// only needs a small lifecycle surface.
protocol ManagedRuntimeControlling: Sendable {
    var isRunning: Bool { get }
    func setLogHandler(_ handler: @escaping @Sendable (String) -> Void)
    func startServer(port: Int) throws
    func stopServer()
    func stopServer(on port: Int) throws
}
