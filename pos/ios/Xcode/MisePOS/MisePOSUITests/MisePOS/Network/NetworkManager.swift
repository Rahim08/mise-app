import Foundation
import Network
import Combine

// MARK: - Connection state

enum ConnectionState: Equatable {
    case searching        // mDNS poиск мастера
    case connecting       // TCP/WS handshake
    case authenticating   // Auth PIN
    case connected        // Всё OK
    case disconnected(reason: String)
}

// MARK: - NetworkManager

@MainActor
@Observable
final class NetworkManager {
    private(set) var state: ConnectionState = .searching
    private(set) var serverHost: String?
    private(set) var serverPort: Int?

    var resolvedHost: String? {
        guard let h = serverHost, let p = serverPort else { return nil }
        return "\(h):\(p)"
    }

    private var browser: NWBrowser?
    private var webSocket: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?

    var onMessage: ((ServerMessage) -> Void)?

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // MARK: - Discovery

    func startDiscovery() {
        state = .searching
        let params = NWParameters()
        params.includePeerToPeer = true

        let descriptor = NWBrowser.Descriptor.bonjourWithTXTRecord(
            type: "_mise-pos._tcp",
            domain: "local."
        )
        let browser = NWBrowser(for: descriptor, using: params)
        self.browser = browser

        browser.stateUpdateHandler = { [weak self] newState in
            Task { @MainActor in
                switch newState {
                case .failed(let error):
                    self?.state = .disconnected(reason: "Browser failed: \(error)")
                default:
                    break
                }
            }
        }

        browser.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                guard let self, let result = results.first else { return }
                if case .service(let name, _, let domain, _) = result.endpoint {
                    self.resolveService(name: name, domain: domain)
                }
            }
        }

        browser.start(queue: .global(qos: .userInitiated))
    }

    private func resolveService(name: String, domain: String) {
        let params = NWParameters.tcp
        let endpoint = NWEndpoint.service(name: name, type: "_mise-pos._tcp", domain: domain, interface: nil)
        let connection = NWConnection(to: endpoint, using: params)

        connection.stateUpdateHandler = { [weak self] state in
            if case .ready = state {
                if let innerEndpoint = connection.currentPath?.remoteEndpoint,
                   case .hostPort(let host, let port) = innerEndpoint {
                    let hostStr = "\(host)"
                    let portInt = Int(port.rawValue)
                    Task { @MainActor in
                        self?.connectWebSocket(host: hostStr, port: portInt)
                    }
                }
                connection.cancel()
            }
        }
        connection.start(queue: .global(qos: .userInitiated))
    }

    // MARK: - WebSocket

    func connectWebSocket(host: String, port: Int) {
        self.serverHost = host
        self.serverPort = port
        state = .connecting

        let url = URL(string: "ws://\(host):\(port)/ws")!
        urlSession = URLSession(configuration: .default)
        webSocket = urlSession?.webSocketTask(with: url)
        webSocket?.resume()

        state = .authenticating
        receiveLoop()
        startPingLoop()
    }

    func authenticate(deviceId: String, pin: String, role: String) {
        send(.auth(deviceId: deviceId, pin: pin, role: role))
    }

    // MARK: - Send

    func send(_ message: ClientMessage) {
        guard let ws = webSocket else { return }
        do {
            let data = try encoder.encode(message)
            let str = String(data: data, encoding: .utf8)!
            ws.send(.string(str)) { error in
                if let error {
                    print("[WS] Send error:", error)
                }
            }
        } catch {
            print("[WS] Encode error:", error)
        }
    }

    // MARK: - Receive loop

    private func receiveLoop() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleRaw(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleRaw(text)
                    }
                @unknown default:
                    break
                }
                self.receiveLoop()
            case .failure(let error):
                Task { @MainActor in
                    self.state = .disconnected(reason: error.localizedDescription)
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func handleRaw(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let msg = try decoder.decode(ServerMessage.self, from: data)
            Task { @MainActor in
                if case .authOk = msg { self.state = .connected }
                self.onMessage?(msg)
            }
        } catch {
            print("[WS] Decode error:", error, "raw:", text.prefix(200))
        }
    }

    // MARK: - Ping

    private func startPingLoop() {
        pingTask?.cancel()
        pingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                send(.ping)
            }
        }
    }

    // MARK: - Reconnect

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        reconnectTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            if let host = serverHost, let port = serverPort {
                connectWebSocket(host: host, port: port)
            } else {
                startDiscovery()
            }
        }
    }

    // MARK: - Disconnect

    func disconnect() {
        pingTask?.cancel()
        reconnectTask?.cancel()
        browser?.cancel()
        webSocket?.cancel(with: .goingAway, reason: nil)
        state = .disconnected(reason: "Manual disconnect")
    }
}
