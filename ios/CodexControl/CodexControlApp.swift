import SwiftUI

@main
struct CodexControlApp: App {
    var body: some Scene { WindowGroup { ConsoleShell() } }
}

struct ConsoleShell: View {
    @StateObject private var model = ConsoleModel()
    @State private var connecting = false
    @State private var address = ""
    @State private var fingerprint = ""
    @State private var formError = ""
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground).ignoresSafeArea()
            if model.connection != nil {
                ConsoleWebView(model: model)
            } else {
                ContentUnavailableView {
                    Label("连接你的电脑", systemImage: "desktopcomputer")
                } description: {
                    Text("打开电脑上的 Codex Control，输入网关地址后配对。")
                } actions: {
                    Button("连接电脑", action: openConnection).buttonStyle(.borderedProminent)
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 12) {
                Button(action: openConnection) {
                    Label(model.connection?.url.host ?? "Codex Control", systemImage: "desktopcomputer")
                        .font(.subheadline.weight(.medium)).lineLimit(1)
                }.accessibilityLabel("连接电脑")
                Spacer(minLength: 8)
                if model.loading { ProgressView().controlSize(.small) }
                Menu {
                    Button("连接电脑", systemImage: "network", action: openConnection)
                    Button("重新加载", systemImage: "arrow.clockwise") { model.reload() }
                    Button("回到控制台", systemImage: "house") { model.goHome() }
                } label: { Image(systemName: "ellipsis").frame(width: 28, height: 28) }
                .accessibilityLabel("控制台菜单")
            }
            .padding(.horizontal, 16).padding(.vertical, verticalSizeClass == .compact ? 4 : 10)
            .nativeGlass().padding(.horizontal, 12).padding(.vertical, 6)
        }
        .sheet(isPresented: $connecting) {
            NavigationStack {
                Form {
                    Section("电脑地址") {
                        TextField("https://电脑地址:38457", text: $address)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Text("使用电脑网关显示的 HTTPS 地址。配对码在控制台中输入。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("证书指纹") {
                        TextField("SHA-256（局域网自签名证书需要）", text: $fingerprint, axis: .vertical)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().font(.system(.footnote, design: .monospaced))
                        Text("从电脑端复制 SHA-256 指纹。使用受系统信任的证书时可留空。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if !formError.isEmpty { Text(formError).foregroundStyle(.red) }
                    Button("打开控制台") {
                        do { try model.connect(address: address, fingerprint: fingerprint); connecting = false }
                        catch { formError = error.localizedDescription }
                    }.disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .navigationTitle("连接电脑").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { connecting = false } } }
            }
            .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
        }
        .sheet(item: $model.share) { item in ShareSheet(url: item.url) }
        .sheet(item: $model.externalLink) { item in ExternalBrowser(url: item.url) }
        .alert("连接提示", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("连接设置", action: openConnection)
            Button("关闭", role: .cancel) { model.error = nil }
        } message: { Text(model.error ?? "") }
        .onChange(of: scenePhase) { _, phase in if phase == .active { model.resume() } }
    }
    private func openConnection() {
        address = model.connection?.url.absoluteString ?? ""
        fingerprint = model.connection?.fingerprint ?? ""
        formError = ""; connecting = true
    }
}

private extension View {
    @ViewBuilder func nativeGlass() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: RoundedRectangle(cornerRadius: 26))
        } else {
            self.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 26))
        }
    }
}
