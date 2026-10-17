import Foundation
import Combine
import WebKit

struct ConsoleConnection: Codable, Equatable {
    let url: URL
    let fingerprint: String
    func owns(_ candidate: URL) -> Bool {
        candidate.scheme == url.scheme && candidate.host?.lowercased() == url.host?.lowercased()
            && (candidate.port ?? 443) == (url.port ?? 443)
    }
}
struct PresentedURL: Identifiable { let id = UUID(); let url: URL }

@MainActor final class ConsoleModel: ObservableObject {
    @Published var connection: ConsoleConnection?
    @Published var loading = false
    @Published var error: String?
    @Published var share: PresentedURL?
    @Published var externalLink: PresentedURL?
    weak var webView: WKWebView?

    init() {
        if let data = UserDefaults.standard.data(forKey: "console.connection") {
            connection = try? JSONDecoder().decode(ConsoleConnection.self, from: data)
        }
    }
    func connect(address: String, fingerprint: String) throws {
        guard var parts = URLComponents(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme?.lowercased() == "https", parts.host?.isEmpty == false,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil else {
            throw ConnectionError.invalidAddress
        }
        parts.scheme = "https"; parts.path = "/console"
        let pin = fingerprint.lowercased().replacingOccurrences(of: ":", with: "").filter { !$0.isWhitespace }
        guard pin.isEmpty || pin.count == 64 && pin.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw ConnectionError.invalidFingerprint
        }
        guard let url = parts.url else { throw ConnectionError.invalidAddress }
        let next = ConsoleConnection(url: url, fingerprint: pin)
        UserDefaults.standard.set(try JSONEncoder().encode(next), forKey: "console.connection")
        connection = next; error = nil
    }
    func reload() { webView?.reload() }
    func goHome() { if let url = connection?.url { webView?.load(URLRequest(url: url)) } }
    func resume() {
        // Retain the page, its uploads and drafts; the existing Web client reconnects its socket.
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))", completionHandler: nil)
    }
    enum ConnectionError: LocalizedError {
        case invalidAddress, invalidFingerprint
        var errorDescription: String? {
            switch self {
            case .invalidAddress: return "请输入完整的 HTTPS 网关地址，不包含账号、参数或片段。"
            case .invalidFingerprint: return "证书指纹应为 64 位十六进制 SHA-256。"
            }
        }
    }
}
