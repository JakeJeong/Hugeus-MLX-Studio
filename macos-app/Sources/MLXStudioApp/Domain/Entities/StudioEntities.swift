import Foundation

// Top-level navigation stays in the domain so both the app shell and future
// integrations can talk about the same product sections.
enum AppSection: String, CaseIterable, Identifiable {
    case chat
    case models
    case logs
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat:
            return "Chat"
        case .models:
            return "Models"
        case .logs:
            return "Logs"
        case .settings:
            return "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .chat:
            return "message"
        case .models:
            return "shippingbox"
        case .logs:
            return "terminal"
        case .settings:
            return "slider.horizontal.3"
        }
    }
}

enum BannerKind {
    case info
    case error
}

struct BannerState: Identifiable, Equatable {
    let id = UUID()
    let kind: BannerKind
    let message: String
}

struct RuntimeCapability: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let available: Bool
}

struct ModelAvailability: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let cached: Bool?
    let selected: Bool?
    let loaded: Bool?
}

struct NetworkStatus: Decodable, Hashable, Sendable {
    let customCABundleConfigured: Bool
    let customCABundleName: String?
    let source: String
    let effectiveCABundlePath: String?
    let hubEndpoint: String?
    let hubProvider: String?

    enum CodingKeys: String, CodingKey {
        case customCABundleConfigured = "custom_ca_bundle_configured"
        case customCABundleName = "custom_ca_bundle_name"
        case source
        case effectiveCABundlePath = "effective_ca_bundle_path"
        case hubEndpoint = "hub_endpoint"
        case hubProvider = "hub_provider"
    }
}

enum ModelHubProvider: String, CaseIterable, Identifiable, Sendable {
    case huggingFace = "huggingface"
    case hfMirror = "hf-mirror"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .huggingFace:
            return "Hugging Face"
        case .hfMirror:
            return "HF Mirror"
        }
    }

    var subtitle: String {
        switch self {
        case .huggingFace:
            return "Use the official Hugging Face Hub for remote search and downloads."
        case .hfMirror:
            return "Use hf-mirror.com when the official hub is blocked or too slow."
        }
    }

    var endpoint: String {
        switch self {
        case .huggingFace:
            return "https://huggingface.co"
        case .hfMirror:
            return "https://hf-mirror.com"
        }
    }

    init(providerName: String?) {
        switch providerName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case ModelHubProvider.hfMirror.rawValue:
            self = .hfMirror
        default:
            self = .huggingFace
        }
    }
}

struct LibraryRoot: Decodable, Identifiable, Hashable, Sendable {
    let path: String
    let label: String

    var id: String { path }
}

struct LibraryStatus: Decodable, Hashable, Sendable {
    let customModelRoots: [LibraryRoot]

    enum CodingKeys: String, CodingKey {
        case customModelRoots = "custom_model_roots"
    }
}

// This is the main domain snapshot that the native app uses to render runtime
// state without leaking transport-specific "Response" naming everywhere.
struct StudioStatus: Decodable, Hashable, Sendable {
    let runtime: String
    let runtimes: [RuntimeCapability]
    let modelID: String?
    let loaded: Bool
    let maxTokens: Int
    let temperature: Double
    let topP: Double
    let minP: Double
    let topK: Int
    let repeatPenalty: Double
    let repeatContextSize: Int
    let stopStrings: [String]
    let enableThinking: Bool
    let models: [ModelAvailability]
    let network: NetworkStatus?
    let libraries: LibraryStatus?

    enum CodingKeys: String, CodingKey {
        case runtime
        case runtimes
        case modelID = "model_id"
        case loaded
        case maxTokens = "max_tokens"
        case temperature
        case topP = "top_p"
        case minP = "min_p"
        case topK = "top_k"
        case repeatPenalty = "repeat_penalty"
        case repeatContextSize = "repeat_context_size"
        case stopStrings = "stop_strings"
        case enableThinking = "enable_thinking"
        case models
        case network
        case libraries
    }
}

struct LocalModel: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let path: String?
    let format: String?
    let sizeGB: Double?
    let selected: Bool?
    let loaded: Bool?
    let ready: Bool?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id
        case path
        case format
        case sizeGB = "size_gb"
        case selected
        case loaded
        case ready
        case error
    }
}

struct RemoteModel: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let format: String?
    let downloadable: Bool?
    let cached: Bool?
    let downloads: Int?
    let likes: Int?
    let sizeGB: Double?
    let localCount: Int?
    let localPath: String?

    enum CodingKeys: String, CodingKey {
        case id
        case format
        case downloadable
        case cached
        case downloads
        case likes
        case sizeGB = "size_gb"
        case localCount = "local_count"
        case localPath = "local_path"
    }
}

struct RemoteModelFile: Decodable, Identifiable, Hashable, Sendable {
    let name: String
    let sizeBytes: Int64?
    let sizeGB: Double?

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case sizeBytes = "size_bytes"
        case sizeGB = "size_gb"
    }
}

struct DownloadActivity: Decodable, Hashable, Sendable {
    let active: Bool
    let phase: String?
    let modelID: String?
    let format: String?
    let filename: String?
    let progress: Double?
    let downloadedBytes: Int64?
    let totalBytes: Int64?
    let message: String?

    enum CodingKeys: String, CodingKey {
        case active
        case phase
        case modelID = "model_id"
        case format
        case filename
        case progress
        case downloadedBytes = "downloaded_bytes"
        case totalBytes = "total_bytes"
        case message
    }
}

struct ChatMetrics: Decodable, Hashable, Sendable {
    let ttftMS: Double?
    let decodeTPS: Double?
    let peakMemoryGB: Double?

    enum CodingKeys: String, CodingKey {
        case ttftMS = "ttft_ms"
        case decodeTPS = "decode_tps"
        case peakMemoryGB = "peak_memory_gb"
    }
}

struct StudioSnapshot: Sendable {
    let status: StudioStatus
    let localModels: [LocalModel]
    let ggufModels: [LocalModel]
    let activity: DownloadActivity
}

struct ChatPhase: Equatable, Sendable {
    let phase: String
    let label: String
    let badge: String
}

struct StreamCompletion: Hashable, Sendable {
    let metrics: ChatMetrics?
    let modelID: String?
}

enum ChatStreamEvent: Sendable {
    case status(ChatPhase)
    case delta(String)
    case done(StreamCompletion)
}

enum ConversationRole: String, Codable, Sendable {
    case user
    case assistant
}

struct ConversationMessage: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let role: ConversationRole
    var text: String

    init(id: UUID = UUID(), role: ConversationRole, text: String) {
        self.id = id
        self.role = role
        self.text = text
    }
}

struct ConversationThread: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var sessionID: String
    var messages: [ConversationMessage]
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        sessionID: String = UUID().uuidString,
        messages: [ConversationMessage] = [],
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.sessionID = sessionID
        self.messages = messages
        self.updatedAt = updatedAt
    }

    // Sidebar labels stay derived from the underlying messages so the thread
    // list always reflects what the user actually asked.
    var title: String {
        guard let firstPrompt = messages.first(where: { $0.role == .user })?.text else {
            return "New chat"
        }

        let compact = firstPrompt
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !compact.isEmpty else {
            return "New chat"
        }

        return compact.count > 42 ? String(compact.prefix(42)) + "..." : compact
    }

    var subtitle: String {
        messages.isEmpty ? "No messages yet" : "\(messages.count) messages"
    }
}

struct GenerationSettings: Equatable, Sendable {
    var systemPrompt: String = "You are a helpful local assistant. Answer clearly and stay concise."
    var maxTokens: Int = 512
    var temperature: Double = 0.0
    var topP: Double = 0.95
    var minP: Double = 0.0
    var topK: Int = 40
    var repeatPenalty: Double = 1.05
    var repeatContextSize: Int = 64
    var stopStringsText: String = ""
    var enableThinking: Bool = false

    var stopStrings: [String] {
        stopStringsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    // Backend settings stay the source of truth after a save, so this helper
    // lets the UI rehydrate itself from the latest runtime payload.
    func merged(with status: StudioStatus) -> GenerationSettings {
        var copy = self
        copy.maxTokens = status.maxTokens
        copy.temperature = status.temperature
        copy.topP = status.topP
        copy.minP = status.minP
        copy.topK = status.topK
        copy.repeatPenalty = status.repeatPenalty
        copy.repeatContextSize = status.repeatContextSize
        copy.stopStringsText = status.stopStrings.joined(separator: ", ")
        copy.enableThinking = status.enableThinking
        return copy
    }
}

extension DownloadActivity {
    var progressFraction: Double {
        min(max(progress ?? 0.0, 0.0), 1.0)
    }
}
