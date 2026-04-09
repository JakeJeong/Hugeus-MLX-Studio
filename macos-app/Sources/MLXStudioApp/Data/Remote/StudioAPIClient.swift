import Foundation

enum StudioAPIError: LocalizedError {
    case invalidBaseURL(String)
    case invalidResponse
    case server(String)
    case unexpectedStatus(Int)

    var errorDescription: String? {
        switch self {
        case let .invalidBaseURL(raw):
            return "Invalid server URL: \(raw)"
        case .invalidResponse:
            return "The server returned an unexpected response."
        case let .server(message):
            return message
        case let .unexpectedStatus(code):
            return "The server returned HTTP \(code)."
        }
    }
}

// This is the low-level transport client. It knows HTTP, JSON, and NDJSON
// streaming details, while the repository above it speaks pure domain types.
final class StudioAPIClient: @unchecked Sendable {
    private let encoder = JSONEncoder()
    private(set) var baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func updateBaseURL(_ rawValue: String) throws {
        guard let url = URL(string: rawValue.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme != nil,
              url.host != nil else {
            throw StudioAPIError.invalidBaseURL(rawValue)
        }
        baseURL = url
    }

    func fetchStatus() async throws -> StudioStatus {
        try await request(path: "/api/status")
    }

    func fetchActivity() async throws -> DownloadActivity {
        try await request(path: "/api/activity")
    }

    func fetchLocalModels() async throws -> [LocalModel] {
        let payload: LocalModelsPayload = try await request(path: "/api/models/local")
        return payload.models
    }

    func fetchGGUFModels() async throws -> [LocalModel] {
        let payload: LocalModelsPayload = try await request(path: "/api/models/gguf")
        return payload.models
    }

    func searchModels(query: String) async throws -> [RemoteModel] {
        struct Body: Encodable {
            let query: String
        }

        let payload: SearchResultsPayload = try await request(
            path: "/api/models/search",
            method: "POST",
            body: Body(query: query)
        )
        return payload.results
    }

    func fetchModelFiles(modelID: String, format: String) async throws -> [RemoteModelFile] {
        let encodedModelID = modelID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? modelID
        let encodedFormat = format.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? format
        let payload: RemoteModelFilesPayload = try await request(
            path: "/api/models/files?model_id=\(encodedModelID)&format=\(encodedFormat)"
        )
        return payload.files
    }

    func selectModel(_ modelID: String) async throws -> StudioStatus {
        struct Body: Encodable {
            let modelID: String

            enum CodingKeys: String, CodingKey {
                case modelID = "model_id"
            }
        }

        return try await request(path: "/api/models/select", method: "POST", body: Body(modelID: modelID))
    }

    func unloadModel() async throws -> StudioStatus {
        try await request(path: "/api/models/unload", method: "POST")
    }

    func switchRuntime(_ runtime: String, modelID: String?) async throws -> StudioStatus {
        struct Body: Encodable {
            let runtime: String
            let modelID: String?

            enum CodingKeys: String, CodingKey {
                case runtime
                case modelID = "model_id"
            }
        }

        return try await request(
            path: "/api/runtime",
            method: "POST",
            body: Body(runtime: runtime, modelID: modelID)
        )
    }

    func shutdownServer() async throws {
        struct Payload: Decodable {
            let status: String
        }

        let _: Payload = try await request(path: "/api/runtime/shutdown", method: "POST")
    }

    func downloadModel(_ modelID: String, format: String, filename: String? = nil) async throws -> DownloadActivity {
        struct Body: Encodable {
            let modelID: String
            let format: String
            let filename: String?

            enum CodingKeys: String, CodingKey {
                case modelID = "model_id"
                case format
                case filename
            }
        }

        return try await request(
            path: "/api/models/download",
            method: "POST",
            body: Body(modelID: modelID, format: format, filename: filename)
        )
    }

    func cancelDownload() async throws -> DownloadActivity {
        try await request(path: "/api/models/download/cancel", method: "POST")
    }

    func addModelLibrary(path: String) async throws -> StudioStatus {
        struct Body: Encodable {
            let path: String
        }

        return try await request(path: "/api/model-libraries/add", method: "POST", body: Body(path: path))
    }

    func removeModelLibrary(path: String) async throws -> StudioStatus {
        struct Body: Encodable {
            let path: String
        }

        return try await request(path: "/api/model-libraries/remove", method: "POST", body: Body(path: path))
    }

    func uploadCertificate(name: String, pemText: String) async throws -> StudioStatus {
        struct Body: Encodable {
            let filename: String
            let content: String
        }

        return try await request(
            path: "/api/network/certificate/text",
            method: "POST",
            body: Body(filename: name, content: pemText)
        )
    }

    func clearCertificate() async throws -> StudioStatus {
        try await request(path: "/api/network/certificate/clear", method: "POST")
    }

    func setHubEndpoint(_ endpoint: String) async throws -> StudioStatus {
        struct Body: Encodable {
            let endpoint: String
        }

        return try await request(
            path: "/api/network/hub-endpoint",
            method: "POST",
            body: Body(endpoint: endpoint)
        )
    }

    func saveSettings(_ settings: GenerationSettings) async throws -> StudioStatus {
        struct Body: Encodable {
            let maxTokens: Int
            let temperature: Double
            let topP: Double
            let minP: Double
            let topK: Int
            let repeatPenalty: Double
            let repeatContextSize: Int
            let stopStrings: [String]
            let enableThinking: Bool

            enum CodingKeys: String, CodingKey {
                case maxTokens = "max_tokens"
                case temperature
                case topP = "top_p"
                case minP = "min_p"
                case topK = "top_k"
                case repeatPenalty = "repeat_penalty"
                case repeatContextSize = "repeat_context_size"
                case stopStrings = "stop_strings"
                case enableThinking = "enable_thinking"
            }
        }

        return try await request(
            path: "/api/settings",
            method: "POST",
            body: Body(
                maxTokens: settings.maxTokens,
                temperature: settings.temperature,
                topP: settings.topP,
                minP: settings.minP,
                topK: settings.topK,
                repeatPenalty: settings.repeatPenalty,
                repeatContextSize: settings.repeatContextSize,
                stopStrings: settings.stopStrings,
                enableThinking: settings.enableThinking
            )
        )
    }

    func streamChat(
        messages: [ConversationMessage],
        sessionID: String,
        settings: GenerationSettings
    ) throws -> AsyncThrowingStream<ChatStreamEvent, Error> {
        struct APIMessage: Encodable {
            let role: String
            let content: String
        }

        struct Body: Encodable {
            let messages: [APIMessage]
            let sessionID: String
            let maxTokens: Int
            let temperature: Double
            let topP: Double
            let minP: Double
            let topK: Int
            let repeatPenalty: Double
            let repeatContextSize: Int
            let stopStrings: [String]
            let enableThinking: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case sessionID = "session_id"
                case maxTokens = "max_tokens"
                case temperature
                case topP = "top_p"
                case minP = "min_p"
                case topK = "top_k"
                case repeatPenalty = "repeat_penalty"
                case repeatContextSize = "repeat_context_size"
                case stopStrings = "stop_strings"
                case enableThinking = "enable_thinking"
            }
        }

        var payloadMessages: [APIMessage] = []
        let systemPrompt = settings.systemPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !systemPrompt.isEmpty {
            payloadMessages.append(APIMessage(role: "system", content: systemPrompt))
        }
        payloadMessages.append(contentsOf: messages.map { APIMessage(role: $0.role.rawValue, content: $0.text) })

        let bodyData = try encoder.encode(
            Body(
                messages: payloadMessages,
                sessionID: sessionID,
                maxTokens: settings.maxTokens,
                temperature: settings.temperature,
                topP: settings.topP,
                minP: settings.minP,
                topK: settings.topK,
                repeatPenalty: settings.repeatPenalty,
                repeatContextSize: settings.repeatContextSize,
                stopStrings: settings.stopStrings,
                enableThinking: settings.enableThinking
            )
        )

        var request = URLRequest(url: baseURL.appending(path: "/api/chat/stream"))
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.httpBody = bodyData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let streamRequest = request

        return AsyncThrowingStream { continuation in
            // The stream task lives entirely inside the data layer so the rest
            // of the app never needs to parse NDJSON lines manually.
            let task = Task {
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: streamRequest)
                    guard let http = response as? HTTPURLResponse else {
                        throw StudioAPIError.invalidResponse
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        throw StudioAPIError.unexpectedStatus(http.statusCode)
                    }

                    let decoder = JSONDecoder()
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmed.isEmpty {
                            continue
                        }

                        let payload = try decoder.decode(ChatStreamPayload.self, from: Data(trimmed.utf8))
                        switch payload.type {
                        case "delta":
                            if let text = payload.text, !text.isEmpty {
                                continuation.yield(.delta(text))
                            }
                        case "status":
                            continuation.yield(
                                .status(
                                    ChatPhase(
                                        phase: payload.phase ?? "running",
                                        label: payload.label ?? payload.phase?.capitalized ?? "Running",
                                        badge: payload.badge ?? "Running"
                                    )
                                )
                            )
                        case "done":
                            continuation.yield(
                                .done(
                                    StreamCompletion(
                                        metrics: payload.metrics,
                                        modelID: payload.modelID
                                    )
                                )
                            )
                            continuation.finish()
                            return
                        case "error":
                            throw StudioAPIError.server(payload.message ?? "Streaming request failed")
                        default:
                            continue
                        }
                    }

                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    private func request<T: Decodable>(path: String, method: String = "GET") async throws -> T {
        try await request(path: path, method: method, bodyData: nil)
    }

    private func request<T: Decodable, Body: Encodable>(path: String, method: String, body: Body) async throws -> T {
        let bodyData = try encoder.encode(body)
        return try await request(path: path, method: method, bodyData: bodyData)
    }

    private func request<T: Decodable>(path: String, method: String, bodyData: Data?) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.timeoutInterval = 60
        if let bodyData {
            request.httpBody = bodyData
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw StudioAPIError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            if let message = try? JSONDecoder().decode(ServerErrorPayload.self, from: data).detail {
                throw StudioAPIError.server(message)
            }
            throw StudioAPIError.unexpectedStatus(http.statusCode)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct LocalModelsPayload: Decodable {
    let models: [LocalModel]
}

private struct SearchResultsPayload: Decodable {
    let results: [RemoteModel]
}

private struct RemoteModelFilesPayload: Decodable {
    let files: [RemoteModelFile]
}

private struct ServerErrorPayload: Decodable {
    let detail: String
}

private struct ChatStreamPayload: Decodable {
    let type: String
    let text: String?
    let phase: String?
    let label: String?
    let badge: String?
    let message: String?
    let metrics: ChatMetrics?
    let modelID: String?

    enum CodingKeys: String, CodingKey {
        case type
        case text
        case phase
        case label
        case badge
        case message
        case metrics
        case modelID = "model_id"
    }
}
