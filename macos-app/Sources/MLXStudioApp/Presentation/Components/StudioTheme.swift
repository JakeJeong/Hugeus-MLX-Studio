import AppKit
import SwiftUI

enum StudioTheme {
    static let accent = Color(hex: "#4C94FF")
    static let accentSoft = Color(hex: "#4C94FF", alpha: 0.18)
    static let success = Color(hex: "#45D67F")
    static let canvasTop = Color(hex: "#171C29")
    static let canvasBottom = Color(hex: "#0D1017")
    static let sidebarTop = Color(hex: "#191E2E", alpha: 0.96)
    static let sidebarBottom = Color(hex: "#111420", alpha: 0.96)
    static let surface = Color(hex: "#1C202B", alpha: 0.94)
    static let surfaceRaised = Color(hex: "#272B38", alpha: 0.94)
    static let surfaceMuted = Color(hex: "#2E3340", alpha: 0.90)
    static let outline = Color.white.opacity(0.07)
    static let subtleOutline = Color.white.opacity(0.04)
    static let label = Color.white.opacity(0.96)
    static let secondaryLabel = Color.white.opacity(0.58)
    static let tertiaryLabel = Color.white.opacity(0.40)
    static let userBubbleTop = Color(hex: "#4A8BF9")
    static let userBubbleBottom = Color(hex: "#386CE0")
    static let assistantBubble = Color(hex: "#2B2F3A", alpha: 0.98)
    static let shadow = Color.black.opacity(0.28)

    static let canvasGradient = LinearGradient(
        colors: [canvasTop, canvasBottom],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let sidebarGradient = LinearGradient(
        colors: [sidebarTop, sidebarBottom],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let userBubbleGradient = LinearGradient(
        colors: [userBubbleTop, userBubbleBottom],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let codePlain = NSColor(hex: "#E6EBF5")
    static let codeKeyword = NSColor(hex: "#84B5FF")
    static let codeType = NSColor(hex: "#FACF7B")
    static let codeString = NSColor(hex: "#F7A76D")
    static let codeComment = NSColor(hex: "#75B783")
    static let codeNumber = NSColor(hex: "#65D9D2")
    static let codeAnnotation = NSColor(hex: "#D98AF7")
    static let codeSymbol = NSColor(hex: "#CAD3E2")
}

struct StudioPanelModifier: ViewModifier {
    var fill: Color = StudioTheme.surface
    var cornerRadius: CGFloat = 24
    var stroke: Color = StudioTheme.outline

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
            .shadow(color: StudioTheme.shadow, radius: 18, x: 0, y: 10)
    }
}

struct StudioCardModifier: ViewModifier {
    var fill: Color = StudioTheme.surfaceRaised
    var cornerRadius: CGFloat = 20

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(StudioTheme.subtleOutline, lineWidth: 1)
            )
    }
}

extension View {
    // Shared surface helpers keep the visual language consistent as the app grows.
    func studioPanel(fill: Color = StudioTheme.surface, cornerRadius: CGFloat = 24) -> some View {
        modifier(StudioPanelModifier(fill: fill, cornerRadius: cornerRadius))
    }

    func studioCard(fill: Color = StudioTheme.surfaceRaised, cornerRadius: CGFloat = 20) -> some View {
        modifier(StudioCardModifier(fill: fill, cornerRadius: cornerRadius))
    }
}

private extension Color {
    init(hex: String, alpha: Double = 1.0) {
        self.init(nsColor: NSColor(hex: hex, alpha: alpha))
    }
}

private extension NSColor {
    convenience init(hex: String, alpha: Double = 1.0) {
        let sanitized = hex
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")
        let value = UInt64(sanitized, radix: 16) ?? 0
        let red = CGFloat((value >> 16) & 0xFF) / 255
        let green = CGFloat((value >> 8) & 0xFF) / 255
        let blue = CGFloat(value & 0xFF) / 255

        self.init(
            calibratedRed: red,
            green: green,
            blue: blue,
            alpha: alpha
        )
    }
}
