import SwiftUI

struct LogsView: View {
    @ObservedObject var model: StudioViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Logs")
                        .font(.title2.bold())
                    Text("Managed backend output stays here so runtime failures are visible without the terminal.")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Copy") {
                    model.copyLogs()
                }
                .disabled(model.logText.isEmpty)
                Button("Clear") {
                    model.clearLogs()
                }
                .disabled(model.logText.isEmpty)
            }

            TextEditor(text: .constant(model.logText.isEmpty ? "No logs yet." : model.logText))
                .font(.system(.body, design: .monospaced))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(10)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .padding(24)
    }
}
