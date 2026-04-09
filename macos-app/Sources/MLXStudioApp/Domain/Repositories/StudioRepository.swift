import Foundation

// The domain talks to MLX Studio through this contract instead of reaching
// directly into URLSession or backend-specific payload code.
protocol StudioRepository: Sendable {
    func updateBaseURL(_ rawValue: String) throws
    func fetchStatus() async throws -> StudioStatus
    func fetchActivity() async throws -> DownloadActivity
    func fetchLocalModels() async throws -> [LocalModel]
    func fetchGGUFModels() async throws -> [LocalModel]
    func searchModels(query: String) async throws -> [RemoteModel]
    func fetchModelFiles(modelID: String, format: String) async throws -> [RemoteModelFile]
    func selectModel(_ modelID: String) async throws -> StudioStatus
    func unloadModel() async throws -> StudioStatus
    func switchRuntime(_ runtime: String, modelID: String?) async throws -> StudioStatus
    func shutdownServer() async throws
    func downloadModel(_ modelID: String, format: String, filename: String?) async throws -> DownloadActivity
    func cancelDownload() async throws -> DownloadActivity
    func addModelLibrary(path: String) async throws -> StudioStatus
    func removeModelLibrary(path: String) async throws -> StudioStatus
    func uploadCertificate(name: String, pemText: String) async throws -> StudioStatus
    func clearCertificate() async throws -> StudioStatus
    func setHubEndpoint(_ endpoint: String) async throws -> StudioStatus
    func saveSettings(_ settings: GenerationSettings) async throws -> StudioStatus
    func streamChat(
        messages: [ConversationMessage],
        sessionID: String,
        settings: GenerationSettings
    ) throws -> AsyncThrowingStream<ChatStreamEvent, Error>
}
