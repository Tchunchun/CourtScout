import CourtScoutCore
import SwiftUI

/// Colors from the web app's Modern Hard Court tokens (web/public/styles.css).
enum Palette {
    static let brand = Color(red: 7 / 255, green: 93 / 255, blue: 170 / 255)
    static let brandStrong = Color(red: 6 / 255, green: 73 / 255, blue: 132 / 255)
    static let accent = Color(red: 18 / 255, green: 165 / 255, blue: 148 / 255)
    static let success = Color(red: 22 / 255, green: 129 / 255, blue: 95 / 255)
    static let warning = Color(red: 208 / 255, green: 95 / 255, blue: 59 / 255)
    static let error = Color(red: 185 / 255, green: 66 / 255, blue: 50 / 255)
}

enum Format {
    private static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    /// "2026-04-10" or an ISO date-time → "Apr 10, 2026".
    static func day(_ value: String?) -> String {
        guard let value, let date = isoDay.date(from: String(value.prefix(10))) else { return value ?? "—" }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: TimeZone(identifier: "UTC")!))
    }

    static func rating(_ value: Double?) -> String {
        value.map { String(format: "%.2f", $0) } ?? "—"
    }

    static func percent(_ value: Double?) -> String {
        value.map { "\(Int(($0 * 100).rounded()))%" } ?? "—"
    }

    /// Today as "yyyy-MM-dd" in the device's time zone, for comparing with schedule dates.
    static func today() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: .now)
    }

    static func count(_ value: Int, _ singular: String, plural: String? = nil) -> String {
        "\(value) \(value == 1 ? singular : plural ?? singular + "s")"
    }

    private static let sourceNames = [
        "tennisrecord": "TennisRecord",
        "usta_tennislink": "USTA TennisLink",
        "utr_sports": "UTR",
        "utr_sports_public_profiles": "UTR (public)",
        "utr_sports_public_opponent_lookup": "UTR opponents (public)",
        "utr_sports_authenticated_profiles": "UTR (signed in)",
        "utr_sports_authenticated_opponent_profiles": "UTR opponents (signed in)",
        "world_tennis_number_public_profiles": "WTN (public)"
    ]

    static func source(_ type: String) -> String {
        sourceNames[type] ?? phase(type)
    }

    static func phase(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.quaternary))
    }
}

struct SectionLabel: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(1.2)
            .foregroundStyle(Palette.brand)
    }
}

struct Badge: View {
    var text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
    }
}

struct ResultBadge: View {
    var result: String

    var body: some View {
        let color = result == "W" ? Palette.success : result == "L" ? Palette.error : .secondary
        Text(result)
            .font(.caption.weight(.heavy))
            .frame(width: 24, height: 24)
            .foregroundStyle(.white)
            .background(color, in: RoundedRectangle(cornerRadius: 6))
    }
}

struct EligibilityBadge: View {
    var status: String

    var body: some View {
        switch status {
        case "eligible": Badge(text: "Eligible", color: Palette.success)
        case "ineligible": Badge(text: "Not eligible", color: Palette.warning)
        case "unavailable": Badge(text: "Unavailable", color: Palette.error)
        default: Badge(text: status.capitalized, color: .secondary)
        }
    }
}

struct Stat: View {
    var label: String
    var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title2.weight(.bold)).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct OfflineBanner: View {
    var savedAt: Date

    var body: some View {
        Label(
            "Offline — showing the copy saved \(savedAt.formatted(.relative(presentation: .named)))",
            systemImage: "wifi.slash"
        )
        .font(.footnote.weight(.medium))
        .foregroundStyle(Palette.warning)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct LoadFailedView: View {
    var message: String
    var retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Couldn’t load", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: retry).buttonStyle(.borderedProminent)
        }
    }
}
