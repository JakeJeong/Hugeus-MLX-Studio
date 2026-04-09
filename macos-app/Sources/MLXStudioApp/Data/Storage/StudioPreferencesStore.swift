import Foundation

struct StudioPreferences: Sendable {
    let baseURLString: String
    let systemPrompt: String
    let conversationThreads: [ConversationThread]
    let selectedThreadID: UUID?
}

// Preferences stay intentionally small here. Runtime state still lives in the
// backend, while lightweight UI defaults stay local to the macOS shell.
struct StudioPreferencesStore: Sendable {
    private enum Keys {
        static let baseURL = "mlxstudio.macos.baseURL"
        static let systemPrompt = "mlxstudio.macos.systemPrompt"
        static let conversationThreads = "mlxstudio.macos.conversationThreads"
        static let selectedThreadID = "mlxstudio.macos.selectedThreadID"
    }

    func load() -> StudioPreferences {
        StudioPreferences(
            baseURLString: UserDefaults.standard.string(forKey: Keys.baseURL) ?? "http://127.0.0.1:8010",
            systemPrompt: UserDefaults.standard.string(forKey: Keys.systemPrompt)
                ?? "You are a helpful local assistant. Answer clearly and stay concise.",
            conversationThreads: loadConversationThreads(),
            selectedThreadID: UserDefaults.standard.string(forKey: Keys.selectedThreadID).flatMap(UUID.init(uuidString:))
        )
    }

    func save(
        baseURLString: String,
        systemPrompt: String,
        conversationThreads: [ConversationThread],
        selectedThreadID: UUID?
    ) {
        UserDefaults.standard.set(baseURLString, forKey: Keys.baseURL)
        UserDefaults.standard.set(systemPrompt, forKey: Keys.systemPrompt)

        if let data = try? JSONEncoder().encode(conversationThreads) {
            UserDefaults.standard.set(data, forKey: Keys.conversationThreads)
        }

        if let selectedThreadID {
            UserDefaults.standard.set(selectedThreadID.uuidString, forKey: Keys.selectedThreadID)
        } else {
            UserDefaults.standard.removeObject(forKey: Keys.selectedThreadID)
        }
    }

    private func loadConversationThreads() -> [ConversationThread] {
        guard let data = UserDefaults.standard.data(forKey: Keys.conversationThreads) else {
            return []
        }

        return (try? JSONDecoder().decode([ConversationThread].self, from: data)) ?? []
    }
}
