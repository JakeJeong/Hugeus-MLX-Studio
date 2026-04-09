import AppKit
import Foundation
import SwiftUI

struct StreamingMarkdownView: View {
    let rawText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(StreamingMarkdownParser.segments(from: rawText).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case let .markdown(text):
                    markdownBlock(text)
                case let .code(fileLabel, language, code, isPending):
                    codeBlock(fileLabel: fileLabel, language: language, code: code, isPending: isPending)
                }
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func markdownBlock(_ text: String) -> some View {
        let trimmed = StreamingMarkdownParser.sanitizedMarkdownBlock(text)
        if !trimmed.isEmpty {
            if let attributed = StreamingMarkdownParser.renderedMarkdown(from: trimmed) {
                Text(attributed)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(StudioTheme.label)
            } else {
                Text(trimmed)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(StudioTheme.label)
            }
        }
    }

    private func codeBlock(fileLabel: String?, language: String?, code: String, isPending: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let fileLabel, !fileLabel.isEmpty {
                Text(fileLabel)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(StudioTheme.label)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Text(language?.uppercased().isEmpty == false ? language!.uppercased() : "CODE")
                        .font(.caption.weight(.bold))
                        .tracking(1.1)
                        .foregroundStyle(StudioTheme.secondaryLabel)

                    if isPending {
                        Text("Streaming")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(StudioTheme.accent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(StudioTheme.accentSoft)
                            .clipShape(Capsule())
                    }

                    Spacer()

                    CodeCopyButton(copyText: code)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(StudioTheme.surface)

                Divider()
                    .overlay(StudioTheme.outline)

                ScrollView(.horizontal, showsIndicators: false) {
                    Text(code.isEmpty ? " " : code)
                        .font(.system(size: 13, weight: .regular, design: .monospaced))
                        .foregroundStyle(StudioTheme.label)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 14)
                }
                .background(StudioTheme.surfaceRaised.opacity(0.88))
            }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(StudioTheme.outline, lineWidth: 1)
            )
        }
    }
}

private enum StreamingMarkdownSegment {
    case markdown(String)
    case code(fileLabel: String?, language: String?, code: String, isPending: Bool)
}

private enum StreamingMarkdownParser {
    static func segments(from rawText: String) -> [StreamingMarkdownSegment] {
        let source = sanitize(rawText)
        guard !source.isEmpty else {
            return []
        }

        var segments: [StreamingMarkdownSegment] = []
        var cursor = source.startIndex

        while let fenceRange = source[cursor...].range(of: "```") {
            let prefix = String(source[cursor..<fenceRange.lowerBound])
            let (markdownPrefix, fileLabel) = splitTrailingFileLabel(from: prefix)
            if !markdownPrefix.isEmpty {
                segments.append(.markdown(markdownPrefix))
            }

            var contentStart = fenceRange.upperBound
            var language = ""

            while contentStart < source.endIndex && source[contentStart] != "\n" {
                language.append(source[contentStart])
                contentStart = source.index(after: contentStart)
            }

            if contentStart < source.endIndex && source[contentStart] == "\n" {
                contentStart = source.index(after: contentStart)
            }

            if let closingFence = source[contentStart...].range(of: "```") {
                let code = String(source[contentStart..<closingFence.lowerBound])
                segments.append(.code(fileLabel: fileLabel, language: language.nilIfEmpty, code: code, isPending: false))
                cursor = closingFence.upperBound
            } else {
                let code = String(source[contentStart...])
                segments.append(.code(fileLabel: fileLabel, language: language.nilIfEmpty, code: code, isPending: true))
                cursor = source.endIndex
                break
            }
        }

        if cursor < source.endIndex {
            let tail = String(source[cursor...])
            if !tail.isEmpty {
                segments.append(.markdown(tail))
            }
        }

        return mergeAdjacentMarkdownSegments(segments)
    }

    static func renderedMarkdown(from source: String) -> AttributedString? {
        if let attributed = try? AttributedString(
            markdown: source,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .full)
        ) {
            return attributed
        }

        return try? AttributedString(
            markdown: source,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )
    }

    static func sanitizedMarkdownBlock(_ rawBlock: String) -> String {
        rawBlock
            .replacingOccurrences(
                of: #"(?m)^[ \t]*(?:@@(?:path[ \t]+)?[^\n]+|path:\s*[^\n]+)[ \t]*\n?"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func sanitize(_ rawText: String) -> String {
        extractVisibleAssistantText(from: rawText)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(
                of: #"<think>[\s\S]*?(?:</think>|$)"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractVisibleAssistantText(from rawText: String) -> String {
        let normalized = rawText.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.contains("<|channel|>"),
              normalized.contains("<|message|>") else {
            return normalized
        }

        let pattern = #"<\|channel\|>([^<\r\n]+?)<\|message\|>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return normalized
        }

        let nsText = normalized as NSString
        let matches = regex.matches(
            in: normalized,
            options: [],
            range: NSRange(location: 0, length: nsText.length)
        )

        guard !matches.isEmpty else {
            return normalized
        }

        var preferred: [String] = []
        var fallback: [String] = []

        for index in matches.indices {
            let match = matches[index]
            guard match.numberOfRanges > 1 else { continue }

            let channel = nsText.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let start = match.range.location + match.range.length
            let end = index + 1 < matches.count ? matches[index + 1].range.location : nsText.length
            guard end >= start else { continue }

            let segment = nsText.substring(with: NSRange(location: start, length: end - start))
            if channel == "final" {
                preferred.append(segment)
            } else if !["analysis", "thought", "commentary"].contains(channel) {
                fallback.append(segment)
            }
        }

        if !preferred.isEmpty {
            return preferred.joined()
        }
        if !fallback.isEmpty {
            return fallback.joined()
        }
        return normalized
    }

    private static func mergeAdjacentMarkdownSegments(_ segments: [StreamingMarkdownSegment]) -> [StreamingMarkdownSegment] {
        var merged: [StreamingMarkdownSegment] = []

        for segment in segments {
            switch segment {
            case let .markdown(text):
                if case let .markdown(previous)? = merged.last {
                    merged.removeLast()
                    merged.append(.markdown(previous + text))
                } else {
                    merged.append(segment)
                }
            case .code:
                merged.append(segment)
            }
        }

        return merged
    }

    private static func splitTrailingFileLabel(from prefix: String) -> (markdown: String, fileLabel: String?) {
        let normalized = prefix.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard let lastContentLineIndex = lines.lastIndex(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            return (normalized, nil)
        }

        let candidate = lines[lastContentLineIndex].trimmingCharacters(in: .whitespacesAndNewlines)
        guard let fileLabel = normalizedFileLabel(from: candidate) else {
            return (normalized, nil)
        }

        var trimmedLines = lines
        trimmedLines.remove(at: lastContentLineIndex)
        let markdown = trimmedLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (markdown, fileLabel)
    }

    private static func normalizedFileLabel(from candidate: String) -> String? {
        if let pathMatch = candidate.wholeMatch(of: /@@path\s+(.+)/) {
            return String(pathMatch.1).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let pathMatch = candidate.wholeMatch(of: /path:\s*(.+)/) {
            return String(pathMatch.1).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        guard looksLikeFilePath(trimmed) else {
            return nil
        }
        return trimmed
    }

    private static func looksLikeFilePath(_ text: String) -> Bool {
        guard !text.isEmpty, !text.contains(" ") else {
            return false
        }

        let pattern = #"^(?:\.{1,2}/|/)?(?:[\w@.-]+/)*[\w@.-]+\.[A-Za-z0-9]{1,10}$"#
        return text.range(of: pattern, options: .regularExpression) != nil
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct CodeCopyButton: View {
    let copyText: String
    @State private var copied = false

    var body: some View {
        Button {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(copyText, forType: .string)
            copied = true

            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.2))
                copied = false
            }
        } label: {
            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(.caption.weight(.medium))
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(copyText.isEmpty)
    }
}
