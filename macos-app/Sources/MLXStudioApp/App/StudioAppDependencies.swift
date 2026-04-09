import Foundation

// This container keeps app assembly in one place so views and view models only
// receive the pieces they actually need.
struct StudioAppDependencies {
    let preferencesStore: StudioPreferencesStore
    let connectToStudio: ConnectToStudioUseCase
    let refreshSnapshot: RefreshStudioSnapshotUseCase
    let refreshStatus: RefreshStudioStatusUseCase
    let managedServer: ManagedServerUseCase
    let searchRemoteModels: SearchRemoteModelsUseCase
    let modelCatalog: ModelCatalogUseCase
    let modelLibraries: ModelLibraryUseCase
    let networkTrust: NetworkTrustUseCase
    let generationSettings: GenerationSettingsUseCase
    let chatSession: ChatSessionUseCase
    let runtimeController: any ManagedRuntimeControlling

    static func live() -> StudioAppDependencies {
        let preferencesStore = StudioPreferencesStore()
        let preferences = preferencesStore.load()
        let client = StudioAPIClient(baseURL: URL(string: preferences.baseURLString) ?? URL(string: "http://127.0.0.1:8010")!)
        let repository = LiveStudioRepository(client: client)
        let runtimeController = ManagedStudioRuntimeController()

        return StudioAppDependencies(
            preferencesStore: preferencesStore,
            connectToStudio: ConnectToStudioUseCase(repository: repository),
            refreshSnapshot: RefreshStudioSnapshotUseCase(repository: repository),
            refreshStatus: RefreshStudioStatusUseCase(repository: repository),
            managedServer: ManagedServerUseCase(repository: repository, runtimeController: runtimeController),
            searchRemoteModels: SearchRemoteModelsUseCase(repository: repository),
            modelCatalog: ModelCatalogUseCase(repository: repository),
            modelLibraries: ModelLibraryUseCase(repository: repository),
            networkTrust: NetworkTrustUseCase(repository: repository),
            generationSettings: GenerationSettingsUseCase(repository: repository),
            chatSession: ChatSessionUseCase(repository: repository),
            runtimeController: runtimeController
        )
    }
}
