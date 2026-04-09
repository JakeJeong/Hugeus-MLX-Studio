import Foundation

enum ManagedStudioRuntimeControllerError: LocalizedError {
    case repositoryRootNotFound
    case failedToInspectPort(Int)
    case failedToTerminatePort(Int)

    var errorDescription: String? {
        switch self {
        case .repositoryRootNotFound:
            return "Could not locate the Hugeus-MLX-Studio repository root."
        case let .failedToInspectPort(port):
            return "Could not inspect which process is using port \(port)."
        case let .failedToTerminatePort(port):
            return "Could not stop the process using port \(port)."
        }
    }
}

// This controller owns the local backend process. The rest of the app only
// sees lifecycle methods and log lines through the domain protocol.
final class ManagedStudioRuntimeController: ManagedRuntimeControlling, @unchecked Sendable {
    private let bundledRuntimeFolderName = "MLXStudioRuntime"
    private let writableRuntimeRelativePath = "MLX Studio/Runtime"
    private var process: Process?
    private var pipes: [Pipe] = []
    private var logHandler: (@Sendable (String) -> Void)?

    var isRunning: Bool {
        process?.isRunning == true
    }

    func setLogHandler(_ handler: @escaping @Sendable (String) -> Void) {
        logHandler = handler
    }

    func startServer(port: Int) throws {
        guard process?.isRunning != true else {
            emit("Backend is already running.")
            return
        }

        let rootURL = try resolveRuntimeRoot()
        let process = Process()
        process.currentDirectoryURL = rootURL
        process.executableURL = rootURL.appendingPathComponent("scripts/ui.sh")
        process.arguments = ["--port", "\(port)"]

        var environment = ProcessInfo.processInfo.environment
        environment["PYTHONUNBUFFERED"] = "1"
        let defaultPATH = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        environment["PATH"] = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/Library/Frameworks/Python.framework/Versions/3.13/bin",
            "/Library/Frameworks/Python.framework/Versions/3.12/bin",
            "/Library/Frameworks/Python.framework/Versions/3.11/bin",
            "/Library/Frameworks/Python.framework/Versions/3.10/bin",
            defaultPATH,
        ].joined(separator: ":")
        process.environment = environment

        let stdout = Pipe()
        let stderr = Pipe()
        pipes = [stdout, stderr]
        process.standardOutput = stdout
        process.standardError = stderr

        attach(pipe: stdout)
        attach(pipe: stderr)

        process.terminationHandler = { [weak self] task in
            self?.emit("Backend exited with status \(task.terminationStatus).")
            self?.cleanupPipes()
            self?.process = nil
        }

        emit("Starting backend from \(rootURL.path)...")
        try process.run()
        self.process = process
    }

    func stopServer() {
        guard let process else {
            emit("No managed backend process is running.")
            return
        }

        emit("Stopping backend...")
        process.terminate()
        self.process = nil
        cleanupPipes()
    }

    func stopServer(on port: Int) throws {
        if process?.isRunning == true {
            stopServer()
            return
        }

        let pids = try listeningPIDs(on: port)
        guard !pids.isEmpty else {
            emit("No backend process is listening on port \(port).")
            return
        }

        emit("Stopping process on port \(port)...")
        for pid in pids {
            let killProcess = Process()
            killProcess.executableURL = URL(fileURLWithPath: "/bin/kill")
            killProcess.arguments = ["-TERM", pid]
            try killProcess.run()
            killProcess.waitUntilExit()

            if killProcess.terminationStatus != 0 {
                throw ManagedStudioRuntimeControllerError.failedToTerminatePort(port)
            }
        }
    }

    private func attach(pipe: Pipe) {
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            guard let output = String(data: data, encoding: .utf8) else {
                return
            }

            let lines = output
                .split(separator: "\n", omittingEmptySubsequences: false)
                .map(String.init)
                .filter { !$0.isEmpty }

            for line in lines {
                self?.emit(line)
            }
        }
    }

    private func cleanupPipes() {
        pipes.forEach { pipe in
            pipe.fileHandleForReading.readabilityHandler = nil
        }
        pipes = []
    }

    private func emit(_ line: String) {
        logHandler?(line)
    }

    private func listeningPIDs(on port: Int) throws -> [String] {
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-ti", "tcp:\(port)", "-sTCP:LISTEN"]
        process.standardOutput = output
        process.standardError = Pipe()

        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0 || process.terminationStatus == 1 else {
            throw ManagedStudioRuntimeControllerError.failedToInspectPort(port)
        }

        let data = output.fileHandleForReading.readDataToEndOfFile()
        let raw = String(data: data, encoding: .utf8) ?? ""
        return raw
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func resolveRuntimeRoot() throws -> URL {
        if let bundledRoot = bundledRuntimeRoot() {
            return try prepareBundledRuntime(from: bundledRoot)
        }
        return try locateRepositoryRoot()
    }

    private func bundledRuntimeRoot() -> URL? {
        guard let resourcesURL = Bundle.main.resourceURL else {
            return nil
        }

        let candidate = resourcesURL.appendingPathComponent(bundledRuntimeFolderName, isDirectory: true)
        let fileManager = FileManager.default
        let scriptPath = candidate.appendingPathComponent("scripts/ui.sh").path
        let backendPath = candidate.appendingPathComponent("backend/server.py").path

        guard fileManager.fileExists(atPath: scriptPath), fileManager.fileExists(atPath: backendPath) else {
            return nil
        }

        return candidate
    }

    private func prepareBundledRuntime(from bundledRoot: URL) throws -> URL {
        let fileManager = FileManager.default
        let appSupportURL = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let writableRoot = appSupportURL.appendingPathComponent(writableRuntimeRelativePath, isDirectory: true)
        try fileManager.createDirectory(at: writableRoot, withIntermediateDirectories: true)

        // The app bundle is read-only, so backend sources are mirrored into
        // Application Support while the local .venv and settings remain writable.
        for component in ["backend", "frontend", "scripts"] {
            let sourceURL = bundledRoot.appendingPathComponent(component, isDirectory: true)
            let destinationURL = writableRoot.appendingPathComponent(component, isDirectory: true)

            if fileManager.fileExists(atPath: destinationURL.path) {
                try fileManager.removeItem(at: destinationURL)
            }
            try fileManager.copyItem(at: sourceURL, to: destinationURL)
        }

        return writableRoot
    }

    private func locateRepositoryRoot() throws -> URL {
        let fileManager = FileManager.default
        let seeds: [URL] = [
            URL(fileURLWithPath: fileManager.currentDirectoryPath),
            Bundle.main.bundleURL,
            URL(fileURLWithPath: #filePath),
        ]

        for seed in seeds {
            var cursor = seed.hasDirectoryPath ? seed : seed.deletingLastPathComponent()
            while true {
                let scriptPath = cursor.appendingPathComponent("scripts/ui.sh").path
                let backendPath = cursor.appendingPathComponent("backend/server.py").path
                if fileManager.fileExists(atPath: scriptPath) && fileManager.fileExists(atPath: backendPath) {
                    return cursor
                }

                let parent = cursor.deletingLastPathComponent()
                if parent.path == cursor.path {
                    break
                }
                cursor = parent
            }
        }

        throw ManagedStudioRuntimeControllerError.repositoryRootNotFound
    }
}
