import UIKit
import AVFoundation
import Speech
import Vision
import CoreImage

/// Baseer without internet: everything here runs on the iPhone itself.
/// Simpler than the online mode: reads text, names common things and people, and tells colours.
final class OfflineViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVSpeechSynthesizerDelegate {

    // MARK: Language and words

    /// The language the person chose in Baseer (saved when the online page was last open).
    private let isArabic: Bool = {
        let saved = UserDefaults.standard.string(forKey: "baseerLang") ?? Locale.preferredLanguages.first ?? "ar"
        return saved.hasPrefix("ar")
    }()
    private func s(_ ar: String, _ en: String) -> String { isArabic ? ar : en }

    // MARK: Views

    private let statusLabel = UILabel()
    private let describeButton = UIButton(type: .custom)
    private let readButton = UIButton(type: .system)
    private let colorButton = UIButton(type: .system)
    private let resultLabel = UILabel()

    // MARK: Camera, voice, speech

    private let session = AVCaptureSession()
    private let videoQueue = DispatchQueue(label: "baseer.offline.video")
    private var latestFrame: CVPixelBuffer?
    private let frameLock = NSLock()

    private let synthesizer = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var canListen = false
    private var working = false
    private var lastSpoken = ""
    private var stopped = false
    private var lastUnknownLabels: [String] = []
    // When the phone can't recognise words offline, any spoken sentence counts as "what's this?".
    private var soundMode = false
    private var loudBuffers = 0
    private var quietBuffers = 0

    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    // MARK: Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = BaseerViewController.cream
        view.semanticContentAttribute = isArabic ? .forceRightToLeft : .forceLeftToRight
        synthesizer.delegate = self
        buildViews()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        stopped = false
        startCamera()
        say(s("ما في إنترنت. أشتغل بالوضع البسيط: قول «ما هذا؟» أو «اقرأ» أو «الألوان»، أو المس الدائرة.",
              "No internet. I'm in simple mode: say \"what's this\", \"read\" or \"colours\", or touch the circle."))
        prepareListening()
    }

    /// Called before this screen is removed (internet is back).
    func shutDown() {
        stopped = true
        stopListening()
        synthesizer.stopSpeaking(at: .immediate)
        videoQueue.async { [session] in if session.isRunning { session.stopRunning() } }
    }

    // MARK: Layout

    private func buildViews() {
        let accent = UIColor(red: 0xa8 / 255, green: 0x5a / 255, blue: 0x36 / 255, alpha: 1)
        let ink = UIColor(red: 0x2e / 255, green: 0x1f / 255, blue: 0x14 / 255, alpha: 1)
        let card = UIColor(red: 0xfb / 255, green: 0xf6 / 255, blue: 0xef / 255, alpha: 1)

        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? ""
        statusLabel.text = s("بدون إنترنت · الوضع البسيط", "No internet · Simple mode") + "  ·  \(build)"
        statusLabel.accessibilityLabel = s("بدون إنترنت، الوضع البسيط", "No internet, simple mode")
        statusLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        statusLabel.textColor = ink
        statusLabel.textAlignment = .center
        statusLabel.backgroundColor = card
        statusLabel.layer.cornerRadius = 22
        statusLabel.clipsToBounds = true
        statusLabel.accessibilityTraits = .header

        describeButton.backgroundColor = accent
        describeButton.setTitle(s("ما هذا؟", "What's this?"), for: .normal)
        describeButton.setTitleColor(.white, for: .normal)
        describeButton.titleLabel?.font = .systemFont(ofSize: 44, weight: .bold)
        describeButton.titleLabel?.adjustsFontSizeToFitWidth = true
        describeButton.accessibilityLabel = s("ما هذا؟ يوصف الأشياء والأشخاص أمامك", "What's this? Names things and people in front of you")
        describeButton.addTarget(self, action: #selector(describeTapped), for: .touchUpInside)

        for (button, title, action) in [(readButton, s("اقرأ", "Read"), #selector(readTapped)),
                                        (colorButton, s("الألوان", "Colours"), #selector(colorTapped))] {
            button.setTitle(title, for: .normal)
            button.setTitleColor(ink, for: .normal)
            button.titleLabel?.font = .systemFont(ofSize: 26, weight: .bold)
            button.backgroundColor = card
            button.layer.cornerRadius = 24
            button.addTarget(self, action: action, for: .touchUpInside)
        }

        resultLabel.numberOfLines = 0
        resultLabel.font = .systemFont(ofSize: 22, weight: .semibold)
        resultLabel.textColor = ink
        resultLabel.textAlignment = isArabic ? .right : .left
        resultLabel.accessibilityTraits = .updatesFrequently

        let buttons = UIStackView(arrangedSubviews: [readButton, colorButton])
        buttons.axis = .horizontal
        buttons.spacing = 14
        buttons.distribution = .fillEqually

        for v in [statusLabel, describeButton, buttons, resultLabel] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(v)
        }
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            statusLabel.topAnchor.constraint(equalTo: g.topAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            statusLabel.heightAnchor.constraint(equalToConstant: 48),

            describeButton.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 28),
            describeButton.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            describeButton.widthAnchor.constraint(equalTo: g.widthAnchor, multiplier: 0.78),
            describeButton.heightAnchor.constraint(equalTo: describeButton.widthAnchor),

            buttons.topAnchor.constraint(equalTo: describeButton.bottomAnchor, constant: 28),
            buttons.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            buttons.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            buttons.heightAnchor.constraint(equalToConstant: 96),

            resultLabel.topAnchor.constraint(equalTo: buttons.bottomAnchor, constant: 20),
            resultLabel.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 20),
            resultLabel.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -20),
            resultLabel.bottomAnchor.constraint(lessThanOrEqualTo: g.bottomAnchor, constant: -16),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        describeButton.layer.cornerRadius = describeButton.bounds.width / 2
    }

    // MARK: Camera

    private func startCamera() {
        videoQueue.async { [weak self] in
            guard let self else { return }
            if self.session.inputs.isEmpty {
                self.session.beginConfiguration()
                self.session.sessionPreset = .high
                if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                   let input = try? AVCaptureDeviceInput(device: device),
                   self.session.canAddInput(input) {
                    self.session.addInput(input)
                }
                let output = AVCaptureVideoDataOutput()
                output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                output.alwaysDiscardsLateVideoFrames = true
                output.setSampleBufferDelegate(self, queue: self.videoQueue)
                if self.session.canAddOutput(output) { self.session.addOutput(output) }
                self.session.commitConfiguration()
            }
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        frameLock.lock(); latestFrame = buffer; frameLock.unlock()
    }

    private func currentFrame() -> CVPixelBuffer? {
        frameLock.lock(); defer { frameLock.unlock() }
        return latestFrame
    }

    // MARK: Actions

    @objc private func describeTapped() { run(.describe) }
    @objc private func readTapped() { run(.read) }
    @objc private func colorTapped() { run(.colors) }

    private enum Job { case describe, read, colors }

    private func run(_ task: Job) {
        guard !working else { return }
        guard let frame = currentFrame() else {
            say(s("الكاميرا ما اشتغلت بعد. جرب بعد ثانية.", "The camera isn't ready yet. Try again in a second."))
            return
        }
        working = true
        stopListening()
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let answer: String
            switch task {
            case .describe: answer = self.describe(frame)
            case .read: answer = self.read(frame)
            case .colors: answer = self.colors(frame)
            }
            DispatchQueue.main.async {
                self.working = false
                let extra = task == .describe && !self.lastUnknownLabels.isEmpty ? "\n(" + self.lastUnknownLabels.joined(separator: ", ") + ")" : ""
                self.show(answer + extra)
                self.say(answer)
            }
        }
    }

    // MARK: Reading text (Apple's on-device text recognition)

    private func read(_ frame: CVPixelBuffer) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(iOS 16.0, *) { request.automaticallyDetectsLanguage = true }
        if let supported = try? request.supportedRecognitionLanguages() {
            let wanted = (isArabic ? ["ar-SA", "en-US"] : ["en-US", "ar-SA"]).filter(supported.contains)
            if !wanted.isEmpty { request.recognitionLanguages = wanted }
        }
        let handler = VNImageRequestHandler(cvPixelBuffer: frame, orientation: .right, options: [:])
        do { try handler.perform([request]) } catch {
            return s("ما قدرت أقرأ. جرب مرة ثانية.", "I couldn't read that. Please try again.")
        }
        let lines = (request.results ?? [])
            .filter { ($0.topCandidates(1).first?.confidence ?? 0) > 0.3 }
            .sorted { $0.boundingBox.midY > $1.boundingBox.midY } // top of the page first
            .compactMap { $0.topCandidates(1).first?.string }
        if lines.isEmpty {
            return s("ما شفت كتابة واضحة. قرّب الجوال شوي وجرب مرة ثانية.",
                     "I don't see clear text. Move a little closer and try again.")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: What's this? (people, common things, text, light)

    private func describe(_ frame: CVPixelBuffer) -> String {
        let handler = VNImageRequestHandler(cvPixelBuffer: frame, orientation: .right, options: [:])
        let classify = VNClassifyImageRequest()
        let humans = VNDetectHumanRectanglesRequest()
        let faces = VNDetectFaceRectanglesRequest()
        let text = VNDetectTextRectanglesRequest()
        try? handler.perform([classify, humans, faces, text])

        var parts: [String] = []

        // People, with where they are (whole bodies, or faces when someone is close).
        let bodies = (humans.results ?? []).map(\.boundingBox)
        let faceBoxes = (faces.results ?? []).map(\.boundingBox)
        let people = bodies.count >= faceBoxes.count ? bodies : faceBoxes
        if people.count == 1 {
            parts.append(s("فيه شخص \(position(of: people[0]))", "There is a person \(position(of: people[0]))"))
        } else if people.count > 1 {
            parts.append(s("فيه \(people.count) أشخاص", "There are \(people.count) people"))
        }

        // Things Apple's on-phone model thinks are there. Only words we can say correctly are spoken.
        let labels = (classify.results ?? [])
            .filter { $0.confidence > 0.12 }
            .map(\.identifier)
            .filter { !Self.skipLabels.contains($0) }
        var named: [String] = []
        var unknown: [String] = []
        for label in labels {
            let word: String? = isArabic ? Self.arabic[label] : label.replacingOccurrences(of: "_", with: " ")
            if let word { if !named.contains(word) { named.append(word) } }
            else if unknown.count < 4 { unknown.append(label) }
            if named.count == 4 { break }
        }
        lastUnknownLabels = unknown
        if !named.isEmpty {
            parts.append(s("وأشوف غالباً: ", "I probably see: ") + named.joined(separator: s("، ", ", ")))
        }

        if let boxes = text.results, boxes.count >= 2 {
            parts.append(s("وفيه كتابة، قول «اقرأ» عشان أقرأها", "There is some text; say \"read\" to hear it"))
        }

        // Always say something useful: at least the main colour in front of the camera.
        if parts.isEmpty {
            return s("ما عرفت الشي بالضبط. ", "I can't tell exactly what it is. ") + colors(frame)
        }
        return parts.joined(separator: ". ") + "."
    }

    private func position(of box: CGRect) -> String {
        let x = box.midX
        if x < 0.35 { return s("على يسارك", "on your left") }
        if x > 0.65 { return s("على يمينك", "on your right") }
        return s("قدامك", "in front of you")
    }

    /// Labels too vague to be useful when spoken.
    private static let skipLabels: Set<String> = ["structure", "material", "textile", "wood_processed", "liquid", "art", "conveyance", "machine"]

    /// Arabic words for common labels from Apple's image model. Unknown labels are left out rather than guessed.
    private static let arabic: [String: String] = [
        "chair": "كرسي", "table": "طاولة", "desk": "مكتب", "sofa": "كنبة", "couch": "كنبة", "bed": "سرير",
        "furniture": "أثاث", "door": "باب", "window": "نافذة", "stairs": "درج", "staircase": "درج",
        "kitchen": "مطبخ", "bathroom": "حمام", "bedroom": "غرفة نوم", "living_room": "غرفة جلوس",
        "office": "مكتب", "classroom": "فصل", "restaurant": "مطعم", "shop": "محل", "supermarket": "سوبرماركت",
        "mall": "مركز تجاري", "mosque": "مسجد", "hospital": "مستشفى", "elevator": "مصعد",
        "indoor": "مكان داخلي", "outdoor": "مكان مفتوح", "building": "مبنى", "house": "بيت",
        "road": "طريق", "street": "شارع", "sidewalk": "رصيف", "crosswalk": "ممر مشاة", "parking_lot": "موقف سيارات",
        "car": "سيارة", "vehicle": "مركبة", "bus": "باص", "truck": "شاحنة", "bicycle": "دراجة", "motorcycle": "دراجة نارية",
        "tree": "شجرة", "plant": "نبتة", "flower": "ورد", "grass": "عشب", "sky": "سماء", "sand": "رمل", "beach": "شاطئ", "sea": "بحر",
        "food": "طعام", "fruit": "فاكهة", "vegetable": "خضار", "bread": "خبز", "rice": "رز", "meal": "وجبة", "dessert": "حلويات",
        "cup": "كوب", "mug": "كوب", "glass": "كأس", "bottle": "قنينة", "plate": "صحن", "bowl": "وعاء", "spoon": "ملعقة", "fork": "شوكة", "knife": "سكين",
        "phone": "هاتف", "cellphone": "هاتف", "computer": "كمبيوتر", "laptop": "لابتوب", "keyboard": "لوحة مفاتيح",
        "television": "تلفزيون", "screen": "شاشة", "monitor": "شاشة", "remote_control": "ريموت", "lamp": "مصباح", "light": "إضاءة",
        "book": "كتاب", "paper": "ورق", "document": "ورقة", "sign": "لوحة", "clock": "ساعة", "watch": "ساعة يد",
        "bag": "حقيبة", "handbag": "شنطة", "backpack": "حقيبة ظهر", "wallet": "محفظة", "key": "مفتاح", "keys": "مفاتيح",
        "eyeglasses": "نظارة", "sunglasses": "نظارة شمسية", "shoe": "حذاء", "shoes": "أحذية", "clothing": "ملابس",
        "shirt": "قميص", "dress": "فستان", "hat": "قبعة", "jacket": "جاكيت",
        "dog": "كلب", "cat": "قطة", "bird": "طير", "animal": "حيوان",
        "toy": "لعبة", "ball": "كرة", "box": "صندوق", "pillow": "مخدة", "blanket": "بطانية", "curtain": "ستارة",
        "mirror": "مراية", "sink": "مغسلة", "toilet": "حمام", "refrigerator": "ثلاجة", "oven": "فرن", "microwave": "مايكرويف",
        "tableware": "أدوات مائدة", "consumer_electronics": "أجهزة إلكترونية", "computer_keyboard": "لوحة مفاتيح",
        "computer_mouse": "ماوس", "interior_room": "غرفة", "room": "غرفة", "ceiling": "سقف", "floor": "أرضية", "wall": "جدار",
        "decoration": "زينة", "vase": "مزهرية", "houseplant": "نبتة", "potted_plant": "نبتة", "cushion": "مخدة",
        "shelf": "رف", "bookshelf": "رف كتب", "cabinet": "خزانة", "wardrobe": "دولاب", "appliance": "جهاز منزلي",
        "light_fixture": "إضاءة", "chandelier": "ثريا", "painting": "لوحة مرسومة", "picture_frame": "برواز",
        "tile": "بلاط", "tiles": "بلاط", "countertop": "رخامة مطبخ", "faucet": "حنفية", "towel": "منشفة",
        "container": "علبة", "jar": "مرطبان", "can": "علبة", "packaged_goods": "منتج معبأ", "drink": "مشروب",
        "coffee": "قهوة", "tea": "شاي", "water": "ماء", "juice": "عصير", "candy": "حلاوة", "chocolate": "شوكولاتة",
        "hand": "يد", "people": "أشخاص", "child": "طفل", "baby": "طفل صغير", "adult": "شخص بالغ",
        "fence": "سياج", "wheel": "عجلة", "tire": "إطار", "traffic_light": "إشارة مرور", "pole": "عمود",
        "money": "فلوس", "coin": "عملة", "medicine": "دواء", "pill": "حبوب", "carpet": "سجادة", "rug": "سجادة",
    ]

    // MARK: Colours (counted from the middle of the picture)

    private func colors(_ frame: CVPixelBuffer) -> String {
        let image = CIImage(cvPixelBuffer: frame).oriented(.right)
        let extent = image.extent
        let crop = extent.insetBy(dx: extent.width * 0.3, dy: extent.height * 0.3)
        let side = 24
        let scaled = image.cropped(to: crop)
            .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
            .transformed(by: CGAffineTransform(scaleX: CGFloat(side) / crop.width, y: CGFloat(side) / crop.height))
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        ciContext.render(scaled, toBitmap: &pixels, rowBytes: side * 4,
                         bounds: CGRect(x: 0, y: 0, width: side, height: side),
                         format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())

        var counts: [String: Int] = [:]
        var brightness = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let r = Double(pixels[i]) / 255, g = Double(pixels[i + 1]) / 255, b = Double(pixels[i + 2]) / 255
            brightness += (r + g + b) / 3
            counts[colorName(r, g, b), default: 0] += 1
        }
        let total = side * side
        if brightness / Double(total) < 0.08 {
            return s("المكان مظلم جداً، ما أقدر أعرف الألوان.", "It's too dark to tell the colours.")
        }
        let top = counts.sorted { $0.value > $1.value }.filter { Double($0.value) / Double(total) > 0.18 }.prefix(2).map(\.key)
        guard let first = top.first else {
            return s("الألوان مخلوطة وما قدرت أحددها. قرّب الشي من الكاميرا.", "The colours are mixed. Bring the object closer.")
        }
        if top.count == 2 {
            return s("اللون غالباً \(first)، وفيه \(top[1]). الإضاءة ممكن تغيّر الألوان شوي.",
                     "Mostly \(first), with some \(top[1]). Lighting can change colours a little.")
        }
        return s("اللون غالباً \(first). الإضاءة ممكن تغيّر الألوان شوي.", "Mostly \(first). Lighting can change colours a little.")
    }

    private func colorName(_ r: Double, _ g: Double, _ b: Double) -> String {
        let maxV = max(r, g, b), minV = min(r, g, b)
        let v = maxV, sat = maxV == 0 ? 0 : (maxV - minV) / maxV
        if v < 0.18 { return s("أسود", "black") }
        if sat < 0.15 {
            if v > 0.85 { return s("أبيض", "white") }
            return s("رمادي", "grey")
        }
        var h = 0.0
        let d = maxV - minV
        if maxV == r { h = 60 * (((g - b) / d).truncatingRemainder(dividingBy: 6)) }
        else if maxV == g { h = 60 * ((b - r) / d + 2) }
        else { h = 60 * ((r - g) / d + 4) }
        if h < 0 { h += 360 }
        switch h {
        case ..<15, 345...: return v < 0.45 ? s("عنابي", "maroon") : (sat < 0.5 ? s("وردي", "pink") : s("أحمر", "red"))
        case 15..<40: return v < 0.55 ? s("بني", "brown") : s("برتقالي", "orange")
        case 40..<70: return v < 0.5 ? s("زيتي", "olive") : (sat < 0.4 ? s("بيج", "beige") : s("أصفر", "yellow"))
        case 70..<165: return s("أخضر", "green")
        case 165..<200: return s("تركوازي", "turquoise")
        case 200..<255: return v < 0.4 ? s("كحلي", "navy") : s("أزرق", "blue")
        case 255..<290: return s("بنفسجي", "purple")
        default: return s("وردي", "pink")
        }
    }

    // MARK: Speaking

    private func show(_ text: String) {
        resultLabel.text = text
        UIAccessibility.post(notification: .layoutChanged, argument: resultLabel)
    }

    /// The most natural-sounding voice installed on this iPhone (Premium or Enhanced when downloaded).
    private lazy var bestVoice: AVSpeechSynthesisVoice? = {
        let prefix = isArabic ? "ar" : "en"
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix(prefix) }
        return voices.max { $0.quality.rawValue < $1.quality.rawValue }
            ?? AVSpeechSynthesisVoice(language: isArabic ? "ar-SA" : "en-US")
    }()

    private func say(_ text: String, queue: Bool = false) {
        stopListening()
        if !queue { synthesizer.stopSpeaking(at: .immediate) }
        lastSpoken = text
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = bestVoice
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.95
        synthesizer.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard !stopped, !synthesizer.isSpeaking else { return }
        startListening()
    }

    // MARK: Listening (Apple's on-device speech recognition, when the phone supports it for this language)

    private func prepareListening() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                let locales = self.isArabic ? ["ar-AE", "ar-SA"] : ["en-US", "en-GB"]
                let recognizer = locales.lazy
                    .compactMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) }
                    .first { $0.supportsOnDeviceRecognition }
                self.recognizer = recognizer
                self.canListen = status == .authorized && recognizer != nil
                if !self.canListen {
                    self.soundMode = true
                    self.say(self.s("جوالك ما يفهم الكلام بدون إنترنت، فأي كلمة تقولها أعتبرها «ما هذا؟». وللقراءة والألوان المس الأزرار تحت الدائرة.",
                                    "Your phone can't understand speech without internet, so anything you say counts as \"what's this\". For reading and colours, use the buttons below the circle."), queue: true)
                } else {
                    self.startListening()
                }
            }
        }
    }

    private func startListening() {
        if soundMode { startSoundListening(); return }
        guard canListen, !working, !stopped, recognitionTask == nil, let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        let input = audioEngine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        do { try audioEngine.start() } catch { input.removeTap(onBus: 0); return }
        recognitionRequest = request
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let text = result?.bestTranscription.formattedString, let command = self.command(in: text) {
                    self.stopListening()
                    self.handle(command)
                    return
                }
                if error != nil || (result?.isFinal ?? false) {
                    self.stopListening()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.startListening() }
                }
            }
        }
    }

    /// Listens for someone talking (by loudness only): after a short sentence and a pause, describes.
    private func startSoundListening() {
        guard !working, !stopped, !audioEngine.isRunning, !synthesizer.isSpeaking else { return }
        loudBuffers = 0; quietBuffers = 0
        let input = audioEngine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            guard let self, let data = buffer.floatChannelData?[0] else { return }
            let n = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0..<n { sum += data[i] * data[i] }
            let level = n > 0 ? (sum / Float(n)).squareRoot() : 0
            if level > 0.03 { self.loudBuffers += 1; self.quietBuffers = 0 }
            else if self.loudBuffers > 0 { self.quietBuffers += 1 }
            // About a quarter second of voice, then about two thirds of a second of quiet.
            if self.loudBuffers >= 10 && self.quietBuffers >= 28 {
                self.loudBuffers = 0; self.quietBuffers = 0
                DispatchQueue.main.async { self.stopListening(); self.run(.describe) }
            }
        }
        audioEngine.prepare()
        do { try audioEngine.start() } catch { input.removeTap(onBus: 0) }
    }

    private func stopListening() {
        if audioEngine.isRunning { audioEngine.stop() }
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
    }

    private enum Command { case task(Job), repeatLast, stop }

    private func command(in raw: String) -> Command? {
        let text = Self.normalize(raw)
        if ["وقف", "اسكت", "stop", "quiet"].contains(where: text.contains) { return .stop }
        if ["عيد", "كرر", "repeat", "again"].contains(where: text.contains) { return .repeatLast }
        if ["اقر", "مكتوب", "read"].contains(where: text.contains) { return .task(.read) }
        if ["لون", "الوان", "colo"].contains(where: text.contains) { return .task(.colors) }
        if ["ما هذا", "ماهذا", "شو هذا", "وش هذا", "شو جدام", "جدامي", "قدامي", "اوصف", "صف لي", "صور",
            "what", "describe", "in front"].contains(where: text.contains) { return .task(.describe) }
        return nil
    }

    private func handle(_ command: Command) {
        switch command {
        case .task(let task): run(task)
        case .repeatLast: say(lastSpoken.isEmpty ? s("ما قلت شي بعد.", "Nothing yet.") : lastSpoken)
        case .stop:
            synthesizer.stopSpeaking(at: .immediate)
            startListening()
        }
    }

    static func normalize(_ raw: String) -> String {
        var t = raw.lowercased()
        let marks = CharacterSet(charactersIn: "\u{064B}\u{064C}\u{064D}\u{064E}\u{064F}\u{0650}\u{0651}\u{0652}\u{0640}")
        t = String(t.unicodeScalars.filter { !marks.contains($0) })
        for (from, to) in [("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي"), ("ؤ", "و"), ("ئ", "ي")] {
            t = t.replacingOccurrences(of: from, with: to)
        }
        return t
    }
}
