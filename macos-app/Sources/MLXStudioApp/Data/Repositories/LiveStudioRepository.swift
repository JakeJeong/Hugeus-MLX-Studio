import Foundation

// The repository maps app requests into the lower-level transport client.
// If the backend implementation changes later, the domain contract can stay put.
final class LiveStudioRepository: StudioRepository, @unchecked Sendable {
    private let client: StudioAPIClient

    init(client: StudioAPIClient) {
        self.client = client
    }

    func updateBaseURL(_ rawValue: String) throws {
        try client.updateBaseURL(rawValue)
    }

    func fetchStatus() async throws -> StudioStatus {
        try await client.fetchStatus()
    }

    func fetchActivity() async throws -> DownloadActivity {
        try await client.fetchActivity()
    }

    func fetchLocalModels() async throws -> [LocalModel] {
        try await client.fetchLocalModels()
    }

    func fetchGGUFModels() async throws -> [LocalModel] {
        try await client.fetchGGUFModels()
    }

    func searchModels(query: String) async throws -> [RemoteModel] {
        try await client.searchModels(query: query)
    }

    func fetchModelFiles(modelID: String, format: String) async throws -> [RemoteModelFile] {
        try await client.fetchModelFiles(modelID: modelID, format: format)
    }

    func selectModel(_ modelID: String) async throws -> StudioStatus {
        try await client.selectModel(modelID)
    }

    func unloadModel() async throws -> StudioStatus {
        try await client.unloadModel()
    }

    func switchRuntime(_ runtime: String, modelID: String?) async throws -> StudioStatus {
        try await client.switchRuntime(runtime, modelID: modelID)
    }

    func shutdownServer() async throws {
        try await client.shutdownServer()
    }

    func downloadModel(_ modelID: String, format: String, filename: String?) async throws -> DownloadActivity {
        try await client.downloadModel(modelID, format: format, filename: filename)
    }

    func cancelDownload() async throws -> DownloadActivity {
        try await client.cancelDownload()
    }

    func addModelLibrary(path: String) async throws -> StudioStatus {
        try await client.addModelLibrary(path: path)
    }

    func removeModelLibrary(path: String) async throws -> StudioStatus {
        try await client.removeModelLibrary(path: path)
    }

    func uploadCertificate(name: String, pemText: String) async throws -> StudioStatus {
        try await client.uploadCertificate(name: name, pemText: pemText)
    }

    func clearCertificate() async throws -> StudioStatus {
        try await client.clearCertificate()
    }

    func setHubEndpoint(_ endpoint: String) async throws -> StudioStatus {
        try await client.setHubEndpoint(endpoint)
    }

    func saveSettings(_ settings: GenerationSettings) async throws -> StudioStatus {
        try await client.saveSettings(settings)
    }

    func streamChat(
        messages: [ConversationMessage],
        sessionID: String,
        settings: GenerationSettings
    ) throws -> AsyncThrowingStream<ChatStreamEvent, Error> {
        try client.streamChat(messages: messages, sessionID: sessionID, settings: settings)
    }
}
