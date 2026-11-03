import UIKit
import WebKit
import AVFoundation
import Network

/// Baseer for iPhone: opens the Baseer web app full screen, with the camera and
/// microphone already allowed, so it starts listening as soon as it opens.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers])
        try? session.setActive(true)
        application.isIdleTimerDisabled = true // keep the screen on while Baseer is open

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = BaseerViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class BaseerViewController: UIViewController, WKUIDelegate, WKNavigationDelegate {
    static let home = URL(string: "https://sfertalain2003-stack.github.io/baseer/")!
    static let cream = UIColor(red: 0xf3 / 255, green: 0xeb / 255, blue: 0xdf / 255, alpha: 1)

    private var webView: WKWebView!
    private let retryButton = UIButton(type: .system)
    private var loadFailed = false
    private let network = NWPathMonitor()
    private var networkUp = true
    private var offline: OfflineViewController?

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.cream

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "BaseerApp/1.0"
        let flag = WKUserScript(source: "window.baseerNative = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(flag)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = Self.cream
        webView.scrollView.backgroundColor = Self.cream
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.uiDelegate = self
        webView.navigationDelegate = self
        view.addSubview(webView)

        retryButton.setTitle("ما في إنترنت. اضغط للمحاولة مرة ثانية\nNo internet. Tap to try again", for: .normal)
        retryButton.titleLabel?.numberOfLines = 0
        retryButton.titleLabel?.textAlignment = .center
        retryButton.titleLabel?.font = .systemFont(ofSize: 24, weight: .bold)
        retryButton.setTitleColor(UIColor(red: 0.66, green: 0.35, blue: 0.21, alpha: 1), for: .normal)
        retryButton.frame = view.bounds
        retryButton.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        retryButton.isHidden = true
        retryButton.addTarget(self, action: #selector(reload), for: .touchUpInside)
        view.addSubview(retryButton)

        // No internet: switch to the simple mode that runs on the phone; switch back when it returns.
        network.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self else { return }
                self.networkUp = path.status == .satisfied
                if self.networkUp { if self.offline != nil { self.leaveOffline() } }
                else { self.enterOffline() }
            }
        }
        network.start(queue: DispatchQueue(label: "baseer.network"))

        NotificationCenter.default.addObserver(self, selector: #selector(cameBack),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        reload()
    }

    @objc private func reload() {
        retryButton.isHidden = true
        loadFailed = false
        webView.load(URLRequest(url: Self.home, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    @objc private func cameBack() {
        if offline != nil, networkUp { leaveOffline() }
        else if loadFailed, offline == nil { reload() }
    }

    private func enterOffline() {
        guard offline == nil else { return }
        // Free the camera and microphone for the on-phone mode.
        webView.load(URLRequest(url: URL(string: "about:blank")!))
        let vc = OfflineViewController()
        addChild(vc)
        vc.view.frame = view.bounds
        vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(vc.view)
        vc.didMove(toParent: self)
        offline = vc
        retryButton.isHidden = true
        UIAccessibility.post(notification: .screenChanged, argument: vc.view)
    }

    private func leaveOffline() {
        guard let vc = offline else { return }
        vc.shutDown()
        vc.willMove(toParent: nil)
        vc.view.removeFromSuperview()
        vc.removeFromParent()
        offline = nil
        reload()
    }

    // Remember the chosen language, so the offline mode speaks it too.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.host == Self.home.host else { return }
        webView.evaluateJavaScript("localStorage.getItem('lang')") { value, _ in
            if let raw = value as? String {
                let lang = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                if !lang.isEmpty { UserDefaults.standard.set(lang, forKey: "baseerLang") }
            }
        }
    }

    // Camera and microphone: the person already said yes to the iPhone prompt, so don't ask again.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    // Phone calls, messages and maps open in their own apps.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let isBaseer = url.host == Self.home.host && url.path.hasPrefix("/baseer")
        if isBaseer || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
            return decisionHandler(.allow)
        }
        if navigationAction.targetFrame?.isMainFrame == false, url.scheme == "https" {
            return decisionHandler(.allow) // embedded frames
        }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    // Links that ask for a new window (target=_blank / window.open).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOffline()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }

    private func showOffline() {
        loadFailed = true
        enterOffline()
    }
}
