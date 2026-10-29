import CourtScoutUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Safari's share sheet entry: reads the shared page link and shows
/// New season for it.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { @MainActor in
            let shared = await sharedText()
            let host = UIHostingController(rootView: ShareSeasonView(sharedText: shared) { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
            })
            addChild(host)
            host.view.frame = view.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.addSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    /// The first shared URL, or else the first shared text.
    private func sharedText() async -> String? {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        for type in [UTType.url, UTType.plainText] {
            for provider in providers where provider.hasItemConformingToTypeIdentifier(type.identifier) {
                if let item = try? await provider.loadItem(forTypeIdentifier: type.identifier) {
                    if let url = item as? URL { return url.absoluteString }
                    if let text = item as? String { return text }
                }
            }
        }
        return nil
    }
}
