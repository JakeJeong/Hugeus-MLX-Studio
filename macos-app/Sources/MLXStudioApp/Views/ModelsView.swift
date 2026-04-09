import SwiftUI

struct ModelsView: View {
    @ObservedObject var model: StudioViewModel
    @State private var selectedTab: ModelsTab = .installed

    private let contentWidth: CGFloat = 900

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                tabPicker
                activeTabContent
            }
            .frame(maxWidth: contentWidth, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .sheet(item: $model.remoteGGUFPickerModel, onDismiss: {
            model.dismissRemoteGGUFFiles()
        }) { remoteModel in
            remoteGGUFSheet(for: remoteModel)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Models")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(StudioTheme.label)
                Text("Manage installed models, remote search, and download activity from one place.")
                    .font(.subheadline)
                    .foregroundStyle(StudioTheme.secondaryLabel)
            }

            Spacer()

            Button {
                Task {
                    await model.refreshAll(showBanner: true)
                }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
    }

    private var tabPicker: some View {
        HStack(spacing: 8) {
            ForEach(ModelsTab.allCases) { tab in
                Button {
                    selectedTab = tab
                } label: {
                    HStack(spacing: 8) {
                        Text(tab.title)
                            .font(.headline.weight(.semibold))
                        if tab == .downloads, model.activity?.active == true {
                            Circle()
                                .fill(StudioTheme.accent)
                                .frame(width: 8, height: 8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                }
                .buttonStyle(.plain)
                .foregroundStyle(selectedTab == tab ? StudioTheme.label : StudioTheme.secondaryLabel)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(selectedTab == tab ? StudioTheme.surfaceRaised : Color.clear)
                )
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(StudioTheme.surface.opacity(0.94))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(StudioTheme.subtleOutline, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var activeTabContent: some View {
        switch selectedTab {
        case .installed:
            VStack(alignment: .leading, spacing: 20) {
                installedSection
                librariesSection
            }
        case .search:
            remoteSearchSection
        case .downloads:
            downloadsSection
        }
    }

    private var installedSection: some View {
        modelsCard(title: "Installed", subtitle: "Local models discovered from LM Studio paths and Hugging Face cache roots.") {
            VStack(alignment: .leading, spacing: 14) {
                if model.localModels.isEmpty && model.ggufModels.isEmpty {
                    emptyStateCopy("No local models found yet.")
                } else {
                    if !model.localModels.isEmpty {
                        modelGroup(title: "MLX", models: model.localModels)
                    }
                    if !model.ggufModels.isEmpty {
                        modelGroup(title: "GGUF", models: model.ggufModels)
                    }
                }

                HStack {
                    Button {
                        Task {
                            await model.unloadModel()
                        }
                    } label: {
                        Label("Unload Current", systemImage: "eject.fill")
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.status?.loaded != true)

                    Spacer()
                }
            }
        }
    }

    private var librariesSection: some View {
        modelsCard(title: "Model Libraries", subtitle: "Default LM Studio and Hugging Face roots are auto-scanned. Add extra folders only when your cache lives elsewhere.") {
            VStack(alignment: .leading, spacing: 12) {
                let roots = model.status?.libraries?.customModelRoots ?? []

                if roots.isEmpty {
                    emptyStateCopy("Using only the default Hugging Face and LM Studio folders.")
                } else {
                    VStack(spacing: 10) {
                        ForEach(roots) { root in
                            itemCard {
                                HStack(alignment: .top, spacing: 14) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(root.label)
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(StudioTheme.label)

                                        Text(root.path)
                                            .font(.caption)
                                            .foregroundStyle(StudioTheme.secondaryLabel)
                                            .textSelection(.enabled)
                                            .fixedSize(horizontal: false, vertical: true)

                                        Text("Custom model library")
                                            .font(.caption)
                                            .foregroundStyle(StudioTheme.tertiaryLabel)
                                    }

                                    Spacer(minLength: 12)

                                    Button(role: .destructive) {
                                        Task {
                                            await model.removeModelLibrary(root)
                                        }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                }

                HStack {
                    Button {
                        Task {
                            await model.addModelLibrary()
                        }
                    } label: {
                        Label("Add Folder", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)

                    Spacer()
                }
            }
        }
    }

    private var remoteSearchSection: some View {
        modelsCard(title: "Remote Search", subtitle: "Search downloadable community models and fetch GGUF files when needed.") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    TextField("Search mlx-community models", text: $model.searchQuery)
                        .textFieldStyle(.roundedBorder)
                        .onSubmit {
                            Task {
                                await model.refreshSearch()
                            }
                        }

                    Button {
                        Task {
                            await model.refreshSearch()
                        }
                    } label: {
                        if model.isSearching || model.isLoadingRemoteGGUFFiles {
                            ProgressView()
                                .controlSize(.small)
                                .frame(width: 64)
                        } else {
                            Label("Search", systemImage: "magnifyingglass")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }

                if model.remoteModels.isEmpty {
                    emptyStateCopy("Search results will appear here.")
                } else {
                    VStack(spacing: 10) {
                        ForEach(model.remoteModels) { remote in
                            itemCard {
                                HStack(alignment: .top, spacing: 14) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(remote.id)
                                            .font(.headline.weight(.semibold))
                                            .foregroundStyle(StudioTheme.label)
                                            .lineLimit(2)

                                        Text(remote.format?.uppercased() ?? "MODEL")
                                            .font(.subheadline)
                                            .foregroundStyle(StudioTheme.secondaryLabel)

                                        Text(metadata(for: remote))
                                            .font(.caption)
                                            .foregroundStyle(StudioTheme.tertiaryLabel)
                                    }

                                    Spacer(minLength: 12)

                                    Button(remoteActionLabel(for: remote)) {
                                        Task {
                                            await model.downloadModel(remote)
                                        }
                                    }
                                    .buttonStyle(.bordered)
                                    .disabled(remote.downloadable != true || model.isLoadingRemoteGGUFFiles)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var downloadsSection: some View {
        modelsCard(title: "Downloads", subtitle: "Track the active transfer and cancel it without leaving the models workflow.") {
            if let activity = model.activity, activity.active {
                itemCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(activity.modelID ?? "Preparing download")
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(StudioTheme.label)

                        Text(activity.message ?? "Working...")
                            .font(.subheadline)
                            .foregroundStyle(StudioTheme.secondaryLabel)

                        ProgressView(value: activity.progressFraction)
                            .progressViewStyle(.linear)

                        HStack {
                            if let phase = activity.phase {
                                Text(phase.capitalized)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(StudioTheme.secondaryLabel)
                            }

                            Spacer()

                            if let downloaded = activity.downloadedBytes,
                               let total = activity.totalBytes,
                               total > 0 {
                                Text("\(ByteCountFormatter.string(fromByteCount: downloaded, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: total, countStyle: .file))")
                                    .font(.caption)
                                    .foregroundStyle(StudioTheme.secondaryLabel)
                            }
                        }

                        HStack {
                            Spacer()

                            Button("Cancel Download", role: .destructive) {
                                Task {
                                    await model.cancelDownload()
                                }
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            } else {
                emptyStateCopy("No active download. Start one from the Search tab and progress will appear here.")
            }
        }
    }

    private func modelsCard<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(StudioTheme.secondaryLabel)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(StudioTheme.secondaryLabel)
            }

            content()
        }
        .padding(18)
        .studioCard(fill: StudioTheme.surfaceRaised, cornerRadius: 18)
    }

    private func modelGroup(title: String, models: [LocalModel]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(StudioTheme.secondaryLabel)

            VStack(spacing: 10) {
                ForEach(Array(models.enumerated()), id: \.offset) { _, item in
                    itemCard {
                        HStack(alignment: .top, spacing: 14) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(displayTitle(for: item))
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(StudioTheme.label)
                                    .lineLimit(2)

                                Text(sourceLine(for: item))
                                    .font(.subheadline)
                                    .foregroundStyle(StudioTheme.secondaryLabel)
                                    .lineLimit(2)

                                Text(detailLine(for: item))
                                    .font(.caption)
                                    .foregroundStyle(StudioTheme.tertiaryLabel)
                                    .fixedSize(horizontal: false, vertical: true)

                                if let error = item.error, !error.isEmpty {
                                    Text(error)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }

                            Spacer(minLength: 12)

                            VStack(alignment: .trailing, spacing: 8) {
                                statusBadge(for: item)

                                Button(item.loaded == true ? "Loaded" : "Use") {
                                    Task {
                                        await model.loadModel(item)
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(item.ready == false || item.loaded == true)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func statusBadge(for item: LocalModel) -> some View {
        if item.loaded == true {
            badge("Loaded", tint: StudioTheme.success)
        } else if item.selected == true {
            badge("Selected", tint: StudioTheme.accent)
        } else if item.ready == false {
            badge("Unavailable", tint: .orange)
        }
    }

    private func badge(_ title: String, tint: Color) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.12))
            .clipShape(Capsule())
    }

    private func itemCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(StudioTheme.surfaceMuted)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(StudioTheme.subtleOutline, lineWidth: 1)
            )
    }

    private func emptyStateCopy(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(StudioTheme.secondaryLabel)
            .padding(.vertical, 4)
    }

    private func displayTitle(for item: LocalModel) -> String {
        if let path = item.path, let last = path.split(separator: "/").last, !last.isEmpty {
            return String(last)
        }
        return item.id
    }

    private func sourceLine(for item: LocalModel) -> String {
        let source = item.id.contains("/") ? item.id : item.path ?? item.id
        if source.contains("/"), let owner = source.split(separator: "/").dropLast().last {
            return String(owner)
        }
        return item.format?.uppercased() ?? "MODEL"
    }

    private func detailLine(for item: LocalModel) -> String {
        let parts = [
            item.format?.uppercased(),
            item.sizeGB.map { String(format: "%.2f GB", $0) },
            item.path,
        ]
        return parts.compactMap { $0 }.joined(separator: " • ")
    }

    private func metadata(for remote: RemoteModel) -> String {
        let parts = [
            remote.format?.uppercased(),
            remote.downloads.map { "\($0) downloads" },
            remote.likes.map { "\($0) likes" },
            remote.sizeGB.map { String(format: "%.2f GB", $0) },
            remote.cached == true ? "Cached" : nil,
        ]
        return parts.compactMap { $0 }.joined(separator: " • ")
    }

    private func remoteActionLabel(for remote: RemoteModel) -> String {
        if remote.cached == true {
            return "Redownload"
        }
        if remote.format?.lowercased() == "gguf" {
            return "Choose File"
        }
        return "Download"
    }

    @ViewBuilder
    private func remoteGGUFSheet(for remoteModel: RemoteModel) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Choose GGUF File")
                        .font(.title3.bold())
                    Text(remoteModel.id)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Close") {
                    model.dismissRemoteGGUFFiles()
                }
            }

            if model.remoteGGUFFiles.isEmpty {
                ContentUnavailableView(
                    "No GGUF files found",
                    systemImage: "shippingbox",
                    description: Text("This repo did not return any downloadable GGUF files.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(model.remoteGGUFFiles) { file in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(file.name)
                                .font(.subheadline.weight(.medium))
                            Text(file.sizeGB.map { String(format: "%.2f GB", $0) } ?? "Size unavailable")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Download") {
                            Task {
                                await model.downloadRemoteGGUFFile(file, from: remoteModel)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .listStyle(.inset)
            }
        }
        .padding(24)
        .frame(minWidth: 560, minHeight: 360)
    }
}

private enum ModelsTab: String, CaseIterable, Identifiable {
    case installed
    case search
    case downloads

    var id: String { rawValue }

    var title: String {
        switch self {
        case .installed:
            return "Installed"
        case .search:
            return "Search"
        case .downloads:
            return "Downloads"
        }
    }
}
