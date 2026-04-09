import AppKit
import SwiftUI

final class MLXStudioAppDelegate: NSObject, NSApplicationDelegate {
    var onTerminate: (() -> Void)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // `swift run` often leaves Terminal as the active app. Force activation
        // so keyboard and pointer events land inside the macOS window instead.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            NSApp.windows.first?.makeKeyAndOrderFront(nil)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        onTerminate?()
    }
}

@main
struct MLXStudioApp: App {
    @NSApplicationDelegateAdaptor(MLXStudioAppDelegate.self) private var appDelegate
    @StateObject private var model = StudioViewModel(dependencies: .live())

    var body: some Scene {
        WindowGroup {
            RootSplitView(model: model)
                .frame(minWidth: 1120, minHeight: 760)
                .onAppear {
                    appDelegate.onTerminate = {
                        model.handleAppTermination()
                    }
                }
        }
        .defaultSize(width: 1280, height: 860)
        .windowToolbarStyle(.unifiedCompact)
    }
}
