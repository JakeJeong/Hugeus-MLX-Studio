import Foundation

enum StudioUseCaseError: LocalizedError {
    case invalidBaseURL(String)
    case unsupportedRemoteGGUFSelection
    case missingRemoteGGUFFilename

    var errorDescription: String? {
        switch self {
        case let .invalidBaseURL(rawValue):
            return "Invalid server URL: \(rawValue)"
        case .unsupportedRemoteGGUFSelection:
            return "GGUF remote file picking is not wired into the native app yet."
        case .missingRemoteGGUFFilename:
            return "Choose a GGUF file before starting the download."
        }
    }
}

struct RefreshStudioSnapshotUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    // This use case is the main read model for the shell. It gathers the data
    // the UI needs in one place and keeps that aggregation out of the ViewModel.
    func execute() async throws -> StudioSnapshot {
        let status = try await repository.fetchStatus()
        let localModels = try await repository.fetchLocalModels()
        let ggufModels = try await repository.fetchGGUFModels()
        let activity = try await repository.fetchActivity()
        return StudioSnapshot(status: status, localModels: localModels, ggufModels: ggufModels, activity: activity)
    }
}

struct RefreshStudioStatusUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func execute() async throws -> (StudioStatus, DownloadActivity) {
        let status = try await repository.fetchStatus()
        let activity = try await repository.fetchActivity()
        return (status, activity)
    }
}

struct ConnectToStudioUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func execute(baseURLString: String) throws {
        try repository.updateBaseURL(baseURLString)
    }
}

struct ManagedServerUseCase: Sendable {
    private let repository: any StudioRepository
    private let runtimeController: any ManagedRuntimeControlling

    init(repository: any StudioRepository, runtimeController: any ManagedRuntimeControlling) {
        self.repository = repository
        self.runtimeController = runtimeController
    }

    func start(baseURLString: String) throws {
        let url = try validatedBaseURL(baseURLString)
        try runtimeController.startServer(port: url.port ?? 8010)
    }

    func stop(baseURLString: String, managedServerRunning: Bool) async throws {
        let url = try validatedBaseURL(baseURLString)
        let port = url.port ?? 8010

        if managedServerRunning {
            runtimeController.stopServer()
            return
        }

        do {
            try await repository.shutdownServer()
        } catch {
            try runtimeController.stopServer(on: port)
        }
    }

    private func validatedBaseURL(_ baseURLString: String) throws -> URL {
        guard let url = URL(string: baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = url.host,
              !host.isEmpty else {
            throw StudioUseCaseError.invalidBaseURL(baseURLString)
        }
        return url
    }
}

struct SearchRemoteModelsUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func execute(query: String) async throws -> [RemoteModel] {
        try await repository.searchModels(query: query)
    }
}

struct ModelCatalogUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    // Runtime switching logic lives here so views do not need to know which
    // backend runtime should handle MLX vs GGUF.
    func load(_ model: LocalModel) async throws -> StudioStatus {
        if model.format?.lowercased() == "gguf", let path = model.path {
            _ = try await repository.switchRuntime("llama_cpp", modelID: path)
            return try await repository.selectModel(path)
        }

        _ = try await repository.switchRuntime("mlx", modelID: model.id)
        return try await repository.selectModel(model.id)
    }

    func unload() async throws -> StudioStatus {
        try await repository.unloadModel()
    }

    func download(_ model: RemoteModel) async throws -> DownloadActivity {
        guard let format = model.format?.lowercased() else {
            throw StudioUseCaseError.unsupportedRemoteGGUFSelection
        }
        guard format == "mlx" else {
            throw StudioUseCaseError.unsupportedRemoteGGUFSelection
        }
        return try await repository.downloadModel(model.id, format: format, filename: nil)
    }

    func fetchGGUFFiles(for modelID: String) async throws -> [RemoteModelFile] {
        try await repository.fetchModelFiles(modelID: modelID, format: "gguf")
    }

    func downloadGGUF(modelID: String, filename: String?) async throws -> DownloadActivity {
        guard let filename, !filename.isEmpty else {
            throw StudioUseCaseError.missingRemoteGGUFFilename
        }
        return try await repository.downloadModel(modelID, format: "gguf", filename: filename)
    }

    func cancelDownload() async throws -> DownloadActivity {
        try await repository.cancelDownload()
    }
}

struct ModelLibraryUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func add(path: String) async throws -> StudioStatus {
        try await repository.addModelLibrary(path: path)
    }

    func remove(path: String) async throws -> StudioStatus {
        try await repository.removeModelLibrary(path: path)
    }
}

struct NetworkTrustUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func importPEM(name: String, content: String) async throws -> StudioStatus {
        try await repository.uploadCertificate(name: name, pemText: content)
    }

    func clearCustomPEM() async throws -> StudioStatus {
        try await repository.clearCertificate()
    }

    func setHubProvider(_ provider: ModelHubProvider) async throws -> StudioStatus {
        try await repository.setHubEndpoint(provider.endpoint)
    }
}

struct GenerationSettingsUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    func save(_ settings: GenerationSettings) async throws -> StudioStatus {
        try await repository.saveSettings(settings)
    }
}

struct ChatSessionUseCase: Sendable {
    private let repository: any StudioRepository

    init(repository: any StudioRepository) {
        self.repository = repository
    }

    // Chat streaming is exposed as an async stream so the ViewModel can update
    // the last assistant bubble token-by-token without caring about NDJSON.
    func streamReply(
        messages: [ConversationMessage],
        sessionID: String,
        settings: GenerationSettings
    ) throws -> AsyncThrowingStream<ChatStreamEvent, Error> {
        try repository.streamChat(messages: messages, sessionID: sessionID, settings: settings)
    }
}
