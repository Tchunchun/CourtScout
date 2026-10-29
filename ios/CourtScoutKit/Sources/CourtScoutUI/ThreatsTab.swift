import CourtScoutCore
import SwiftUI

/// The opponent threat board: likely lineups with their weak spots, whether
/// the team stacks, its available players strongest first, and its pairs.
struct ThreatsTab: View {
    var model: TeamDetailModel

    var body: some View {
        if let board = model.threatBoard {
            VStack(alignment: .leading, spacing: 12) {
                if !board.coverage.isEmpty {
                    Card {
                        SectionLabel(text: "Read with care")
                        ForEach(board.coverage, id: \.self) { warning in
                            Label(warning, systemImage: "exclamationmark.triangle")
                                .font(.footnote)
                                .foregroundStyle(Palette.warning)
                        }
                    }
                }
                if !board.stacking.isEmpty {
                    Card {
                        SectionLabel(text: "Stacking")
                        ForEach(board.stacking) { read in
                            Label(read.note, systemImage: read.stacks ? "arrow.up.arrow.down" : "list.number")
                                .font(.subheadline)
                        }
                    }
                }
                ForEach(board.predictions) { prediction in
                    PredictionCard(prediction: prediction)
                }
                SectionLabel(text: "Players · \(board.eligibility.label ?? "") eligibility")
                ForEach(board.players) { player in
                    ThreatPlayerCard(player: player)
                }
                if !board.pairs.isEmpty {
                    Card {
                        SectionLabel(text: "Regular pairs")
                        ForEach(board.pairs) { pair in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pair.players.joined(separator: " / ")).font(.subheadline.weight(.medium))
                                    Text("\(pair.appearances)× together · \(pair.courts.joined(separator: ", "))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let record = pair.record {
                                    Text(record.display).font(.subheadline).monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
        } else {
            Card {
                Text(model.analysisError ?? "The threat board appears once the team's analysis is ready.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct PredictionCard: View {
    var prediction: ThreatBoard.Prediction

    var body: some View {
        Card {
            HStack {
                SectionLabel(text: "Likely lineup \(prediction.rank)")
                Spacer()
                Badge(text: "\(prediction.confidence.capitalized) confidence", color: Palette.accent)
            }
            ForEach(prediction.lines) { line in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(line.court)
                        .font(.caption.weight(.bold))
                        .frame(width: 28)
                        .padding(.vertical, 3)
                        .foregroundStyle(.white)
                        .background(Palette.brandStrong, in: RoundedRectangle(cornerRadius: 5))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(line.players.joined(separator: " / ")).font(.subheadline.weight(.medium))
                        Text("\(line.appearances)× here" + (line.record.map { " · \($0.display)" } ?? ""))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(line.gaps, id: \.self) { gap in
                            Text(gap).font(.caption).foregroundStyle(Palette.warning)
                        }
                    }
                }
            }
        }
    }
}

private struct ThreatPlayerCard: View {
    var player: ThreatBoard.Player

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(player.name).font(.headline)
                    Text([player.role, player.usualCourts.isEmpty ? nil : player.usualCourts.joined(separator: " / ")]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(Palette.brand)
                }
                Spacer()
                EligibilityBadge(status: player.status)
            }
            HStack(spacing: 16) {
                rating("DR", Format.rating(player.dr))
                rating("UTR S", player.utr.singles.display)
                rating("UTR D", player.utr.doubles.display)
            }
            Text(ratingSource)
                .font(.caption)
                .foregroundStyle(player.utr.source == "exact" ? Color.secondary : Palette.warning)
            if let partner = player.partner {
                Text("Usually with \(partner.name) (\(partner.appearances)×" + (partner.record.map { ", \($0.display)" } ?? "") + ")")
                    .font(.footnote)
            }
            if let note = player.note {
                Text(note).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .opacity(player.available ? 1 : 0.6)
    }

    private var ratingSource: String {
        let age = player.utr.ageDays.map { $0 == 0 ? ", today" : ", \(Format.count($0, "day")) old" } ?? ""
        switch player.utr.source {
        case "exact": return "Exact UTR\(age)"
        case "public": return "Public UTR band only\(age)"
        default: return "No UTR"
        }
    }

    private func rating(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
