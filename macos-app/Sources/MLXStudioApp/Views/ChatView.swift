import SwiftUI

struct ChatView: View {
    @ObservedObject var model: StudioViewModel
    @State private var composerFocusToken = 0
    private let conversationColumnWidth: CGFloat = 750

    var body: some View {
        VStack(spacing: 16) {
            ChatTranscriptWebView(
                messages: model.conversation,
                isSending: model.isSending,
                requestStateText: model.requestStateText
            )
            .frame(maxWidth: .infinity)
            .frame(maxHeight: .infinity)
            .padding(.bottom, 6)

            VStack(alignment: .leading, spacing: 8) {
                ZStack(alignment: .topLeading) {
                    ChatComposerTextView(
                        text: $model.composerText,
                        isEditable: true,
                        focusToken: composerFocusToken,
                        onSubmitCommand: submitMessage
                    )
                    .frame(minHeight: 42, maxHeight: 96)

                    if model.composerText.isEmpty {
                        Text("Message MLX Studio…")
                            .font(.body)
                            .foregroundStyle(StudioTheme.tertiaryLabel)
                            .padding(.horizontal, ChatComposerTextView.contentHorizontalInset)
                            .padding(.vertical, ChatComposerTextView.contentVerticalInset)
                            .allowsHitTesting(false)
                    }
                }
                .padding(.horizontal, 2)

                HStack {
                    Text(composeFooterSummary)
                        .foregroundStyle(StudioTheme.secondaryLabel)
                        .font(.caption)

                    Spacer()

                    Text("Enter to send • Shift+Enter newline")
                        .font(.caption2)
                        .foregroundStyle(StudioTheme.tertiaryLabel)

                    Button {
                        submitMessage()
                    } label: {
                        ZStack {
                            Label("Send", systemImage: "paperplane.fill")
                                .opacity(model.isSending ? 0 : 1)

                            if model.isSending {
                                HStack(spacing: 8) {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("Send")
                                }
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(width: 110)
                    .disabled(!model.isConnected || model.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isSending)
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 10)
            .studioPanel(fill: StudioTheme.surface.opacity(0.96), cornerRadius: 20)
            .frame(maxWidth: conversationColumnWidth)
        }
        .padding(.top, 2)
        .padding(.bottom, 2)
        .padding(.horizontal, 2)
        .frame(minWidth: 640, maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .transaction { transaction in
            transaction.animation = nil
        }
        .onAppear {
            composerFocusToken += 1
        }
    }

    private var composeFooterSummary: String {
        "\(model.requestStateText) • \(model.activeModelLabel) • \(model.generationSettings.maxTokens) tok • temp \(model.generationSettings.temperature.formatted(.number.precision(.fractionLength(2))))"
    }

    private func submitMessage() {
        guard model.isConnected else {
            return
        }

        Task {
            await model.sendMessage()
            composerFocusToken += 1
        }
    }
}
