import Foundation

/// Settings the app and its share extension both read: the server address
/// and the season jobs the app follows. They live in the App Group's
/// defaults; without the group (the Mac preview, tests) they fall back to
/// the standard defaults.
public enum SharedStore {
    public static let appGroup = "group.com.courtscout.app"
    private static let sharedKeys = ["serverAddress", "seasonJobs"]

    public static let defaults: UserDefaults = {
        guard let shared = UserDefaults(suiteName: appGroup) else { return .standard }
        // Settings saved before the share extension existed move over once.
        for key in sharedKeys where shared.object(forKey: key) == nil {
            if let value = UserDefaults.standard.object(forKey: key) {
                shared.set(value, forKey: key)
            }
        }
        return shared
    }()
}
