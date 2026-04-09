import SwiftUI

struct RootSplitView: View {
    @ObservedObject var model: StudioViewModel
    @State private var isInspectorVisible = true

    var body: some View {
        ZStack {
            StudioTheme.canvasGradient
                .ignoresSafeArea()

            Circle()
                .fill(StudioTheme.accent.opacity(0.12))
                .frame(width: 440, height: 440)
                .blur(radius: 80)
                .offset(x: 380, y: -260)

            Circle()
                .fill(Color.white.opacity(0.05))
                .frame(width: 320, height: 320)
                .blur(radius: 60)
                .offset(x: -340, y: 240)

            HStack(spacing: 18) {
                sidebar

                VStack(spacing: 14) {
                    header
                    if let banner = model.banner, banner.kind == .error {
                        bannerView(banner)
                    }
                    contentArea
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 18)
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .preferredColorScheme(.dark)
        .tint(StudioTheme.accent)
        .transaction { transaction in
            transaction.animation = nil
        }
        .task {
            await model.bootstrapIfNeeded()
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(StudioTheme.accentSoft)
                            .frame(width: 34, height: 34)
                        Image(systemName: "sparkles.rectangle.stack.fill")
                            .foregroundStyle(StudioTheme.accent)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("MLX Studio")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(StudioTheme.label)
                        Text("Local runtime cockpit")
                            .font(.caption)
                            .foregroundStyle(StudioTheme.secondaryLabel)
                    }
                }

                Text("Workspace")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(StudioTheme.tertiaryLabel)
                    .textCase(.uppercase)
                    .tracking(1.2)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)

            ForEach(AppSection.allCases) { section in
                Button {
                    model.selectedSection = section
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: section.systemImage)
                            .frame(width: 16)
                            .font(.system(size: 14, weight: .semibold))
                        Text(section.title)
                            .font(.subheadline.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .contentShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .foregroundStyle((model.selectedSection ?? .chat) == section ? StudioTheme.label : StudioTheme.secondaryLabel)
                .background(selectedSection == section ? StudioTheme.accentSoft : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            if (model.selectedSection ?? .chat) == .chat {
                Rectangle()
                    .fill(StudioTheme.subtleOutline)
                    .frame(height: 1)
                    .padding(.vertical, 10)

                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("RECENT")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(StudioTheme.tertiaryLabel)
                            .tracking(1.0)

                        Spacer()

                        Button {
                            model.createNewConversation()
                        } label: {
                            Image(systemName: "square.and.pencil")
                                .foregroundStyle(StudioTheme.secondaryLabel)
                        }
                        .buttonStyle(.plain)
                        .help("New chat")
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.conversationThreads) { thread in
                            Button {
                                model.selectConversation(thread.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(thread.title)
                                        .font(.subheadline.weight(.medium))
                                        .lineLimit(2)
                                        .foregroundStyle(StudioTheme.label)
                                    Text(thread.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(StudioTheme.secondaryLabel)
                                }
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    (model.selectedThreadID == thread.id ? StudioTheme.surfaceRaised.opacity(0.92) : Color.clear)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button(role: .destructive) {
                                    model.deleteConversation(thread.id)
                                } label: {
                                    Label("Delete Chat", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 14)
            }

            Spacer()
        }
        .padding(16)
        .frame(width: 250)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(StudioTheme.sidebarGradient)
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(StudioTheme.outline, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: StudioTheme.shadow, radius: 18, x: 0, y: 12)
    }

    private var header: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(model.isConnected ? StudioTheme.success : StudioTheme.secondaryLabel.opacity(0.8))
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    runtimeBadge
                    Text(model.activeModelLabel)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .foregroundStyle(StudioTheme.label)
                }
                Text(model.connectionSummary)
                    .font(.caption)
                    .foregroundStyle(StudioTheme.secondaryLabel)
            }
            .frame(maxWidth: 380, alignment: .leading)

            Spacer()

            if (model.selectedSection ?? .chat) == .chat {
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        isInspectorVisible.toggle()
                    }
                } label: {
                    Image(systemName: "sidebar.right")
                        .foregroundStyle(isInspectorVisible ? StudioTheme.accent : StudioTheme.secondaryLabel)
                        .frame(width: 16, height: 16)
                }
                .help(isInspectorVisible ? "Hide settings inspector" : "Show settings inspector")
                .buttonStyle(.borderless)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .studioPanel(fill: StudioTheme.surface.opacity(0.96), cornerRadius: 24)
    }

    private var contentArea: some View {
        HStack(spacing: 16) {
            detailView
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            if showsInspector {
                ChatInspectorView(model: model)
                    .frame(width: 340)
                    .frame(maxHeight: .infinity)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
    }

    private var showsInspector: Bool {
        (model.selectedSection ?? .chat) == .chat && isInspectorVisible
    }

    @ViewBuilder
    private var detailView: some View {
        switch model.selectedSection ?? .chat {
        case .chat:
            ChatView(model: model)
        case .models:
            ModelsView(model: model)
        case .logs:
            LogsView(model: model)
        case .settings:
            SettingsView(model: model)
        }
    }

    private func bannerView(_ banner: BannerState) -> some View {
        HStack {
            Image(systemName: banner.kind == .error ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(banner.kind == .error ? Color.red : StudioTheme.accent)
            Text(banner.message)
                .lineLimit(2)
                .foregroundStyle(StudioTheme.label)
            Spacer()
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
        .studioPanel(fill: banner.kind == .error ? Color.red.opacity(0.12) : StudioTheme.accentSoft, cornerRadius: 18)
    }

    private var runtimeBadge: some View {
        Text((model.status?.runtime ?? "   ").uppercased())
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(StudioTheme.accentSoft.opacity(model.status?.runtime == nil ? 0.35 : 1.0))
            .clipShape(Capsule())
            .foregroundStyle(model.status?.runtime == nil ? StudioTheme.secondaryLabel : StudioTheme.label)
    }

    private var selectedSection: AppSection {
        model.selectedSection ?? .chat
    }
}
