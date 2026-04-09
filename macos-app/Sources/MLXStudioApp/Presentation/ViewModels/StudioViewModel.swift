import AppKit
import Foundation
import SwiftUI

@MainActor
final class StudioViewModel: ObservableObject {
    @Published var selectedSection: AppSection? = .chat
    @Published var status: StudioStatus?
    @Published var localModels: [LocalModel] = []
    @Published var ggufModels: [LocalModel] = []
    @Published var remoteModels: [RemoteModel] = []
    @Published var remoteGGUFPickerModel: RemoteModel?
    @Published var remoteGGUFFiles: [RemoteModelFile] = []
    @Published var activity: DownloadActivity?
    @Published var conversationThreads: [ConversationThread] = []
    @Published var selectedThreadID: UUID?
    @Published var composerText = ""
    @Published var searchQuery = ""
    @Published var logText = ""
    @Published var banner: BannerState?
    @Published var isRefreshing = false
    @Published var isSending = false
    @Published var isSearching = false
    @Published var isLoadingRemoteGGUFFiles = false
    @Published var managedServerRunning = false
    @Published var baseURLString: String
    @Published var selectedHubProvider: ModelHubProvider = .huggingFace
    @Published var isUpdatingHubProvider = false
    @Published var generationSettings: GenerationSettings {
        didSet {
            guard !isSynchronizingGenerationSettings else {
                return
            }
            hasUnsavedGenerationChanges = generationSettings != syncedGenerationSettings
        }
    }
    @Published var hasUnsavedGenerationChanges = false
    @Published var requestStateText = "Idle"

    private let preferencesStore: StudioPreferencesStore
    private let connectToStudio: ConnectToStudioUseCase
    private let refreshSnapshot: RefreshStudioSnapshotUseCase
    private let refreshStatus: RefreshStudioStatusUseCase
    private let managedServer: ManagedServerUseCase
    private let searchRemoteModels: SearchRemoteModelsUseCase
    private let modelCatalog: ModelCatalogUseCase
    private let modelLibraries: ModelLibraryUseCase
    private let networkTrust: NetworkTrustUseCase
    private let generationSettingsUseCase: GenerationSettingsUseCase
    private let chatSession: ChatSessionUseCase
    private let runtimeController: any ManagedRuntimeControlling

    private var syncedGenerationSettings: GenerationSettings
    private var isSynchronizingGenerationSettings = false
    private var hasBootstrapped = false
    private var hasHydratedConnectedSnapshot = false
    private var isStartingManagedRuntime = false
    private var isRecoveringManagedRuntime = false
    private var pollTask: Task<Void, Never>?
    private var recoveryTask: Task<Void, Never>?

    init(dependencies: StudioAppDependencies = .live()) {
        let preferences = dependencies.preferencesStore.load()

        self.preferencesStore = dependencies.preferencesStore
        self.connectToStudio = dependencies.connectToStudio
        self.refreshSnapshot = dependencies.refreshSnapshot
        self.refreshStatus = dependencies.refreshStatus
        self.managedServer = dependencies.managedServer
        self.searchRemoteModels = dependencies.searchRemoteModels
        self.modelCatalog = dependencies.modelCatalog
        self.modelLibraries = dependencies.modelLibraries
        self.networkTrust = dependencies.networkTrust
        self.generationSettingsUseCase = dependencies.generationSettings
        self.chatSession = dependencies.chatSession
        self.runtimeController = dependencies.runtimeController

        let initialGenerationSettings = GenerationSettings(systemPrompt: preferences.systemPrompt)
        baseURLString = preferences.baseURLString
        generationSettings = initialGenerationSettings
        syncedGenerationSettings = initialGenerationSettings

        if preferences.conversationThreads.isEmpty {
            let initialThread = ConversationThread()
            conversationThreads = [initialThread]
            selectedThreadID = initialThread.id
        } else {
            conversationThreads = preferences.conversationThreads
                .sorted { $0.updatedAt > $1.updatedAt }
            selectedThreadID =
                preferences.selectedThreadID.flatMap { storedID in
                    conversationThreads.contains(where: { $0.id == storedID }) ? storedID : nil
                } ?? conversationThreads.first?.id
        }

        // Runtime logs feed directly into the view model so the app can surface
        // backend failures without forcing users into Terminal.
        self.runtimeController.setLogHandler { [weak self] line in
            Task { @MainActor in
                self?.appendLog(line)
            }
        }
    }

    deinit {
        pollTask?.cancel()
        recoveryTask?.cancel()
    }

    func bootstrapIfNeeded() async {
        guard !hasBootstrapped else { return }
        hasBootstrapped = true

        let initialStatusReachable = await tryRefreshStatusOnly(allowRecovery: false)
        if !initialStatusReachable {
            await ensureRuntimeIsRunning()
        }
        if !hasHydratedConnectedSnapshot {
            await refreshAll(showBanner: false)
        }

        startPolling()
    }

    func refreshAll(showBanner: Bool = true) async {
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let snapshot = try await refreshSnapshot.execute()
            applySnapshot(snapshot)
            hasHydratedConnectedSnapshot = true
            managedServerRunning = runtimeController.isRunning
            requestStateText = snapshot.status.loaded ? "Ready" : "Idle"
            if showBanner {
                banner = BannerState(kind: .info, message: "Runtime refreshed.")
            }
        } catch {
            status = nil
            activity = nil
            hasHydratedConnectedSnapshot = false
            managedServerRunning = runtimeController.isRunning
            requestStateText = "Offline"
            if showBanner {
                banner = BannerState(kind: .error, message: error.localizedDescription)
            }
        }
    }

    func refreshSearch() async {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            remoteModels = []
            return
        }

        isSearching = true
        defer { isSearching = false }

        do {
            remoteModels = try await searchRemoteModels.execute(query: query)
            banner = BannerState(kind: .info, message: "Found \(remoteModels.count) model candidates.")
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func startManagedBackend() async {
        guard shouldAutoManageLocalRuntime else {
            requestStateText = "Offline"
            return
        }
        guard !isStartingManagedRuntime else {
            return
        }

        isStartingManagedRuntime = true
        defer { isStartingManagedRuntime = false }

        do {
            try connectToStudio.execute(baseURLString: baseURLString)
            persistPreferences()
            hasHydratedConnectedSnapshot = false

            if !runtimeController.isRunning {
                try managedServer.start(baseURLString: baseURLString)
            }

            managedServerRunning = runtimeController.isRunning
            banner = BannerState(
                kind: .info,
                message: isRecoveringManagedRuntime ? "Restarting local backend..." : "Starting local backend..."
            )
            requestStateText = isRecoveringManagedRuntime ? "Reconnecting..." : "Starting server..."

            // First launch can spend a while creating the virtualenv and
            // installing Python dependencies, so give the backend more room
            // before declaring startup failure.
            for _ in 0..<180 {
                try? await Task.sleep(for: .milliseconds(500))
                if await tryRefreshStatusOnly(allowRecovery: false) {
                    banner = BannerState(
                        kind: .info,
                        message: isRecoveringManagedRuntime ? "Local backend recovered." : "Backend is ready."
                    )
                    return
                }
            }

            banner = BannerState(kind: .error, message: "The backend did not become ready in time.")
            requestStateText = "Server start timed out"
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
            requestStateText = "Failed to start server"
        }
    }

    func stopManagedBackend() async {
        let wasManaged = managedServerRunning

        do {
            requestStateText = "Stopping server..."
            try await managedServer.stop(baseURLString: baseURLString, managedServerRunning: wasManaged)
            managedServerRunning = false
            status = nil
            activity = nil
            requestStateText = "Server stopped"
            banner = BannerState(
                kind: .info,
                message: wasManaged ? "Managed backend stopped." : "Connected server stopped."
            )
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
            requestStateText = "Failed to stop server"
        }
    }

    func handleAppTermination() {
        guard shouldAutoManageLocalRuntime else {
            return
        }
        if runtimeController.isRunning {
            runtimeController.stopServer()
            return
        }

        guard managedServerRunning else {
            return
        }

        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        let port = URL(string: trimmed)?.port ?? 8010
        try? runtimeController.stopServer(on: port)
    }

    func sendMessage() async {
        let userText = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userText.isEmpty else { return }

        let threadID = ensureSelectedThread()
        let userMessage = ConversationMessage(role: .user, text: userText)
        let assistantID = UUID()

        appendMessage(userMessage, to: threadID)
        composerText = ""
        requestStateText = "Thinking..."
        isSending = true
        defer { isSending = false }

        do {
            let stream = try chatSession.streamReply(
                messages: messages(for: threadID).filter { $0.id != assistantID },
                sessionID: sessionID(for: threadID),
                settings: generationSettings
            )

            for try await event in stream {
                switch event {
                case let .status(phase):
                    requestStateText = phase.label
                case let .delta(delta):
                    appendAssistantDelta(delta, to: assistantID, in: threadID)
                case let .done(completion):
                    requestStateText = "Done"
                    if let modelID = completion.modelID, status != nil {
                        status = status.map {
                            StudioStatus(
                                runtime: $0.runtime,
                                runtimes: $0.runtimes,
                                modelID: modelID,
                                loaded: $0.loaded,
                                maxTokens: $0.maxTokens,
                                temperature: $0.temperature,
                                topP: $0.topP,
                                minP: $0.minP,
                                topK: $0.topK,
                                repeatPenalty: $0.repeatPenalty,
                                repeatContextSize: $0.repeatContextSize,
                                stopStrings: $0.stopStrings,
                                enableThinking: $0.enableThinking,
                                models: $0.models,
                                network: $0.network,
                                libraries: $0.libraries
                            )
                        }
                    }
                }
            }

            if assistantText(for: assistantID, in: threadID).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                replaceAssistantMessage(id: assistantID, with: "No visible reply was returned.", in: threadID)
            }

            persistPreferences()
            banner = nil
            await refreshAll(showBanner: false)
        } catch {
            replaceAssistantMessage(id: assistantID, with: "Error: \(error.localizedDescription)", in: threadID)
            banner = BannerState(kind: .error, message: error.localizedDescription)
            requestStateText = "Request failed"
        }
    }

    func createNewConversation() {
        let thread = ConversationThread()
        conversationThreads.insert(thread, at: 0)
        selectedThreadID = thread.id
        composerText = ""
        requestStateText = "Ready"
        banner = nil
        persistPreferences()
    }

    func selectConversation(_ threadID: UUID) {
        guard conversationThreads.contains(where: { $0.id == threadID }) else {
            return
        }
        selectedThreadID = threadID
        composerText = ""
        requestStateText = activeThread?.messages.isEmpty == false ? "Viewing chat" : "Ready"
        banner = nil
        persistPreferences()
    }

    func deleteConversation(_ threadID: UUID) {
        guard let index = conversationThreads.firstIndex(where: { $0.id == threadID }) else {
            return
        }

        conversationThreads.remove(at: index)

        if conversationThreads.isEmpty {
            let replacement = ConversationThread()
            conversationThreads = [replacement]
            selectedThreadID = replacement.id
        } else if selectedThreadID == threadID {
            selectedThreadID = conversationThreads[0].id
        }

        composerText = ""
        requestStateText = activeThread?.messages.isEmpty == false ? "Viewing chat" : "Ready"
        banner = nil
        persistPreferences()
    }

    func loadModel(_ model: LocalModel) async {
        do {
            let payload = try await modelCatalog.load(model)
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "\(model.id) is ready.")
            requestStateText = "Model ready"
            await refreshAll(showBanner: false)
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
            requestStateText = "Failed to load model"
            _ = await tryRefreshStatusOnly()
        }
    }

    func unloadModel() async {
        do {
            let payload = try await modelCatalog.unload()
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "Model unloaded.")
            requestStateText = "Model unloaded"
            await refreshAll(showBanner: false)
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func downloadModel(_ model: RemoteModel) async {
        let format = model.format?.lowercased()
        if format == "gguf" {
            await showRemoteGGUFFiles(for: model)
            return
        }

        do {
            activity = try await modelCatalog.download(model)
            banner = BannerState(kind: .info, message: "Download started for \(model.id).")
            requestStateText = "Downloading \(model.id)"
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func showRemoteGGUFFiles(for model: RemoteModel) async {
        isLoadingRemoteGGUFFiles = true
        defer { isLoadingRemoteGGUFFiles = false }

        do {
            remoteGGUFFiles = try await modelCatalog.fetchGGUFFiles(for: model.id)
            remoteGGUFPickerModel = model
            banner = BannerState(kind: .info, message: "Choose a GGUF file from \(model.id).")
            requestStateText = "Choose GGUF file"
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func dismissRemoteGGUFFiles() {
        remoteGGUFPickerModel = nil
        remoteGGUFFiles = []
    }

    func downloadRemoteGGUFFile(_ file: RemoteModelFile, from model: RemoteModel) async {
        do {
            activity = try await modelCatalog.downloadGGUF(modelID: model.id, filename: file.name)
            remoteGGUFPickerModel = nil
            banner = BannerState(kind: .info, message: "Downloading \(file.name).")
            requestStateText = "Downloading \(file.name)"
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func cancelDownload() async {
        do {
            activity = try await modelCatalog.cancelDownload()
            banner = BannerState(kind: .info, message: activity?.message ?? "Download cancelled.")
            requestStateText = activity?.message ?? "Download cancelled"
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func addModelLibrary() async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Folder"

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        do {
            let payload = try await modelLibraries.add(path: url.path)
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "Added model library.")
            await refreshAll(showBanner: false)
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func removeModelLibrary(_ root: LibraryRoot) async {
        do {
            let payload = try await modelLibraries.remove(path: root.path)
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "Removed \(root.label).")
            await refreshAll(showBanner: false)
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func importCertificate() async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = []
        panel.prompt = "Import PEM"

        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }

        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            let payload = try await networkTrust.importPEM(name: url.lastPathComponent, content: content)
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "Certificate imported.")
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func clearCertificate() async {
        do {
            let payload = try await networkTrust.clearCustomPEM()
            applyStatus(payload)
            banner = BannerState(kind: .info, message: "Using default trust again.")
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func applyHubProviderSelection() async {
        let requestedProvider = selectedHubProvider
        isUpdatingHubProvider = true
        defer { isUpdatingHubProvider = false }

        do {
            let payload = try await networkTrust.setHubProvider(requestedProvider)
            applyStatus(payload)
            syncHubProviderSelection(from: payload)
            remoteModels = []
            banner = BannerState(
                kind: .info,
                message: "Remote model search now uses \(requestedProvider.title)."
            )
        } catch {
            syncHubProviderSelection(from: status)
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func saveGenerationSettings() async {
        do {
            let payload = try await generationSettingsUseCase.save(generationSettings)
            status = payload
            syncGenerationSettings(generationSettings.merged(with: payload), overwriteDraft: true)
            persistPreferences()
            banner = BannerState(kind: .info, message: "Generation settings saved.")
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func applyBaseURL() async {
        do {
            try connectToStudio.execute(baseURLString: baseURLString)
            persistPreferences()
            hasHydratedConnectedSnapshot = false

            let statusReachable = await tryRefreshStatusOnly(allowRecovery: false)
            if !statusReachable {
                await ensureRuntimeIsRunning()
            }
            if !hasHydratedConnectedSnapshot {
                await refreshAll(showBanner: true)
            }
        } catch {
            banner = BannerState(kind: .error, message: error.localizedDescription)
        }
    }

    func clearLogs() {
        logText = ""
    }

    func copyLogs() {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(logText, forType: .string)
        banner = BannerState(kind: .info, message: "Logs copied.")
    }

    var conversation: [ConversationMessage] {
        activeThread?.messages ?? []
    }

    var isConnected: Bool {
        status != nil
    }

    var isExternalServerConnected: Bool {
        isConnected && !managedServerRunning
    }

    var activeModelLabel: String {
        humanReadableModelLabel(from: status?.modelID)
    }

    var connectionSummary: String {
        if isSending {
            return requestStateText
        }
        if managedServerRunning {
            return "Managed server active"
        }
        if status?.loaded == true {
            return "Connected"
        }
        if isConnected {
            return "Connected to existing server"
        }
        return "Offline"
    }

    var serverControlLabel: String {
        if isConnected {
            return "Stop Server"
        }
        return "Start Server"
    }

    var serverControlSymbol: String {
        if isConnected {
            return "stop.fill"
        }
        return "play.fill"
    }

    var canToggleManagedServer: Bool {
        true
    }

    var serverControlHelpText: String {
        if managedServerRunning {
            return "Stop the backend started by this app"
        }
        if isExternalServerConnected {
            return "Stop the currently connected server at the configured address"
        }
        return "Start a local backend from this app"
    }

    var currentConversationTitle: String {
        activeThread?.title ?? "New chat"
    }

    var currentConversationSubtitle: String {
        activeThread?.subtitle ?? "No messages yet"
    }

    private func appendLog(_ line: String) {
        if logText.isEmpty {
            logText = line
        } else {
            logText += "\n" + line
        }
    }

    // Runtime payloads sometimes return an absolute filesystem path. The app
    // header keeps the chrome compact by showing only the user-facing model name.
    private func humanReadableModelLabel(from identifier: String?) -> String {
        guard let identifier, !identifier.isEmpty else {
            return "No model selected"
        }

        let lastPathComponent = URL(fileURLWithPath: identifier).lastPathComponent
        if !lastPathComponent.isEmpty, lastPathComponent != "/" {
            return lastPathComponent
        }

        if let tail = identifier.split(separator: "/").last, !tail.isEmpty {
            return String(tail)
        }

        return identifier
    }

    private func applySnapshot(_ snapshot: StudioSnapshot) {
        applyStatus(snapshot.status)
        localModels = snapshot.localModels
        ggufModels = snapshot.ggufModels
        activity = snapshot.activity
    }

    private func applyStatus(_ payload: StudioStatus) {
        status = payload
        let mergedSettings = syncedGenerationSettings.merged(with: payload)
        // Polling should keep runtime state fresh without erasing unsaved edits
        // that are currently being adjusted in the inspector.
        syncGenerationSettings(mergedSettings, overwriteDraft: !hasUnsavedGenerationChanges)
        if !isUpdatingHubProvider {
            syncHubProviderSelection(from: payload)
        }
    }

    private func persistPreferences() {
        preferencesStore.save(
            baseURLString: baseURLString,
            systemPrompt: generationSettings.systemPrompt,
            conversationThreads: conversationThreads,
            selectedThreadID: selectedThreadID
        )
    }

    private var activeThread: ConversationThread? {
        guard let threadID = selectedThreadID else {
            return conversationThreads.first
        }
        return conversationThreads.first(where: { $0.id == threadID })
    }

    private func ensureSelectedThread() -> UUID {
        if let selectedThreadID, conversationThreads.contains(where: { $0.id == selectedThreadID }) {
            return selectedThreadID
        }

        let thread = ConversationThread()
        conversationThreads.insert(thread, at: 0)
        selectedThreadID = thread.id
        return thread.id
    }

    private func threadIndex(for threadID: UUID) -> Int? {
        conversationThreads.firstIndex(where: { $0.id == threadID })
    }

    private func sessionID(for threadID: UUID) -> String {
        guard let index = threadIndex(for: threadID) else {
            return UUID().uuidString
        }
        return conversationThreads[index].sessionID
    }

    private func messages(for threadID: UUID) -> [ConversationMessage] {
        guard let index = threadIndex(for: threadID) else {
            return []
        }
        return conversationThreads[index].messages
    }

    private func appendMessage(_ message: ConversationMessage, to threadID: UUID) {
        guard let index = threadIndex(for: threadID) else {
            return
        }

        conversationThreads[index].messages.append(message)
        conversationThreads[index].updatedAt = Date()
        moveThreadToFront(threadID)
        persistPreferences()
    }

    private func appendAssistantDelta(_ delta: String, to assistantID: UUID, in threadID: UUID) {
        guard let threadIndex = threadIndex(for: threadID) else {
            return
        }

        if let messageIndex = conversationThreads[threadIndex].messages.firstIndex(where: { $0.id == assistantID }) {
            conversationThreads[threadIndex].messages[messageIndex].text += delta
        } else {
            conversationThreads[threadIndex].messages.append(
                ConversationMessage(id: assistantID, role: .assistant, text: delta)
            )
        }

        conversationThreads[threadIndex].updatedAt = Date()
    }

    private func replaceAssistantMessage(id: UUID, with text: String, in threadID: UUID) {
        guard let threadIndex = threadIndex(for: threadID) else {
            return
        }

        if let messageIndex = conversationThreads[threadIndex].messages.firstIndex(where: { $0.id == id }) {
            conversationThreads[threadIndex].messages[messageIndex].text = text
        } else {
            conversationThreads[threadIndex].messages.append(
                ConversationMessage(id: id, role: .assistant, text: text)
            )
        }
        conversationThreads[threadIndex].updatedAt = Date()
        persistPreferences()
    }

    private func assistantText(for assistantID: UUID, in threadID: UUID) -> String {
        messages(for: threadID).first(where: { $0.id == assistantID })?.text ?? ""
    }

    private func moveThreadToFront(_ threadID: UUID) {
        guard let index = threadIndex(for: threadID), index != 0 else {
            return
        }

        let thread = conversationThreads.remove(at: index)
        conversationThreads.insert(thread, at: 0)
        selectedThreadID = threadID
    }

    private func syncGenerationSettings(_ settings: GenerationSettings, overwriteDraft: Bool) {
        syncedGenerationSettings = settings

        if overwriteDraft {
            isSynchronizingGenerationSettings = true
            generationSettings = settings
            isSynchronizingGenerationSettings = false
        }

        hasUnsavedGenerationChanges = generationSettings != syncedGenerationSettings
    }

    private func syncHubProviderSelection(from payload: StudioStatus?) {
        selectedHubProvider = ModelHubProvider(providerName: payload?.network?.hubProvider)
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while let self, !Task.isCancelled {
                _ = await self.tryRefreshStatusOnly()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func ensureRuntimeIsRunning() async {
        guard shouldAutoManageLocalRuntime else {
            return
        }
        if await tryRefreshStatusOnly(allowRecovery: false) {
            return
        }

        await startManagedBackend()
    }

    private var shouldAutoManageLocalRuntime: Bool {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let host = url.host?.lowercased() else {
            return false
        }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    private func scheduleRuntimeRecoveryIfNeeded() {
        guard shouldAutoManageLocalRuntime, !isStartingManagedRuntime, !isRecoveringManagedRuntime else {
            return
        }

        isRecoveringManagedRuntime = true
        recoveryTask?.cancel()
        recoveryTask = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.isRecoveringManagedRuntime = false }

            self.requestStateText = "Reconnecting..."
            self.banner = BannerState(kind: .info, message: "Local runtime stopped responding. Restarting...")
            await self.startManagedBackend()
        }
    }

    private func tryRefreshStatusOnly(allowRecovery: Bool = true) async -> Bool {
        do {
            let (statusPayload, activityPayload) = try await refreshStatus.execute()
            applyStatus(statusPayload)
            activity = activityPayload
            managedServerRunning = runtimeController.isRunning
            if !hasHydratedConnectedSnapshot {
                await refreshAll(showBanner: false)
            }
            return true
        } catch {
            if runtimeController.isRunning {
                appendLog("Status probe failed: \(error.localizedDescription)")
            }
            status = nil
            activity = nil
            hasHydratedConnectedSnapshot = false
            managedServerRunning = runtimeController.isRunning
            if allowRecovery {
                scheduleRuntimeRecoveryIfNeeded()
            }
            return false
        }
    }
}
