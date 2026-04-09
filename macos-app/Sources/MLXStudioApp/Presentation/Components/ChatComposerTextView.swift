import AppKit
import SwiftUI

// SwiftUI's TextEditor can be finicky inside more complex macOS container
// hierarchies, so the chat composer uses a native NSTextView bridge to keep
// typing, IME input, selection, and scrolling behavior reliable.
struct ChatComposerTextView: NSViewRepresentable {
    static let contentHorizontalInset: CGFloat = 14
    static let contentVerticalInset: CGFloat = 7

    @Binding var text: String
    var isEditable: Bool
    var focusToken: Int = 0
    var onSubmitCommand: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.scrollerKnobStyle = .dark

        let textView = ComposerNSTextView()
        textView.delegate = context.coordinator
        textView.onSubmitCommand = onSubmitCommand
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.usesFindBar = true
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.font = NSFont.preferredFont(forTextStyle: .body)
        textView.textColor = NSColor.labelColor
        textView.insertionPointColor = NSColor.labelColor
        textView.textContainerInset = NSSize(
            width: Self.contentHorizontalInset,
            height: Self.contentVerticalInset
        )
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.lineFragmentPadding = 0
        textView.string = text

        scrollView.documentView = textView
        context.coordinator.textView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? ComposerNSTextView else {
            return
        }

        // Avoid resetting selection on every SwiftUI refresh by only writing
        // back into AppKit when the binding actually changed externally.
        if textView.string != text {
            textView.string = text
            let caret = NSRange(location: text.count, length: 0)
            textView.setSelectedRange(caret)
        }

        textView.isEditable = isEditable
        textView.onSubmitCommand = onSubmitCommand

        if context.coordinator.lastFocusToken != focusToken {
            context.coordinator.lastFocusToken = focusToken
            DispatchQueue.main.async {
                textView.window?.makeFirstResponder(textView)
                let caret = NSRange(location: textView.string.count, length: 0)
                textView.setSelectedRange(caret)
            }
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        @Binding private var text: String
        weak var textView: NSTextView?
        var lastFocusToken = 0

        init(text: Binding<String>) {
            _text = text
        }

        func textDidChange(_ notification: Notification) {
            guard let textView else {
                return
            }
            text = textView.string
        }
    }
}

private final class ComposerNSTextView: NSTextView {
    var onSubmitCommand: (() -> Void)?

    override var acceptsFirstResponder: Bool {
        true
    }

    override func keyDown(with event: NSEvent) {
        let keyCode = Int(event.keyCode)
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isReturnKey = keyCode == 36 || keyCode == 76

        guard isReturnKey else {
            super.keyDown(with: event)
            return
        }

        // Do not hijack Return while macOS is still composing marked text for
        // IME users; Return should first commit the in-progress composition.
        if hasMarkedText() {
            super.keyDown(with: event)
            return
        }

        let effectiveModifiers = modifiers.subtracting([.capsLock, .function, .numericPad])
        if effectiveModifiers.contains(.shift) {
            super.keyDown(with: event)
            return
        }

        if effectiveModifiers.isEmpty {
            onSubmitCommand?()
            return
        }

        super.keyDown(with: event)
    }
}
