import AppKit
import Foundation

struct Palette {
    static let outerTop = NSColor(calibratedRed: 0.06, green: 0.10, blue: 0.20, alpha: 1.0)
    static let outerBottom = NSColor(calibratedRed: 0.17, green: 0.32, blue: 0.58, alpha: 1.0)
    static let innerTop = NSColor(calibratedRed: 0.12, green: 0.16, blue: 0.28, alpha: 0.96)
    static let innerBottom = NSColor(calibratedRed: 0.09, green: 0.12, blue: 0.21, alpha: 0.96)
    static let cyan = NSColor(calibratedRed: 0.39, green: 0.81, blue: 1.0, alpha: 1.0)
    static let blue = NSColor(calibratedRed: 0.29, green: 0.58, blue: 1.0, alpha: 1.0)
    static let mint = NSColor(calibratedRed: 0.37, green: 0.93, blue: 0.67, alpha: 1.0)
    static let text = NSColor(calibratedRed: 0.95, green: 0.97, blue: 1.0, alpha: 1.0)
    static let panelStroke = NSColor(calibratedWhite: 1.0, alpha: 0.11)
}

func drawBackground(in bounds: NSRect) {
    let outerRadius = bounds.width * 0.225
    let outerPath = NSBezierPath(roundedRect: bounds, xRadius: outerRadius, yRadius: outerRadius)
    let outerGradient = NSGradient(colors: [Palette.outerTop, Palette.outerBottom])!
    outerGradient.draw(in: outerPath, angle: -55)

    let glowOne = NSBezierPath(ovalIn: NSRect(
        x: bounds.width * 0.08,
        y: bounds.height * 0.56,
        width: bounds.width * 0.56,
        height: bounds.height * 0.56
    ))
    NSGraphicsContext.saveGraphicsState()
    glowOne.addClip()
    let radial = NSGradient(starting: Palette.cyan.withAlphaComponent(0.22), ending: .clear)!
    radial.draw(in: glowOne, relativeCenterPosition: .zero)
    NSGraphicsContext.restoreGraphicsState()

    let glowTwo = NSBezierPath(ovalIn: NSRect(
        x: bounds.width * 0.44,
        y: bounds.height * 0.08,
        width: bounds.width * 0.42,
        height: bounds.height * 0.42
    ))
    NSGraphicsContext.saveGraphicsState()
    glowTwo.addClip()
    let radialTwo = NSGradient(starting: Palette.blue.withAlphaComponent(0.28), ending: .clear)!
    radialTwo.draw(in: glowTwo, relativeCenterPosition: .zero)
    NSGraphicsContext.restoreGraphicsState()

    let inset = bounds.insetBy(dx: bounds.width * 0.075, dy: bounds.height * 0.075)
    let innerPath = NSBezierPath(roundedRect: inset, xRadius: bounds.width * 0.16, yRadius: bounds.width * 0.16)
    let innerGradient = NSGradient(colors: [Palette.innerTop, Palette.innerBottom])!
    innerGradient.draw(in: innerPath, angle: 90)

    Palette.panelStroke.setStroke()
    innerPath.lineWidth = max(1.0, bounds.width * 0.012)
    innerPath.stroke()
}

func drawSymbol(
    name: String,
    pointSize: CGFloat,
    weight: NSFont.Weight,
    color: NSColor,
    in rect: NSRect,
    rotation: CGFloat = 0
) {
    guard let image = NSImage(systemSymbolName: name, accessibilityDescription: nil) else {
        return
    }
    let sizeConfig = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
    let colorConfig = NSImage.SymbolConfiguration(hierarchicalColor: color)
    let combinedConfig = sizeConfig.applying(colorConfig)
    let configured = image.withSymbolConfiguration(combinedConfig) ?? image

    NSGraphicsContext.saveGraphicsState()
    let transform = NSAffineTransform()
    transform.translateX(by: rect.midX, yBy: rect.midY)
    if rotation != 0 {
        transform.rotate(byDegrees: rotation)
    }
    transform.translateX(by: -rect.midX, yBy: -rect.midY)
    transform.concat()
    configured.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1.0)
    NSGraphicsContext.restoreGraphicsState()
}

func drawForeground(in bounds: NSRect) {
    let shadow = NSShadow()
    shadow.shadowBlurRadius = bounds.width * 0.05
    shadow.shadowOffset = NSSize(width: 0, height: -bounds.width * 0.02)
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)

    let cpuRect = NSRect(
        x: bounds.width * 0.24,
        y: bounds.height * 0.28,
        width: bounds.width * 0.44,
        height: bounds.height * 0.44
    )
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    drawSymbol(
        name: "cpu.fill",
        pointSize: bounds.width * 0.28,
        weight: .medium,
        color: Palette.text.withAlphaComponent(0.96),
        in: cpuRect
    )
    NSGraphicsContext.restoreGraphicsState()

    let bubbleBounds = NSRect(
        x: bounds.width * 0.53,
        y: bounds.height * 0.18,
        width: bounds.width * 0.22,
        height: bounds.height * 0.22
    )
    let bubblePath = NSBezierPath(roundedRect: bubbleBounds, xRadius: bounds.width * 0.09, yRadius: bounds.width * 0.09)
    let bubbleGradient = NSGradient(colors: [Palette.cyan, Palette.blue])!
    bubbleGradient.draw(in: bubblePath, angle: -35)

    let bubbleSymbolRect = bubbleBounds.insetBy(dx: bounds.width * 0.034, dy: bounds.height * 0.034)
    drawSymbol(
        name: "ellipsis.message.fill",
        pointSize: bounds.width * 0.11,
        weight: .semibold,
        color: NSColor.white.withAlphaComponent(0.95),
        in: bubbleSymbolRect
    )

    let dotRect = NSRect(
        x: bounds.width * 0.2,
        y: bounds.height * 0.66,
        width: bounds.width * 0.11,
        height: bounds.width * 0.11
    )
    let dotPath = NSBezierPath(ovalIn: dotRect)
    Palette.mint.setFill()
    dotPath.fill()

    let ringRect = dotRect.insetBy(dx: -bounds.width * 0.022, dy: -bounds.width * 0.022)
    let ringPath = NSBezierPath(ovalIn: ringRect)
    Palette.mint.withAlphaComponent(0.18).setStroke()
    ringPath.lineWidth = max(1.0, bounds.width * 0.012)
    ringPath.stroke()

    let sparkleRect = NSRect(
        x: bounds.width * 0.62,
        y: bounds.height * 0.63,
        width: bounds.width * 0.15,
        height: bounds.width * 0.15
    )
    drawSymbol(
        name: "sparkle",
        pointSize: bounds.width * 0.1,
        weight: .bold,
        color: Palette.cyan.withAlphaComponent(0.95),
        in: sparkleRect,
        rotation: 12
    )
}

func pngData(for size: CGFloat) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(size),
        pixelsHigh: Int(size),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        return nil
    }

    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    guard let context = NSGraphicsContext(bitmapImageRep: rep) else {
        return nil
    }
    NSGraphicsContext.current = context

    let bounds = NSRect(x: 0, y: 0, width: size, height: size)
    drawBackground(in: bounds)
    drawForeground(in: bounds)
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    return rep.representation(using: .png, properties: [:])
}

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: render_app_icon.swift <output-dir>\n", stderr)
    exit(1)
}

let outputDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let manager = FileManager.default
try manager.createDirectory(at: outputDir, withIntermediateDirectories: true)

let entries: [(String, CGFloat)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (filename, size) in entries {
    guard let data = pngData(for: size) else {
        fputs("failed to render \(filename)\n", stderr)
        exit(1)
    }
    try data.write(to: outputDir.appendingPathComponent(filename))
}
