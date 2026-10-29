import Foundation

/// Any JSON value. Used for schema objects with no declared shape and for
/// keys a schema object allows but does not declare.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}

struct AnyCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }

    init(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        nil
    }
}

extension Decoder {
    func additionalProperties<Keys: CodingKey & CaseIterable>(
        excluding _: Keys.Type
    ) throws -> [String: JSONValue] {
        let known = Set(Keys.allCases.map(\.stringValue))
        let container = try container(keyedBy: AnyCodingKey.self)
        var extras: [String: JSONValue] = [:]
        for key in container.allKeys where !known.contains(key.stringValue) {
            extras[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        return extras
    }
}

extension Encoder {
    func encodeAdditionalProperties(_ extras: [String: JSONValue]) throws {
        guard !extras.isEmpty else { return }
        var container = container(keyedBy: AnyCodingKey.self)
        for (key, value) in extras {
            try container.encode(value, forKey: AnyCodingKey(stringValue: key))
        }
    }
}
