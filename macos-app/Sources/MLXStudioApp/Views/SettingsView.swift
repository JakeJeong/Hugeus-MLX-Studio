import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: StudioViewModel

    private let contentWidth: CGFloat = 640
    private let controlWidth: CGFloat = 288

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                connectionCard
                generationCard
                networkCard
            }
            .frame(maxWidth: contentWidth, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .top)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Settings")
                .font(.title2.weight(.semibold))
                .foregroundStyle(StudioTheme.label)
            Text("Keep runtime and generation defaults tidy here without stretching controls across the whole window.")
                .font(.subheadline)
                .foregroundStyle(StudioTheme.secondaryLabel)
        }
    }

    private var connectionCard: some View {
        settingsCard(title: "Connection", subtitle: "Point the app at a local runtime and keep runtime details compact.") {
            settingRow(
                title: "Backend URL",
                description: "The app auto-manages localhost by default."
            ) {
                HStack(spacing: 10) {
                    TextField("http://127.0.0.1:8010", text: $model.baseURLString)
                        .textFieldStyle(.roundedBorder)

                    Button("Apply") {
                        Task {
                            await model.applyBaseURL()
                        }
                    }
                    .buttonStyle(.bordered)
                }
                .frame(width: controlWidth)
            }

            if let runtime = model.status?.runtime {
                rowDivider

                settingRow(
                    title: "Runtime",
                    description: "The connected inference backend currently serving requests."
                ) {
                    HStack(spacing: 8) {
                        Text(runtime.uppercased())
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(StudioTheme.label)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(StudioTheme.accentSoft)
                            .clipShape(Capsule())
                        Spacer(minLength: 0)
                    }
                    .frame(width: controlWidth)
                }
            }
        }
    }

    private var generationCard: some View {
        settingsCard(title: "Generation", subtitle: "Model-wide defaults applied to new replies.") {
            settingRow(
                title: "System Prompt",
                description: "A base instruction that guides the assistant before each conversation."
            ) {
                TextEditor(text: $model.generationSettings.systemPrompt)
                    .font(.body)
                    .frame(width: controlWidth, height: 112)
                    .padding(8)
                    .background(StudioTheme.surfaceMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(StudioTheme.subtleOutline, lineWidth: 1)
                    )
            }

            rowDivider

            settingRow(title: "Max Tokens", description: "Upper bound for generated tokens per reply.") {
                stepperField(
                    valueText: String(model.generationSettings.maxTokens),
                    content: {
                        Stepper("", value: $model.generationSettings.maxTokens, in: 1...4096, step: 64)
                            .labelsHidden()
                    }
                )
            }

            rowDivider

            settingRow(title: "Top K", description: "Limit the candidate token pool before sampling.") {
                stepperField(
                    valueText: String(model.generationSettings.topK),
                    content: {
                        Stepper("", value: $model.generationSettings.topK, in: 0...500, step: 8)
                            .labelsHidden()
                    }
                )
            }

            rowDivider

            sliderRow(
                title: "Temperature",
                description: "Higher values produce more varied replies.",
                value: model.generationSettings.temperature,
                range: 0...2,
                step: 0.05,
                binding: $model.generationSettings.temperature
            )

            rowDivider

            sliderRow(
                title: "Top P",
                description: "Sample from the smallest token set whose cumulative probability passes this threshold.",
                value: model.generationSettings.topP,
                range: 0...1,
                step: 0.01,
                binding: $model.generationSettings.topP
            )

            rowDivider

            sliderRow(
                title: "Min P",
                description: "Discard tokens that fall beneath the minimum probability floor.",
                value: model.generationSettings.minP,
                range: 0...1,
                step: 0.01,
                binding: $model.generationSettings.minP
            )

            rowDivider

            sliderRow(
                title: "Repeat Penalty",
                description: "Discourage the model from repeating recent tokens verbatim.",
                value: model.generationSettings.repeatPenalty,
                range: 0...3,
                step: 0.01,
                binding: $model.generationSettings.repeatPenalty
            )

            rowDivider

            settingRow(title: "Repeat Window", description: "How many recent tokens participate in repetition control.") {
                stepperField(
                    valueText: String(model.generationSettings.repeatContextSize),
                    content: {
                        Stepper("", value: $model.generationSettings.repeatContextSize, in: 0...4096, step: 32)
                            .labelsHidden()
                    }
                )
            }

            rowDivider

            settingRow(title: "Stop Strings", description: "Comma-separated stop sequences for advanced prompting.") {
                TextField("Stop strings (comma separated)", text: $model.generationSettings.stopStringsText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: controlWidth)
            }

            rowDivider

            settingRow(title: "Thinking", description: "Enable explicit chain-of-thought style reasoning when supported.") {
                Toggle("Enable Thinking", isOn: $model.generationSettings.enableThinking)
                    .toggleStyle(.switch)
                    .labelsHidden()
                    .frame(width: controlWidth, alignment: .leading)
            }

            rowDivider

            HStack {
                HStack(spacing: 8) {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 8, height: 8)
                        .opacity(model.hasUnsavedGenerationChanges ? 1 : 0)
                    Text(model.hasUnsavedGenerationChanges ? "Unsaved changes" : "Synced")
                        .font(.caption)
                        .foregroundStyle(model.hasUnsavedGenerationChanges ? Color.orange : StudioTheme.secondaryLabel)
                }

                Spacer()

                Button("Save Changes") {
                    Task {
                        await model.saveGenerationSettings()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.hasUnsavedGenerationChanges)
            }
            .padding(.top, 2)
        }
    }

    private var networkCard: some View {
        settingsCard(title: "Network Trust", subtitle: "Add a PEM bundle only when a corporate proxy or MITM root certificate requires it.") {
            settingRow(
                title: "Model Hub",
                description: "Choose whether remote model search and downloads use the official Hugging Face Hub or HF Mirror."
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Picker(
                        "Model Hub",
                        selection: Binding(
                            get: { model.selectedHubProvider },
                            set: { newValue in
                                guard newValue != model.selectedHubProvider else {
                                    return
                                }
                                model.selectedHubProvider = newValue
                                Task {
                                    await model.applyHubProviderSelection()
                                }
                            }
                        )
                    ) {
                        ForEach(ModelHubProvider.allCases) { provider in
                            Text(provider.title)
                                .tag(provider)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .disabled(model.isUpdatingHubProvider)

                    HStack(spacing: 8) {
                        Text(model.status?.network?.hubEndpoint ?? model.selectedHubProvider.endpoint)
                            .font(.caption)
                            .foregroundStyle(StudioTheme.secondaryLabel)
                            .lineLimit(1)
                            .truncationMode(.middle)

                        if model.isUpdatingHubProvider {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }
                }
                .frame(width: controlWidth, alignment: .leading)
            }

            rowDivider

            if let network = model.status?.network {
                settingRow(title: "Certificate Source", description: network.effectiveCABundlePath ?? "Using default system trust.") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(network.source)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(StudioTheme.label)
                        if let name = network.customCABundleName {
                            Text(name)
                                .font(.caption)
                                .foregroundStyle(StudioTheme.secondaryLabel)
                        }
                    }
                    .frame(width: controlWidth, alignment: .leading)
                }
            } else {
                Text("Connection info will appear here once the backend responds.")
                    .font(.subheadline)
                    .foregroundStyle(StudioTheme.secondaryLabel)
            }

            rowDivider

            settingRow(title: "Custom PEM", description: "Import a PEM bundle for restricted networks, or clear it to use the default trust store.") {
                HStack(spacing: 10) {
                    Button("Import PEM") {
                        Task {
                            await model.importCertificate()
                        }
                    }
                    .buttonStyle(.bordered)

                    Button("Clear PEM", role: .destructive) {
                        Task {
                            await model.clearCertificate()
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.status?.network?.customCABundleConfigured != true)
                }
                .frame(width: controlWidth, alignment: .leading)
            }
        }
    }

    private func settingsCard<Content: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(StudioTheme.label)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(StudioTheme.secondaryLabel)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)

            Divider()
                .overlay(StudioTheme.subtleOutline)

            VStack(alignment: .leading, spacing: 0) {
                content()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 6)
        }
        .studioCard(fill: StudioTheme.surfaceRaised, cornerRadius: 18)
    }

    private func settingRow<Control: View>(
        title: String,
        description: String,
        @ViewBuilder control: () -> Control
    ) -> some View {
        HStack(alignment: .top, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(StudioTheme.label)
                Text(description)
                    .font(.caption)
                    .foregroundStyle(StudioTheme.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            control()
        }
        .padding(.vertical, 12)
    }

    private func sliderRow(
        title: String,
        description: String,
        value: Double,
        range: ClosedRange<Double>,
        step: Double,
        binding: Binding<Double>
    ) -> some View {
        settingRow(title: title, description: description) {
            VStack(alignment: .leading, spacing: 8) {
                Text(value.formatted(.number.precision(.fractionLength(2))))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(StudioTheme.secondaryLabel)
                Slider(value: binding, in: range, step: step)
            }
            .frame(width: controlWidth)
        }
    }

    private func stepperField<Content: View>(
        valueText: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 10) {
            Text(valueText)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(StudioTheme.label)
                .frame(minWidth: 64, alignment: .leading)
            Spacer(minLength: 0)
            content()
        }
        .frame(width: controlWidth)
    }

    private var rowDivider: some View {
        Divider()
            .overlay(StudioTheme.subtleOutline)
    }
}
