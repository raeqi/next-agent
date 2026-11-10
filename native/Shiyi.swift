// 拾遗.app：浮在所有窗口上方的桌宠 + 「眼睛」（只看微信窗口，本机 OCR）。
// 业务逻辑全部在本机 daemon（node daemon/main.mjs）里；这里只负责：
//   1) 透明置顶小窗，加载 http://127.0.0.1:7801/pet/
//   2) 每 2.5 秒：前台是微信且眼睛睁着 → 截微信窗口 → Vision OCR → POST /observe
//   3) 前台应用变化 → POST /focus（daemon 判断私密名单、更新桌宠状态）
// 构建：scripts/build-native.sh

import Cocoa
import WebKit
import Vision

let DAEMON = URL(string: "http://127.0.0.1:7801")!
let WECHAT_IDS: Set<String> = ["com.tencent.xinWeChat", "com.tencent.WeChat"]

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: PetPanel!
    var web: WKWebView!
    var timer: Timer?
    var lastHash: UInt64 = 0
    var eyesOn = true
    var busy = false
    var size = NSSize(width: 300, height: 210)
    var hitRects: [NSRect] = []          // 网页里可点的区域（左上角原点）；其余透明处点击穿透
    var dragging = false
    var hover: Timer?

    func applicationDidFinishLaunching(_ n: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "shiyi")
        web = WKWebView(frame: .zero, configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self

        panel = PetPanel(contentRect: NSRect(origin: .zero, size: size),
                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.contentView = web
        place()
        panel.orderFrontRegardless()
        loadPet()

        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(appChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
        timer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in self?.tick() }
        hover = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.updatePassThrough() }
        reportFocus(NSWorkspace.shared.frontmostApplication)
    }

    func loadPet() { web.load(URLRequest(url: DAEMON.appendingPathComponent("pet/"))) }

    // daemon 还没起来时，过 3 秒重试
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { retry() }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { retry() }
    func retry() { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.loadPet() } }

    /// 以右下角为锚点放置窗口（窗口变大变小时桌宠不动）；锚点可拖动并记住。
    func place() {
        guard let screen = NSScreen.main else { return }
        let v = screen.visibleFrame
        let d = UserDefaults.standard
        var right = d.object(forKey: "anchorRight") as? Double ?? Double(v.maxX - 12)
        var bottom = d.object(forKey: "anchorBottom") as? Double ?? Double(v.minY + 8)
        right = min(max(right, Double(v.minX) + Double(size.width)), Double(v.maxX))
        bottom = min(max(bottom, Double(v.minY)), Double(v.maxY) - Double(size.height))
        panel.setFrame(NSRect(x: right - Double(size.width), y: bottom, width: size.width, height: size.height), display: true)
    }

    /// 鼠标不在桌宠/气泡/面板上时，让点击穿透到下面的应用（比如微信的「发送」按钮）。
    func updatePassThrough() {
        if dragging { panel.ignoresMouseEvents = false; return }
        let m = NSEvent.mouseLocation, f = panel.frame
        let p = NSPoint(x: m.x - f.minX, y: f.maxY - m.y)
        panel.ignoresMouseEvents = !hitRects.contains { $0.insetBy(dx: -2, dy: -2).contains(p) }
    }

    // 网页 → 原生：{size:{w,h}} 调整窗口；{hit:[[x,y,w,h]]} 可点区域；{drag:{dx,dy}} / {dragEnd} 拖动；{eyes}；{focus}；{quit}
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let body = m.body as? [String: Any] else { return }
        if let rs = body["hit"] as? [[Double]] {
            hitRects = rs.filter { $0.count == 4 }.map { NSRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
        }
        if let d = body["drag"] as? [String: Any], let dx = d["dx"] as? Double, let dy = d["dy"] as? Double {
            dragging = true
            var f = panel.frame
            f.origin.x += dx; f.origin.y -= dy
            panel.setFrame(f, display: true)
        }
        if body["dragEnd"] as? Bool == true {
            dragging = false
            UserDefaults.standard.set(Double(panel.frame.maxX), forKey: "anchorRight")
            UserDefaults.standard.set(Double(panel.frame.minY), forKey: "anchorBottom")
        }
        if let s = body["size"] as? [String: Any], let w = s["w"] as? Double, let h = s["h"] as? Double {
            size = NSSize(width: w, height: h); place()
        }
        if let e = body["eyes"] as? Bool { eyesOn = e; lastHash = 0 }
        if body["focus"] as? Bool == true { NSApp.activate(ignoringOtherApps: true); panel.makeKey() }
        if body["quit"] as? Bool == true { NSApp.terminate(nil) }
    }

    @objc func appChanged(_ n: Notification) {
        reportFocus(n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
    }

    func reportFocus(_ app: NSRunningApplication?) {
        guard let app else { return }
        post("focus", ["bundle": app.bundleIdentifier ?? "", "name": app.localizedName ?? "",
                       "screenAccess": CGPreflightScreenCaptureAccess()])
    }

    // ── 眼睛 ──
    func tick() {
        guard eyesOn, !busy, let app = NSWorkspace.shared.frontmostApplication,
              let bid = app.bundleIdentifier, WECHAT_IDS.contains(bid) else { return }
        guard CGPreflightScreenCaptureAccess() else { return }
        guard let (wid, bounds) = mainWindow(pid: app.processIdentifier) else { return }
        guard let img = CGWindowListCreateImage(.null, .optionIncludingWindow, wid, [.boundsIgnoreFraming, .bestResolution]) else { return }
        let h = fingerprint(img)
        if h == lastHash { return }   // 画面没变，不 OCR
        lastHash = h
        busy = true
        DispatchQueue.global(qos: .utility).async {
            let lines = self.ocr(img)
            self.busy = false
            self.post("observe", [
                "app": "微信", "bundle": bid,
                "window": ["w": bounds.width, "h": bounds.height],
                "image": ["w": img.width, "h": img.height],
                "lines": lines,
            ])
        }
    }

    /// 该进程在屏幕上的最大普通窗口。
    func mainWindow(pid: pid_t) -> (CGWindowID, CGRect)? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var best: (CGWindowID, CGRect)?
        for w in list {
            guard (w[kCGWindowOwnerPID as String] as? pid_t) == pid,
                  (w[kCGWindowLayer as String] as? Int) == 0,
                  let id = w[kCGWindowNumber as String] as? CGWindowID,
                  let b = w[kCGWindowBounds as String] as? [String: Any],
                  let r = CGRect(dictionaryRepresentation: b as CFDictionary),
                  r.width > 400, r.height > 300 else { continue }
            if best == nil || r.width * r.height > best!.1.width * best!.1.height { best = (id, r) }
        }
        return best
    }

    /// 32×32 灰度缩略图的粗指纹，用来跳过没变化的画面。
    func fingerprint(_ img: CGImage) -> UInt64 {
        let n = 32
        var px = [UInt8](repeating: 0, count: n * n)
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return 0 }
        ctx.interpolationQuality = .low
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: n, height: n))
        var h: UInt64 = 1469598103934665603
        for p in px { h = (h ^ UInt64(p >> 3)) &* 1099511628211 }
        return h
    }

    /// Vision 本机 OCR。坐标转换成「左上角为原点、0~1 归一化」。
    func ocr(_ img: CGImage) -> [[String: Any]] {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.recognitionLanguages = ["zh-Hans", "en-US"]
        req.usesLanguageCorrection = true
        try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
        return (req.results ?? []).compactMap { o in
            guard let c = o.topCandidates(1).first else { return nil }
            let b = o.boundingBox
            return ["text": c.string, "conf": c.confidence,
                    "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height]
        }
    }

    func post(_ path: String, _ body: [String: Any]) {
        var req = URLRequest(url: DAEMON.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: req).resume()
    }
}

// 调试：Shiyi --ocr <图片>  → 打印 OCR 结果 JSON（不启动界面）
if CommandLine.arguments.count >= 3, CommandLine.arguments[1] == "--ocr" {
    guard let ns = NSImage(contentsOfFile: CommandLine.arguments[2]),
          let cg = ns.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("读不到图片"); exit(1) }
    let lines = AppDelegate().ocr(cg)
    let data = try! JSONSerialization.data(withJSONObject: ["image": ["w": cg.width, "h": cg.height], "lines": lines], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
