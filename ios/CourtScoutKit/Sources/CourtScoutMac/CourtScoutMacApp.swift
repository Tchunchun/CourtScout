import AppKit
import CourtScoutUI
import SwiftUI

// Shows the iPhone UI in an iPhone 15-sized window for checking on a Mac
// without Xcode: swift run --package-path ios/CourtScoutKit court-scout-mac

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // `swift run` starts a bare executable; make it a normal foreground app.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
struct CourtScoutMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup("Court Scout") {
            CourtScoutRootView()
                .frame(width: 393, height: 852)
        }
        .windowResizability(.contentSize)
    }
}
