import Foundation

public enum APIError: LocalizedError, Equatable {
    case invalidServerURL(String)
    case http(status: Int, message: String)
    case notJSON

    public var errorDescription: String? {
        switch self {
        case .invalidServerURL(let value): "“\(value)” is not a valid server address."
        case .http(let status, let message): message.isEmpty ? "Server error \(status)." : message
        case .notJSON: "The server did not return JSON. Check the server address."
        }
    }
}

/// Fetches raw JSON from the Court Scout server. A protocol so the repository
/// can be checked against a stub without a network.
public protocol HTTPTransport: Sendable {
    func get(_ path: String, query: [URLQueryItem]) async throws -> Data
    func post(_ path: String, body: Data) async throws -> Data
}

public struct URLSessionTransport: HTTPTransport {
    public var baseURL: URL
    public var session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public init(serverAddress: String) throws {
        let trimmed = serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            let url = URL(string: trimmed),
            let scheme = url.scheme, ["http", "https"].contains(scheme),
            url.host() != nil
        else { throw APIError.invalidServerURL(serverAddress) }
        self.init(baseURL: url)
    }

    public func get(_ path: String, query: [URLQueryItem]) async throws -> Data {
        var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }
        return try await send(URLRequest(url: components.url!, timeoutInterval: 20))
    }

    public func post(_ path: String, body: Data) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: path), timeoutInterval: 20)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        var request = request
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError.http(status: status, message: message ?? "")
        }
        guard data.first.map({ $0 == UInt8(ascii: "{") || $0 == UInt8(ascii: "[") }) == true else {
            throw APIError.notJSON
        }
        return data
    }
}
