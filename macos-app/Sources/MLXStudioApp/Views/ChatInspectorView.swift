import SwiftUI

struct ChatInspectorView: View {
    @ObservedObject var model: StudioViewModel
    @State private var showsAdvancedControls = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                modelSection
                generationSection
                promptSection
            }
            .padding(20)
        }
        // The inspector keeps tuning controls close to chat without crowding
        // the center thread view.
        .studioPanel(fill: StudioTheme.surface.opacity(0.94), cornerRadius: 28)
        .transaction { transaction in
            transaction.animation = nil
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Model Inspector", systemImage: "slider.horizontal.3")
                .font(.headline.weight(.semibold))
                .foregroundStyle(StudioTheme.label)
            Text("Tune the active model here and leave the center focused on the conversation.")
                .font(.subheadline)
                .foregroundStyle(StudioTheme.secondaryLabel)
        }
    }

    private var modelSection: some View {
        inspectorCard(title: "Active Model", symbol: "shippingbox") {
            infoRow(symbol: "cpu", label: "Runtime", value: model.status?.runtime.uppercased() ?? "Offline")
            infoRow(symbol: "checkmark.circle", label: "Status", value: model.connectionSummary)
            infoRow(symbol: "cube.transparent", label: "Model", value: model.activeModelLabel)

            if let modelID = model.status?.modelID, !modelID.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Resolved Path", systemImage: "folder")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(modelID)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private var generationSection: some View {
        inspectorCard(title: "Generation", symbol: "dial.medium", accessory: {
            if model.hasUnsavedGenerationChanges {
                Label("Draft", systemImage: "circle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.orange)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.10))
                    .clipShape(Capsule())
            }
        }) {
            Stepper(value: $model.generationSettings.maxTokens, in: 1...4096, step: 64) {
                infoRow(symbol: "textformat.123", label: "Max Tokens", value: "\(model.generationSettings.maxTokens)")
            }

            Stepper(value: $model.generationSettings.topK, in: 0...500, step: 8) {
                infoRow(symbol: "line.3.horizontal.decrease.circle", label: "Top K", value: "\(model.generationSettings.topK)")
            }

            sliderBlock(
                title: "Temperature",
                symbol: "thermometer.medium",
                value: $model.generationSettings.temperature,
                range: 0...2,
                step: 0.05
            )

            sliderBlock(
                title: "Top P",
                symbol: "chart.xyaxis.line",
                value: $model.generationSettings.topP,
                range: 0...1,
                step: 0.01
            )

            Toggle(isOn: $model.generationSettings.enableThinking) {
                Label("Enable Thinking", systemImage: "brain.head.profile")
            }

            DisclosureGroup(isExpanded: $showsAdvancedControls) {
                VStack(alignment: .leading, spacing: 12) {
                    sliderBlock(
                        title: "Min P",
                        symbol: "arrow.down.to.line.compact",
                        value: $model.generationSettings.minP,
                        range: 0...1,
                        step: 0.01
                    )

                    sliderBlock(
                        title: "Repeat Penalty",
                        symbol: "repeat.circle",
                        value: $model.generationSettings.repeatPenalty,
                        range: 0...3,
                        step: 0.01
                    )

                    Stepper(value: $model.generationSettings.repeatContextSize, in: 0...4096, step: 32) {
                        infoRow(
                            symbol: "arrow.triangle.2.circlepath",
                            label: "Repeat Window",
                            value: "\(model.generationSettings.repeatContextSize)"
                        )
                    }

                    TextField("Stop strings", text: $model.generationSettings.stopStringsText)
                        .textFieldStyle(.roundedBorder)
                }
                .padding(.top, 8)
            } label: {
                Label("Advanced Controls", systemImage: "slider.horizontal.below.rectangle")
                    .font(.subheadline.weight(.medium))
            }

            HStack {
                Button {
                    Task {
                        await model.saveGenerationSettings()
                    }
                } label: {
                    Label("Save", systemImage: "checkmark.circle.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 8, height: 8)
                        .opacity(model.hasUnsavedGenerationChanges ? 1 : 0)
                        .offset(x: 3, y: -3)
                }
                .disabled(!model.hasUnsavedGenerationChanges)

                Button {
                    model.selectedSection = .settings
                } label: {
                    Label("More", systemImage: "gearshape.fill")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
        }
    }

    private var promptSection: some View {
        inspectorCard(title: "System Prompt", symbol: "text.quote") {
            TextEditor(text: $model.generationSettings.systemPrompt)
                .frame(minHeight: 120)
                .padding(8)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    private func infoRow(symbol: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .frame(width: 16)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(StudioTheme.secondaryLabel)
                Text(value)
                    .font(.subheadline)
                    .foregroundStyle(StudioTheme.label)
            }

            Spacer(minLength: 0)
        }
    }

    private func sliderBlock(
        title: String,
        symbol: String,
        value: Binding<Double>,
        range: ClosedRange<Double>,
        step: Double
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(title, systemImage: symbol)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(StudioTheme.label)
                Spacer()
                Text(value.wrappedValue.formatted(.number.precision(.fractionLength(2))))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(StudioTheme.secondaryLabel)
                    .monospacedDigit()
                    .frame(width: 44, alignment: .trailing)
            }

            Slider(value: value, in: range, step: step)
        }
    }

    private func inspectorCard<Content: View>(
        title: String,
        symbol: String,
        @ViewBuilder accessory: () -> some View = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Label(title, systemImage: symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(StudioTheme.label)

                Spacer()

                accessory()
            }

            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .studioCard(fill: StudioTheme.surfaceRaised, cornerRadius: 22)
    }
}
