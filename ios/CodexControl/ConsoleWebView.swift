import SwiftUI
import WebKit
import CryptoKit
import Security
import SafariServices

struct ConsoleWebView: UIViewRepresentable {
    @ObservedObject var model: ConsoleModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        view.scrollView.backgroundColor = .systemBackground
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = false
        view.isInspectable = false
        model.webView = view
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        guard let connection = model.connection, context.coordinator.loadedConnection != connection else { return }
        context.coordinator.loadedConnection = connection
        view.stopLoading(); view.load(URLRequest(url: connection.url))
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let model: ConsoleModel
        var loadedConnection: ConsoleConnection?
        private var downloads: [ObjectIdentifier: URL] = [:]
        init(model: ConsoleModel) { self.model = model }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { model.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { model.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
        private func report(_ error: Error) {
            model.loading = false
            if (error as NSError).code != NSURLErrorCancelled { model.error = error.localizedDescription }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, let connection = loadedConnection else { decisionHandler(.cancel); return }
            if connection.owns(url) { decisionHandler(action.shouldPerformDownload ? .download : .allow); return }
            // Cross-origin redirects never receive the console's trusted certificate or Web storage.
            if action.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") {
                model.externalLink = PresentedURL(url: url)
            }
            decisionHandler(.cancel)
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard let url = response.response.url, loadedConnection?.owns(url) == true else { decisionHandler(.cancel); return }
            decisionHandler(response.canShowMIMEType ? .allow : .download)
        }
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.targetFrame == nil, let url = action.request.url {
                if loadedConnection?.owns(url) == true { webView.load(action.request) }
                else if ["http", "https"].contains(url.scheme ?? "") { model.externalLink = PresentedURL(url: url) }
            }
            return nil
        }
        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
                  let connection = loadedConnection,
                  challenge.protectionSpace.host.lowercased() == connection.url.host?.lowercased(),
                  challenge.protectionSpace.port == (connection.url.port ?? 443),
                  !connection.fingerprint.isEmpty else { completionHandler(.performDefaultHandling, nil); return }
            guard let trust = challenge.protectionSpace.serverTrust,
                  let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
                completionHandler(.cancelAuthenticationChallenge, nil); return
            }
            let actual = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
            guard actual == connection.fingerprint else {
                model.error = "电脑证书与保存的指纹不一致，请在电脑端核对后更新连接设置。"
                completionHandler(.cancelAuthenticationChallenge, nil); return
            }
            // The explicit leaf pin identifies this paired computer even when its LAN address changes.
            SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, nil))
            SecTrustSetAnchorCertificates(trust, [leaf] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            guard SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
            completionHandler(.useCredential, URLCredential(trust: trust))
        }
        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            guard let source = response.url, loadedConnection?.owns(source) == true else { completionHandler(nil); return }
            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ConsoleDownloads").appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let name = (suggestedFilename as NSString).lastPathComponent
                let file = directory.appendingPathComponent(name.isEmpty ? "download" : name)
                downloads[ObjectIdentifier(download)] = file; completionHandler(file)
            } catch { report(error); completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            if let file = downloads.removeValue(forKey: ObjectIdentifier(download)) { model.share = PresentedURL(url: file) }
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloads.removeValue(forKey: ObjectIdentifier(download)); report(error)
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
struct ExternalBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
