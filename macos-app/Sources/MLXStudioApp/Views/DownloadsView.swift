import SwiftUI

struct DownloadsView: View {
    @ObservedObject var model: StudioViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Downloads")
                        .font(.title2.bold())
                    Text("Track model downloads and cancel the current task when needed.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh") {
                    Task {
                        await model.refreshAll(showBanner: true)
                    }
                }
            }

            if let activity = model.activity, activity.active {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(activity.modelID ?? "Preparing download")
                            .font(.headline)
                        Text(activity.message ?? "Working...")
                            .foregroundStyle(.secondary)

                        ProgressView(value: activity.progressFraction)
                            .progressViewStyle(.linear)

                        HStack {
                            if let phase = activity.phase {
                                Text(phase.capitalized)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let downloaded = activity.downloadedBytes,
                               let total = activity.totalBytes,
                               total > 0 {
                                Text("\(ByteCountFormatter.string(fromByteCount: downloaded, countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: total, countStyle: .file))")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        HStack {
                            Spacer()
                            Button("Cancel", role: .destructive) {
                                Task {
                                    await model.cancelDownload()
                                }
                            }
                        }
                    }
                }
            } else {
                ContentUnavailableView(
                    "No active download",
                    systemImage: "arrow.down.circle",
                    description: Text("Start a model download from the Models tab and progress will appear here.")
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
