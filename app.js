// Baseer web app: live camera, voice commands, spoken replies, walking mode, places, SOS.
// Runs entirely in the browser; the only paid part is the Anthropic API call per description.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  // ---------- Settings & state ----------
  const settings = {
    lang: store.get("lang", "ar"),
    key: store.get("key", ""),
    model: store.get("model", "claude-haiku-5-5"),
    trustedName: store.get("trustedName", ""),
    trustedPhone: store.get("trustedPhone", ""),
    handsFree: store.get("handsFree", true),
    voiceName: store.get("voiceName", ""),   // chosen by the user; empty = best available
    rate: store.get("rate", 1),
    voiceEngine: store.get("voiceEngine", "system"), // "system" (free) or "eleven" (natural, every language)
    elevenKey: store.get("elevenKey", ""),
    elevenVoiceId: store.get("elevenVoiceId", ""),
    elevenVoices: store.get("elevenVoices", [])    // [{ id, name }]
  };

  // Languages Baseer can see and speak in. speech = recognition locale.
  const LANGS = [
    ["ar", "العربية", "ar-AE"], ["en", "English", "en-US"], ["fr", "Français", "fr-FR"], ["es", "Español", "es-ES"],
    ["de", "Deutsch", "de-DE"], ["it", "Italiano", "it-IT"], ["pt", "Português", "pt-BR"], ["nl", "Nederlands", "nl-NL"],
    ["ru", "Русский", "ru-RU"], ["tr", "Türkçe", "tr-TR"], ["fa", "فارسی", "fa-IR"], ["ur", "اردو", "ur-PK"],
    ["hi", "हिन्दी", "hi-IN"], ["bn", "বাংলা", "bn-BD"], ["ml", "മലയാളം", "ml-IN"], ["ta", "தமிழ்", "ta-IN"],
    ["id", "Bahasa Indonesia", "id-ID"], ["ms", "Bahasa Melayu", "ms-MY"], ["fil", "Filipino", "fil-PH"],
    ["sw", "Kiswahili", "sw-KE"], ["zh", "中文", "zh-CN"], ["ja", "日本語", "ja-JP"], ["ko", "한국어", "ko-KR"]
  ].map(([code, name, speech]) => ({ code, name, speech }));
  const langInfo = (code) => LANGS.find(l => l.code === code) || LANGS[1];
  const RTL = new Set(["ar", "fa", "ur"]);
  let places = store.get("places", []);

  let busy = false;
  let walking = false;
  let lastReply = "";
  let lastHazard = "";
  let controller = null;
  let awaitingCommandUntil = 0;
  let pendingConfirm = null; // { action, until }
  let sosTapAt = 0;

  // ---------- Text ----------
  const T = {
    ar: {
      appName: "بصير", startText: "اضغط في أي مكان عشان أبدأ أتكلم معك",
      camOn: "الكاميرا شغالة", camOff: "الكاميرا مقفلة", micOn: "أسمعك", micOff: "الميكروفون طافي",
      describe: "اوصف لي", describeHint: "اضغط أو قل:<b>بصير، صوّر</b>", looking: "أشوف…",
      readTile: "اقرأ نصاً", askTile: "شو جدامي؟", colorTile: "الألوان", askLabel: "سؤالك عن المكان", askBtn: "اسأل", askPh: "مثلاً: وين الباب؟",
      lastLabel: "آخر وصف:", idle: "قل «بصير، صوّر» وأقول لك شو قدامك.",
      tabHome: "الرئيسية", tabRead: "اقرأ", tabNav: "تنقل", tabSafety: "الأمان",
      readText: "اقرأ النص", readSub: "لوحات، أوراق، قوائم طعام", translate: "ترجم", translateSub: "يترجم النص اللي جدامك",
      money: "كم الفلوس؟", moneySub: "يعرف الأوراق النقدية ويجمعها", colors: "الألوان", colorsSub: "لون الشي أو الملابس",
      walkOn: "وضع المشي", walkOff: "وقف وضع المشي", walkSub: "ينبهك إذا شاف خطر قدامك",
      where: "وين أنا؟", whereSub: "اسم الشارع والمنطقة", savePlace: "احفظ مكاني", savePlaceSub: "قل: بصير، احفظ المكان باسم البيت",
      myPlaces: "أماكني", noPlaces: "ما في أماكن محفوظة بعد.", goThere: "اضغط عشان أوديك",
      sos: "استغاثة", sosSub: "اضغط مرتين", share: "شارك موقعي", noTrusted: "أضف شخص موثوق تحت",
      handsFree: "الاستماع الدائم", handsFreeSub: "قل «بصير» وبعدها طلبك",
      settings: "الإعدادات", keyLabel: "مفتاح Anthropic", keyHelp: "من console.anthropic.com. يبقى على جوالك بس.",
      modelLabel: "نوع الوصف", modelFast: "سريع واقتصادي", modelBest: "أدق (أغلى وأبطأ)",
      trustedLabelTitle: "الشخص الموثوق", trustedNamePh: "الاسم", langLabel: "اللغة", save: "حفظ",
      voiceLabel: "صوت بصير", rateLabel: "سرعة الكلام", rateSlow: "بطيء", rateNormal: "عادي", rateFast: "سريع", rateFaster: "أسرع",
      testVoice: "اسمع الصوت", autoVoice: "تلقائي (أفضل صوت)", styleNames: "عادي,ناعم,عميق,سريع",
      engineLabel: "نوع الصوت", engineSystem: "صوت الجوال (مجاني)", engineEleven: "صوت طبيعي ElevenLabs (كل اللغات)",
      elevenKeyLabel: "مفتاح ElevenLabs", loadVoices: "حمّل الأصوات", langHelp: "بصير يوصف ويتكلم بأي لغة تختارها. أول مرة تختار لغة جديدة يترجم الأزرار لها.",
      voiceHelp: "أو قل: بصير، غيّر الصوت. وقل: أسرع، أو أبطأ. أصوات أكثر: نزّلها من إعدادات الجوال (النطق / تحويل النص إلى كلام).",
      safetyNote: "<strong>تنبيه:</strong> بصير أداة مساعدة. لا يغني عن العصا أو الكلب المرشد، ولا تعتمد عليه لعبور الشوارع. سكوته ما يعني إن الطريق آمن.",
      privacyNote: "الصور تُرسل إلى Claude من Anthropic للتحليل فقط ولا تُحفظ. مفتاحك وأماكنك تبقى على جوالك.",
      langName: "Arabic (clear Modern Standard Arabic that sounds natural to an Emirati listener)", caution: "انتبه:",
      v: {
        welcome: "أهلاً، أنا بصير، عيونك. قل: بصير، صوّر. وأنا أصوّر وأقول لك شو قدامك.",
        voiceSample: (n, i, total) => `هذا صوت رقم ${i} من ${total}${n ? "، اسمه " + n : ""}. إذا عجبك قل: بصير، خلاص. وإذا تبي غيره قل: بصير، غيّر الصوت.`,
        voiceKept: "تمام، بخلي هذا الصوت.", noVoices: "ما لقيت أصوات ثانية على هذا الجوال. تقدر تنزل أصوات من إعدادات الجوال.",
        faster: "صرت أتكلم أسرع.", slower: "صرت أتكلم أبطأ.",
        translating: "لحظة، أجهز اللغة الجديدة.", langReady: "صرت أتكلم العربي.",
        voicesLoaded: "حملت الأصوات. اختار صوت من القائمة، أو قل: بصير، غيّر الصوت.", elevenFailed: "ما قدرت أستخدم صوت ElevenLabs، فرجعت لصوت الجوال. تأكد من المفتاح.",
        needElevenKey: "حط مفتاح ElevenLabs أول.",
        firstWarn: "قبل نبدأ: أنا أداة مساعدة، ولا أغني عن العصا أو الكلب المرشد، ولا تعتمد عليّ لعبور الشوارع.",
        needKey: "أحتاج مفتاح Anthropic. اطلب من اللي جهّز لك التطبيق يضيفه.",
        looking: "لحظة، أشوف.", yes: "نعم؟", ok: "تمام.", saved: "حفظت.",
        noCamera: "ما قدرت أفتح الكاميرا. اسمح للمتصفح يستخدم الكاميرا.",
        noMic: "ما قدرت أفتح الميكروفون. تقدر تضغط الأزرار بدال الصوت.",
        tooDark: "المكان مظلم جداً وما أشوف شي. شغّل كشاف الجوال وحاول مرة ثانية.",
        darkLead: "المكان مظلم، بس أشوف",
        nothing: "ما في شي أكرره بعد.", stopped: "سكت.",
        ask: "قل سؤالك، أو اكتبه واضغط اسأل.",
        walkOn: "وضع المشي شغال. خل الجوال على صدرك والكاميرا لقدام، وأنبهك إذا شفت خطر.",
        walkOff: "وقفت وضع المشي.",
        locating: "لحظة، أحدد مكانك.", noLocation: "ما قدرت أحدد موقعك. اسمح للمتصفح يستخدم الموقع.",
        youAre: (p) => `أنت في ${p}.`,
        saveName: "قل: بصير، احفظ المكان باسم، وبعدها الاسم. مثلاً: احفظ المكان باسم البيت.",
        placeSaved: (n) => `حفظت هذا المكان باسم ${n}. قل: بصير، ودني ${n}، عشان أرجعك له.`,
        opening: (n) => `بفتح لك خرائط جوجل بإرشاد المشي إلى ${n}. هي بتتكلم وترشدك خطوة بخطوة.`,
        noTrusted: "ما في رقم شخص موثوق. أضفه من قسم الأمان. في الطوارئ في الإمارات اتصل على 999.",
        confirmSos: (n) => `تبي أرسل موقعك لـ ${n} وأتصل فيه؟ قل نعم أو لا.`,
        sosAgain: "للاستغاثة اضغط مرة ثانية.",
        sending: "جهزت رسالة بموقعك. اضغط إرسال.",
        notHeard: "ما سمعتك زين، حاول مرة ثانية.",
        tabs: { home: "الرئيسية.", read: "قسم اقرأ: قراءة، ترجمة، فلوس، ألوان.", nav: "قسم تنقل: وضع المشي، وين أنا، وأماكني.", safety: "قسم الأمان: استغاثة، مشاركة الموقع، والإعدادات." },
        errors: { badKey: "المفتاح غلط. تأكد منه في الإعدادات.", refused: "ما أقدر أساعد في هذا الطلب.", network: "في مشكلة في الإنترنت. حاول مرة ثانية.", server: "الخدمة ما ردّت. حاول بعد شوي.", busy: "لحظة، أشتغل على الطلب السابق." }
      }
    },
    en: {
      appName: "Baseer", startText: "Tap anywhere and I'll start talking to you",
      camOn: "Camera on", camOff: "Camera off", micOn: "Listening", micOff: "Mic off",
      describe: "Describe", describeHint: "Tap anywhere or say:<b>Baseer, describe</b>", looking: "Looking…",
      readTile: "Read text", askTile: "Ask", colorTile: "Colours", askLabel: "Your question", askBtn: "Ask", askPh: "e.g. Where is the door?",
      lastLabel: "Last description:", idle: "Say \"Baseer, describe\" or tap the circle.",
      tabHome: "Home", tabRead: "Read", tabNav: "Navigate", tabSafety: "Safety",
      readText: "Read text", readSub: "Signs, papers, menus", translate: "Translate", translateSub: "Translates the text in front of you",
      money: "Count money", moneySub: "Identifies and adds up banknotes", colors: "Colours", colorsSub: "Colour of an object or clothing",
      walkOn: "Walking mode", walkOff: "Stop walking mode", walkSub: "Warns you about hazards ahead",
      where: "Where am I?", whereSub: "Street and area name", savePlace: "Save this place", savePlaceSub: "Say: Baseer, save this place as home",
      myPlaces: "My places", noPlaces: "No saved places yet.", goThere: "Tap to go there",
      sos: "SOS", sosSub: "Tap twice", share: "Share my location", noTrusted: "Add a trusted contact below",
      handsFree: "Always listening", handsFreeSub: "Say \"Baseer\" then your request",
      settings: "Settings", keyLabel: "Anthropic key", keyHelp: "From console.anthropic.com. It stays on your phone.",
      modelLabel: "Description type", modelFast: "Fast and cheap", modelBest: "Most accurate (slower, costs more)",
      trustedLabelTitle: "Trusted contact", trustedNamePh: "Name", langLabel: "Language", save: "Save",
      voiceLabel: "Baseer's voice", rateLabel: "Speaking speed", rateSlow: "Slow", rateNormal: "Normal", rateFast: "Fast", rateFaster: "Faster",
      testVoice: "Hear the voice", autoVoice: "Automatic (best voice)", styleNames: "normal,soft,deep,quick",
      engineLabel: "Voice type", engineSystem: "Phone voice (free)", engineEleven: "Natural ElevenLabs voice (every language)",
      elevenKeyLabel: "ElevenLabs key", loadVoices: "Load voices", langHelp: "Baseer describes and speaks in any language you choose. The first time you pick a new language, it translates the buttons.",
      voiceHelp: "Or say: Baseer, change voice. And say: faster, or slower. More voices: download them in your phone's speech / text-to-speech settings.",
      safetyNote: "<strong>Caution:</strong> Baseer is an assistive tool. It doesn't replace your cane or guide dog, and never rely on it to cross streets. Its silence doesn't mean the way is safe.",
      privacyNote: "Photos are sent to Anthropic's Claude for analysis only and aren't stored. Your key and places stay on your phone.",
      langName: "English", caution: "Caution:",
      v: {
        welcome: "Hi, I'm Baseer, your eyes. Say: Baseer, take a picture. I'll take one and tell you what's in front of you.",
        voiceSample: (n, i, total) => `This is voice ${i} of ${total}${n ? ", called " + n : ""}. If you like it, say: Baseer, keep it. For another, say: Baseer, change voice.`,
        voiceKept: "OK, I'll keep this voice.", noVoices: "There are no other voices on this phone. You can download more in your phone's settings.",
        faster: "I'm speaking faster now.", slower: "I'm speaking slower now.",
        translating: "One moment, getting the new language ready.", langReady: "I'm speaking English now.",
        voicesLoaded: "Voices loaded. Pick one from the list, or say: Baseer, change voice.", elevenFailed: "I couldn't use the ElevenLabs voice, so I switched back to the phone voice. Check the key.",
        needElevenKey: "Enter your ElevenLabs key first.",
        yesWords: "yes, yeah, sure, ok", noWords: "no, cancel",
        firstWarn: "Before we start: I'm an assistive tool, not a replacement for your cane or guide dog. Never rely on me to cross streets.",
        needKey: "I need an Anthropic key. Ask the person who set up the app to add it.",
        looking: "One moment, looking.", yes: "Yes?", ok: "OK.", saved: "Saved.",
        noCamera: "I couldn't open the camera. Allow the browser to use it.",
        noMic: "I couldn't open the microphone. You can use the buttons instead.",
        tooDark: "It's too dark to see anything. Turn on the phone's torch and try again.",
        darkLead: "It's dark here, but I can make out",
        nothing: "Nothing to repeat yet.", stopped: "Stopped.",
        ask: "Say your question, or type it and tap Ask.",
        walkOn: "Walking mode is on. Hold the phone at chest height facing forward and I'll warn you about hazards I see.",
        walkOff: "Walking mode is off.",
        locating: "One moment, finding where you are.", noLocation: "I couldn't get your location. Allow the browser to use it.",
        youAre: (p) => `You're at ${p}.`,
        saveName: "Say: Baseer, save this place as, then the name. For example: save this place as home.",
        placeSaved: (n) => `Saved this place as ${n}. Say: Baseer, take me to ${n}, to come back.`,
        opening: (n) => `Opening Google Maps with walking directions to ${n}. It will guide you step by step.`,
        noTrusted: "No trusted contact yet. Add one in the Safety tab. In a UAE emergency, call 999.",
        confirmSos: (n) => `Send your location to ${n} and call them? Say yes or no.`,
        sosAgain: "Tap again to send an SOS.",
        sending: "Your location message is ready. Press send.",
        notHeard: "I didn't catch that, please try again.",
        tabs: { home: "Home.", read: "Read: text, translation, money, colours.", nav: "Navigate: walking mode, where am I, and my places.", safety: "Safety: SOS, share location, and settings." },
        errors: { badKey: "The key is wrong. Check it in Settings.", refused: "I can't help with that request.", network: "Internet problem. Please try again.", server: "The service didn't respond. Try again shortly.", busy: "One moment, still working on the last request." }
      }
    }
  };
  // Templates for the sentences that take a name or number, used when translating.
  const EN_TEMPLATES = {
    "v.voiceSample": "This is voice {1} of {2}: {0}. If you like it, say: Baseer, keep it. For another, say: Baseer, change voice.",
    "v.youAre": "You're at {0}.",
    "v.placeSaved": "Saved this place as {0}. Say: Baseer, take me to {0}, to come back.",
    "v.opening": "Opening Google Maps with walking directions to {0}. It will guide you step by step.",
    "v.confirmSos": "Send your location to {0} and call them? Say yes or no."
  };
  const TEMPLATE_KEYS = new Set(Object.keys(EN_TEMPLATES));

  function flatten(obj, prefix = "", out = {}) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "function") out[key] = EN_TEMPLATES[key];
      else if (v && typeof v === "object") flatten(v, key, out);
      else out[key] = v;
    }
    return out;
  }
  function unflatten(flat) {
    const out = {};
    for (const [key, value] of Object.entries(flat)) {
      const parts = key.split(".");
      let node = out;
      parts.slice(0, -1).forEach(p => { node = node[p] = node[p] || {}; });
      const last = parts[parts.length - 1];
      node[last] = TEMPLATE_KEYS.has(key)
        ? (...args) => String(value).replace(/\{(\d)\}/g, (_, i) => args[i] ?? "")
        : value;
    }
    return out;
  }
  /** Builds a translated text set from a stored translation (English fills any gaps). */
  function loadTranslation(code) {
    const flat = store.get("ui_" + code, null);
    if (!flat) return false;
    const base = flatten(T.en);
    T[code] = unflatten({ ...base, ...flat, langName: langInfo(code).name });
    return true;
  }
  /** Asks Claude once to translate every button and spoken sentence into a new language. */
  async function translateUI(code) {
    if (T[code] || loadTranslation(code)) return true;
    if (!settings.key) return false;
    const source = flatten(T.en);
    delete source.langName;
    source["v.langReady"] = `I'm speaking ${langInfo(code).name} now.`;
    const prompt = `Translate the values of this JSON object into ${langInfo(code).name} (language code ${code}), for a voice assistant used by blind people. ` +
      `Keep every key unchanged. Keep placeholders like {0} {1} {2} and HTML tags like <b> and <strong> exactly. ` +
      `"Baseer" is the app's name: write it the way a speaker of that language would say it. ` +
      `"yesWords" and "noWords" are comma-separated words people say for yes and no. "wake" must be the app name only. ` +
      `Return only the JSON object.\n\n` + JSON.stringify({ ...source, wake: "Baseer" });
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": settings.key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 8000, output_config: { effort: "low" }, messages: [{ role: "user", content: prompt }] })
      });
      if (!res.ok) return false;
      const data = await res.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      const flat = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      store.set("ui_" + code, flat);
      return loadTranslation(code);
    } catch { return false; }
  }
  const t = () => T[settings.lang] || T.en;

  function applyLang() {
    const L = t();
    const dir = RTL.has(settings.lang) ? "rtl" : "ltr";
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = dir;
    document.querySelectorAll("[data-t]").forEach(el => {
      const value = L[el.dataset.t];
      if (typeof value !== "string") return;
      if (el.dataset.html) el.innerHTML = value; else el.textContent = value;
    });
    document.querySelectorAll("[data-ph]").forEach(el => { el.placeholder = L[el.dataset.ph]; });
    $("describeText").textContent = busy ? L.looking : L.describe;
    $("describeHint").innerHTML = L.describeHint;
    $("question").placeholder = L.askPh;
    if (!lastReply) $("reply").textContent = L.idle;
    $("walkText").textContent = walking ? L.walkOff : L.walkOn;
    $("walkBtn").classList.toggle("on", walking);
    renderPlaces();
    fillVoiceSelect();
    updateChips();
  }

  // ---------- Speech output ----------
  const synth = window.speechSynthesis;
  let speakingUntilIdle = false;

  /** Voices for the app language, best-sounding first. */
  function voicesForLang() {
    if (!synth) return [];
    const prefix = settings.lang;
    const list = synth.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(prefix));
    const score = (v) => (/premium|enhanced|natural|neural|google|siri/i.test(v.name) ? 0 : 1);
    return list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }

  // Pitch/speed styles layered on top of each phone voice.
  const STYLES = [{ pitch: 1, rate: 1 }, { pitch: 1.35, rate: 1.05 }, { pitch: 0.7, rate: 0.92 }, { pitch: 1.1, rate: 1.2 }];
  const chosenStyle = () => STYLES[Number(String(settings.voiceName).split("|")[1]) || 0];

  function pickVoice(code) {
    if (!synth) return null;
    const voices = synth.getVoices();
    const chosenName = String(settings.voiceName).split("|")[0];
    if (chosenName && code.startsWith(settings.lang)) {
      const chosen = voices.find(v => v.name === chosenName);
      if (chosen) return chosen;
    }
    const prefix = code.slice(0, code.indexOf("-") > 0 ? code.indexOf("-") : code.length).toLowerCase();
    const order = prefix === "ar" ? ["ar-ae", "ar-sa", "ar-001", "ar"] : prefix === "en" ? ["en-gb", "en-us", "en"] : [code.toLowerCase(), prefix];
    for (const want of order) {
      const matches = voices.filter(v => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(want));
      const best = matches.find(v => /premium|enhanced|natural|google|siri/i.test(v.name)) || matches[0];
      if (best) return best;
    }
    return null;
  }
  /** Voice language for a piece of text: the app language, unless the text is clearly Arabic or Latin script. */
  function voiceLangFor(text) {
    const app = langInfo(settings.lang).speech;
    if (/[\u0600-\u06FF]/.test(text) && !["fa", "ur"].includes(settings.lang)) return settings.lang === "ar" ? app : "ar-SA";
    if (!/[^\u0000-\u024F\s\d.,!?'"():;-]/.test(text) && RTL.has(settings.lang)) return "en-US"; // Latin text read in an Arabic app
    return app;
  }

  /** Speaks text. queue=true adds after current speech (streamed sentences). */
  function speak(text, { queue = false } = {}) {
    if (!text) return;
    if (settings.voiceEngine === "eleven" && settings.elevenKey && settings.elevenVoiceId) {
      stopListening();
      return elevenSpeak(text, queue);
    }
    if (!synth) { $("reply").textContent = text; return; }
    stopListening(); // never let the mic hear Baseer's own voice
    if (!queue) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLangFor(text);
    const voice = pickVoice(u.lang);
    if (voice) u.voice = voice;
    const style = chosenStyle();
    u.rate = (Number(settings.rate) || 1) * style.rate;
    u.pitch = style.pitch;
    u.onend = u.onerror = () => setTimeout(afterSpeech, 250);
    speakingUntilIdle = true;
    synth.speak(u);
  }
  function isSpeaking() { return elevenBusy > 0 || (!!synth && (synth.speaking || synth.pending)); }
  function afterSpeech() {
    if (isSpeaking()) return;
    speakingUntilIdle = false;
    if (!busy) startListening();
  }
  function stopSpeaking() {
    if (synth) synth.cancel();
    elevenGen++; elevenBusy = 0; elevenQueue = Promise.resolve();
    player.pause();
  }

  // ---------- Natural voice (ElevenLabs): speaks every language in the chosen voice ----------
  const player = new Audio();
  player.setAttribute("playsinline", "");
  let elevenQueue = Promise.resolve(), elevenGen = 0, elevenBusy = 0, elevenWarned = false;
  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  /** Must run inside a tap: lets the page play audio later (iPhone and Android). */
  function unlockAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
    player.src = SILENT_WAV;
    player.play().catch(() => {});
  }
  function fetchElevenAudio(text) {
    return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.elevenVoiceId)}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": settings.elevenKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: Math.min(1.2, Math.max(0.7, Number(settings.rate) || 1)) } })
    }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); });
  }
  function playBlob(blob, gen) {
    return new Promise(resolve => {
      if (gen !== elevenGen) return resolve();
      const url = URL.createObjectURL(blob);
      player.onended = player.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      player.src = url;
      player.play().catch(() => resolve());
    });
  }
  function elevenSpeak(text, queue) {
    if (!queue) stopSpeaking();
    const gen = elevenGen;
    const audio = fetchElevenAudio(text); // starts downloading now, plays in order
    elevenBusy++;
    speakingUntilIdle = true;
    elevenQueue = elevenQueue
      .then(() => audio)
      .then(blob => playBlob(blob, gen))
      .catch(() => {
        if (gen !== elevenGen) return;
        // Fall back to the phone voice so the user still hears the answer.
        settings.voiceEngine = "system";
        const fallback = elevenWarned ? text : t().v.elevenFailed + " " + text;
        elevenWarned = true;
        elevenBusy = 0;
        speak(fallback, { queue: true });
        settings.voiceEngine = "eleven";
      })
      .finally(() => {
        if (gen !== elevenGen) return;
        elevenBusy = Math.max(0, elevenBusy - 1);
        if (elevenBusy === 0) setTimeout(afterSpeech, 250);
      });
  }
  async function loadElevenVoices() {
    const V = t().v;
    if (!settings.elevenKey) { speak(V.needElevenKey); return; }
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": settings.elevenKey } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      settings.elevenVoices = (data.voices || []).map(v => ({ id: v.voice_id, name: v.name }));
      store.set("elevenVoices", settings.elevenVoices);
      if (!settings.elevenVoiceId && settings.elevenVoices[0]) { settings.elevenVoiceId = settings.elevenVoices[0].id; store.set("elevenVoiceId", settings.elevenVoiceId); }
      fillVoiceSelect();
      speak(V.voicesLoaded);
    } catch {
      settings.voiceEngine = "system";
      speak(V.elevenFailed);
      settings.voiceEngine = "eleven";
    }
  }

  /** Splits streamed text into sentences so speaking starts after the first one. */
  function sentenceSpeaker() {
    let buffer = "";
    const enders = /[.!?؟؛\n]/;
    return {
      add(chunk) {
        buffer += chunk;
        let m;
        while ((m = buffer.search(enders)) !== -1) {
          const sentence = buffer.slice(0, m + 1).trim();
          buffer = buffer.slice(m + 1);
          if (sentence.length > 1) speak(sentence, { queue: true });
        }
      },
      flush() { const rest = buffer.trim(); buffer = ""; if (rest) speak(rest, { queue: true }); }
    };
  }

  // ---------- Camera ----------
  const video = $("video");
  let stream = null;

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
    } catch {
      stream = null;
      speak(t().v.noCamera, { queue: true });
    }
    updateChips();
  }

  function setTorch(on) {
    const track = stream && stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities || !track.getCapabilities().torch) return false;
    track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    return true;
  }

  /** Grabs the current frame; brightens it if dark. Returns { base64, light } or { light: "dark" }. */
  function grabFrame(maxDim = 1280) {
    if (!stream || !video.videoWidth) return null;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const light = brightenIfDark(ctx, canvas.width, canvas.height);
    if (light === "dark") return { light };
    return { light, base64: canvas.toDataURL("image/jpeg", 0.8).split(",")[1] };
  }

  async function captureForAI(maxDim) {
    let frame = grabFrame(maxDim);
    // Android: switch on the torch for a moment when it's dark.
    if (frame && frame.light !== "normal" && setTorch(true)) {
      await new Promise(r => setTimeout(r, 700));
      frame = grabFrame(maxDim);
      setTorch(false);
    }
    return frame;
  }

  function brightenIfDark(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const hist = new Uint32Array(256);
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) {
      const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
      hist[y]++; sum += y; n++;
    }
    const mean = sum / n;
    if (mean >= 90) return "normal";
    const pct = (p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
    const lo = pct(0.01), hi = Math.max(pct(0.995), lo + 1);
    if (hi - lo < 10 || hi < 18) return "dark";
    const normMean = Math.min(0.95, Math.max(0.01, (mean - lo) / (hi - lo)));
    const gamma = Math.min(1, Math.max(0.3, Math.log(0.45) / Math.log(normMean)));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), gamma) * 255);
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    ctx.putImageData(img, 0, 0);
    return "low";
  }

  // ---------- Claude ----------
  function systemPrompt() {
    const L = t();
    return `You are Baseer (بصير), the eyes of a blind or low-vision person. The photo was just taken by their phone camera, pointing roughly where they face. Your reply is read aloud, so write plain short sentences only: no lists, no markdown, no emojis, no symbols.

Always reply in ${L.langName}.

Safety rules (these override everything else):
- Never say or imply that a path, road, crossing, or area is safe, clear, or free of obstacles. You only see one still photo and can miss things.
- If you notice a possible hazard (stairs, a step or kerb edge, a nearby or moving vehicle, an open hole, a glass door, a low branch, a wet floor), mention it first, starting with "${L.caution}", and say where it is.
- If the photo is too dark, blurry, or blocked, say so and suggest how to hold the phone.
- Do not identify people by name or guess sensitive traits. Describe only what is visible.

Give directions relative to the user: ahead, to your left, to your right, about N steps away.`;
  }

  function taskPrompt(mode, question) {
    const L = t();
    switch (mode) {
      case "ask": return `The user asks: "${question}". Answer from the photo in 1 to 3 short sentences.`;
      case "read": return "Read out all the readable text in the photo in a natural reading order, keeping its original language. If there is no readable text, say so briefly and suggest moving closer.";
      case "translate": return `Find the readable text in the photo and translate it into ${L.langName}. Say which language it was in, then give only the translation. If there is no text, say so briefly.`;
      case "money": return "Identify any banknotes or coins. They are most likely UAE dirhams, but say so if they are another currency. Say the value of each and then the total. If unsure about one, say so. Never guess an amount.";
      case "color": return "Say the main colours of the object in the centre of the photo (or the clothing, if it is clothing), with the shade and any pattern. If the lighting makes colours hard to judge, say so.";
      case "hazards": return `Walking check. This frame comes from the camera pointing ahead while the user walks. If you see a likely hazard within about 5 steps ahead (stairs, a kerb edge, a hole, an obstacle at body or head height, a glass door, a pole, a moving or approaching vehicle or bicycle, a wet floor, or a person directly in the path), reply with ONE short sentence that starts with "${L.caution}" and says what and where. Otherwise reply with exactly [silent] and nothing else. Never say the way is clear.${lastHazard ? ` Your last warning was: "${lastHazard}". Do not repeat it unless it is now clearly closer.` : ""}`;
      default: return "Describe what is in front of me in full detail, in this order: any possible hazard first; then what kind of place this is; then the main things from nearest to farthest, with their position (ahead, left, right) and approximate distance in steps; people and what they are doing; colours; any readable text, read out exactly; and the lighting.";
    }
  }

  /** Calls Claude with one image. onText receives text as it streams in. */
  async function askClaude(mode, frame, { question = "", onText = null, signal } = {}) {
    const isOpus = settings.model.startsWith("claude-opus");
    let prompt = taskPrompt(mode, question);
    if (frame.light === "low") {
      prompt += `\n\nNote: this photo was taken in the dark and was digitally brightened, so it may be grainy and colours may be off. Start by saying briefly that it is dark (${t().v.darkLead}). Say clearly when you are unsure.`;
    }
    const body = {
      model: settings.model,
      max_tokens: mode === "hazards" ? 200 : 1500,
      stream: true,
      output_config: { effort: "low" },
      system: systemPrompt(),
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.base64 } },
        { type: "text", text: prompt }
      ] }]
    };
    const headers = {
      "x-api-key": settings.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true"
    };
    if (isOpus) { // declined requests are retried on a fallback model (Opus only)
      body.fallbacks = "default";
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    }

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      throw { code: e && e.name === "AbortError" ? "cancelled" : "network" };
    }
    if (!res.ok) throw { code: res.status === 401 || res.status === 403 ? "badKey" : "server" };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "", full = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let event;
        try { event = JSON.parse(line.slice(5)); } catch { continue; }
        if (event.type === "content_block_delta" && event.delta && event.delta.type === "text_delta") {
          full += event.delta.text;
          if (onText) onText(event.delta.text);
        } else if (event.type === "message_delta" && event.delta && event.delta.stop_reason === "refusal") {
          throw { code: "refused" };
        } else if (event.type === "error") {
          throw { code: "server" };
        }
      }
    }
    return full.trim();
  }

  // ---------- Actions ----------
  function setBusy(on) {
    busy = on;
    $("describeBtn").setAttribute("aria-busy", on ? "true" : "false");
    $("describeText").textContent = on ? t().looking : t().describe;
  }

  async function lookAndSay(mode, question = "") {
    const V = t().v;
    if (busy) { speak(V.errors.busy); return; }
    if (!settings.key) { speak(V.needKey); return; }
    if (!stream) await startCamera();
    setBusy(true);
    speak(V.looking);
    showTab("home");
    controller = new AbortController();
    try {
      const frame = await captureForAI(mode === "read" || mode === "money" || mode === "translate" ? 1600 : 1280);
      if (!frame) throw { code: "noCamera" };
      if (frame.light === "dark") { show(V.tooDark); speak(V.tooDark); return; }
      const sentences = sentenceSpeaker();
      let first = true;
      const text = await askClaude(mode, frame, {
        question, signal: controller.signal,
        onText: (chunk) => {
          if (first) { stopSpeaking(); first = false; } // cut "one moment" as soon as the answer starts
          sentences.add(chunk);
          $("reply").textContent = ($("reply").dataset.live || "") + chunk;
          $("reply").dataset.live = $("reply").textContent;
        }
      });
      sentences.flush();
      lastReply = text;
      show(text);
      vibrate(60);
    } catch (e) {
      if (e && e.code === "cancelled") return;
      const msg = e && e.code === "noCamera" ? V.noCamera : (V.errors[e && e.code] || V.errors.server);
      show(msg);
      speak(msg);
    } finally {
      $("reply").dataset.live = "";
      controller = null;
      setBusy(false);
      if (!isSpeaking()) startListening();
    }
  }

  function show(text) { $("reply").textContent = text; }
  function vibrate(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch {} }

  // Walking mode: checks a frame every few seconds and speaks only about hazards.
  async function walkLoop() {
    while (walking) {
      if (!busy && settings.key) {
        try {
          const frame = grabFrame(768);
          if (frame && frame.base64) {
            const reply = await askClaude("hazards", frame);
            if (walking && reply && !reply.includes("[silent]")) {
              lastHazard = reply;
              vibrate([250, 100, 250]);
              show(reply);
              speak(reply);
            }
          }
        } catch {}
      }
      await new Promise(r => setTimeout(r, settings.model.startsWith("claude-opus") ? 5000 : 3000));
    }
  }
  function setWalking(on) {
    const V = t().v;
    if (on && !settings.key) { speak(V.needKey); return; }
    if (on === walking) return;
    walking = on;
    lastHazard = "";
    applyLang();
    speak(on ? V.walkOn : V.walkOff);
    if (on) { requestWakeLock(); walkLoop(); }
  }

  // ---------- Location, places, maps ----------
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject();
      navigator.geolocation.getCurrentPosition(p => resolve(p.coords), reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
  }
  async function placeName(c) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.latitude}&lon=${c.longitude}&accept-language=${settings.lang}`;
      const j = await (await fetch(url)).json();
      const a = j.address || {};
      const parts = [a.road, a.neighbourhood || a.suburb || a.quarter, a.city || a.town || a.village].filter(Boolean);
      return [...new Set(parts)].join("، ") || j.display_name;
    } catch { return null; }
  }
  async function whereAmI() {
    const V = t().v;
    speak(V.locating);
    try {
      const c = await getPosition();
      const name = await placeName(c);
      const msg = name ? V.youAre(name) : V.youAre(`${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`);
      show(msg); speak(msg);
    } catch { show(V.noLocation); speak(V.noLocation); }
  }
  async function savePlace(name) {
    const V = t().v;
    if (!name) { speak(V.saveName); return; }
    try {
      const c = await getPosition();
      places = places.filter(p => normalize(p.name) !== normalize(name));
      places.push({ name, lat: c.latitude, lon: c.longitude });
      store.set("places", places);
      renderPlaces();
      const msg = V.placeSaved(name); show(msg); speak(msg);
    } catch { speak(V.noLocation); }
  }
  function findPlace(spoken) {
    const core = (s) => normalize(s).replace(/^ال/, "");
    const want = core(spoken);
    return places.find(p => core(p.name) === want) || places.find(p => want.includes(core(p.name)) || core(p.name).includes(want));
  }
  /** Google Maps does spoken turn-by-turn walking directions in Arabic and English. */
  function navigateTo(spoken) {
    const saved = findPlace(spoken);
    const destination = saved ? `${saved.lat},${saved.lon}` : spoken.replace(/^(اقرب|nearest)\s*/, "");
    const label = saved ? saved.name : spoken;
    speak(t().v.opening(label));
    setTimeout(() => {
      window.location.href = `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(destination)}`;
    }, 3500);
  }
  function renderPlaces() {
    const list = $("placesList");
    list.textContent = "";
    if (!places.length) {
      const p = document.createElement("p"); p.className = "note"; p.textContent = t().noPlaces; list.append(p); return;
    }
    places.forEach(place => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "wide";
      b.innerHTML = '<span class="icon"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z"/></svg></span><span><b></b><small></small></span>';
      b.querySelector("b").textContent = place.name;
      b.querySelector("small").textContent = t().goThere;
      b.addEventListener("click", () => navigateTo(place.name));
      list.append(b);
    });
  }

  // ---------- Trusted contact & SOS ----------
  async function sendLocation(sos) {
    const V = t().v;
    const phone = (settings.trustedPhone || "").replace(/[^\d+]/g, "");
    if (!phone) { show(V.noTrusted); speak(V.noTrusted); return; }
    let link = "";
    try { const c = await getPosition(); link = `https://maps.google.com/?q=${c.latitude.toFixed(6)},${c.longitude.toFixed(6)}`; } catch {}
    const text = (sos ? (settings.lang === "ar" ? "أحتاج مساعدة. موقعي: " : "I need help. My location: ") : (settings.lang === "ar" ? "هذا موقعي الحين: " : "Here's where I am: ")) + link;
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    speak(V.sending);
    setTimeout(() => {
      window.location.href = `sms:${phone}${isIOS ? "&" : "?"}body=${encodeURIComponent(text)}`;
      if (sos) setTimeout(() => { window.location.href = `tel:${phone}`; }, 6000);
    }, 1500);
  }
  function askSos() {
    const V = t().v;
    const name = settings.trustedName || (settings.lang === "ar" ? "الشخص الموثوق" : "your trusted contact");
    vibrate(200);
    confirmThen(V.confirmSos(name), () => sendLocation(true));
  }
  function confirmThen(question, action) {
    pendingConfirm = { action, until: Date.now() + 12000 };
    awaitingCommandUntil = Date.now() + 12000;
    speak(question);
  }

  // ---------- Voice commands ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, listening = false, handledAt = 0, handledText = "";

  function normalize(text) {
    return (text || "").toLowerCase()
      .replace(/[ً-ْـ]/g, "")
      .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[؟?!.,،]/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  const WAKE = ["يا بصير", "بصيره", "بصير", "بسير", "baseer", "basir", "bassir"];
  function afterWake(raw) {
    const text = normalize(raw);
    const words = t().wake ? [normalize(t().wake), ...WAKE] : WAKE;
    for (const w of words) { const i = text.indexOf(w); if (i !== -1) return text.slice(i + w.length).trim(); }
    return null;
  }
  const PHRASES = [
    ["nextVoice", ["غير الصوت", "صوت ثاني", "بدل الصوت", "change voice", "next voice", "another voice"]],
    ["keepVoice", ["خلاص الصوت", "خل هذا الصوت", "عجبني", "keep it", "keep this voice"]],
    ["faster", ["اسرع", "بسرعه", "faster"]],
    ["slower", ["ابطا", "بشويش", "على راحتك", "slower"]],
    ["walkStop", ["وقف المشي", "طفي المشي", "stop walking"]],
    ["walkStart", ["وضع المشي", "بمشي", "ابي امشي", "walking mode"]],
    ["share", ["شارك موقعي", "ارسل موقعي", "طرش موقعي", "share my location"]],
    ["where", ["وين انا", "اين انا", "where am i"]],
    ["money", ["كم الفلوس", "كم المبلغ", "كم البيزات", "how much money"]],
    ["color", ["شو لون", "وش لون", "ما لون", "اي لون", "what colour", "what color"]],
    ["stop", ["وقف", "اسكت", "خلاص", "stop", "quiet"]],
    ["repeat", ["كرر", "عيدها", "اعدها", "repeat", "again"]],
    ["translate", ["ترجم", "translate"]],
    ["read", ["اقرا", "قراءه", "شو مكتوب", "وش مكتوب", "read"]],
    ["describe", ["صور", "التقط", "شوف", "take a picture", "take a photo", "look", "اوصف", "وصف", "صف لي", "صفلي", "جدام", "قدام", "امامي", "المكان", "حولي", "شو تشوف", "describe", "in front", "what do you see"]]
  ];
  const INSTANT = new Set(["nextVoice", "faster", "slower", "describe", "read", "translate", "money", "color", "repeat", "where", "walkStart", "walkStop"]);

  function parse(raw) {
    const text = normalize(raw);
    if (!text) return null;
    if (/(استغاثه|نجده|طوارئ|الحقوني|emergency|\bsos\b)/.test(text) || text === "ساعدني" || text === "help") return { type: "sos" };
    let m = text.match(/(?:احفظ(?: هذا)? المكان(?: باسم)?|save this place(?: as)?)\s*(.*)$/);
    if (m) return { type: "save", name: m[1].trim() };
    m = text.match(/(?:ودني|وديني|خذني|وصلني|دلني|take me to|navigate to)\s+(?:الى |لين |to )?(.*)$/);
    if (m && m[1]) return { type: "go", place: m[1].replace(/^لل/, "ال").replace(/^لا/, "ا").trim() };
    m = text.match(/(?:وين اقرب|اين اقرب|where is the nearest|nearest)\s+(.*)$/);
    if (m && m[1]) return { type: "go", place: "اقرب " + m[1].trim() };
    for (const [cmd, words] of PHRASES) if (words.some(w => text.includes(normalize(w)))) return { type: "cmd", cmd };
    return { type: "question", text: raw };
  }
  const wordList = (s) => (s || "").split(",").map(w => normalize(w)).filter(Boolean);
  const isYes = (r) => /(نعم|^اي|ايوه|ايه|اكيد|تمام|اوكي|yes|yeah|sure|ok)/.test(normalize(r)) || wordList(t().v.yesWords).some(w => normalize(r).includes(w));
  const isNo = (r) => /^(لا|لاء|مب لازم|no|cancel)\b/.test(normalize(r)) || wordList(t().v.noWords).some(w => normalize(r).startsWith(w));

  function handleHeard(raw) {
    // The same sentence can arrive twice (early interim result, then the final one).
    const key = normalize(raw);
    if (key === handledText && Date.now() - handledAt < 3000) return;
    handledText = key;
    handledAt = Date.now();
    const awaiting = awaitingCommandUntil > Date.now();
    awaitingCommandUntil = 0;

    if (pendingConfirm && pendingConfirm.until > Date.now()) {
      const { action } = pendingConfirm;
      pendingConfirm = null;
      if (isNo(raw)) { speak(t().v.ok); return; }
      if (isYes(raw)) { action(); return; }
    }
    let command = afterWake(raw);
    if (command !== null && trialVoiceUntil > Date.now() && /^(خلاص|تمام|عجبني|ok|keep)/.test(command)) {
      trialVoiceUntil = 0; speak(t().v.voiceKept); return;
    }
    if (command === null) {
      if (!awaiting) return; // other people talking: ignore
      command = raw;
    }
    if (!command) { awaitingCommandUntil = Date.now() + 8000; vibrate(40); speak(t().v.yes); return; }
    run(parse(command));
  }

  function run(intent) {
    const V = t().v;
    if (!intent) { speak(V.notHeard); return; }
    switch (intent.type) {
      case "sos": return askSos();
      case "save": return savePlace(intent.name);
      case "go": return navigateTo(intent.place);
      case "question": return lookAndSay("ask", intent.text);
      case "cmd":
        switch (intent.cmd) {
          case "describe": return lookAndSay("describe");
          case "read": return lookAndSay("read");
          case "translate": return lookAndSay("translate");
          case "money": return lookAndSay("money");
          case "color": return lookAndSay("color");
          case "repeat": return speak(lastReply || V.nothing);
          case "stop": controller && controller.abort(); stopSpeaking(); return setTimeout(startListening, 300);
          case "where": return whereAmI();
          case "share": return sendLocation(false);
          case "nextVoice": return nextVoice();
          case "keepVoice": return speak(V.voiceKept);
          case "faster": return changeRate(+0.2);
          case "slower": return changeRate(-0.2);
          case "walkStart": return setWalking(true);
          case "walkStop": return setWalking(false);
        }
    }
  }

  function startListening() {
    if (!SR || !settings.handsFree || listening || busy || speakingUntilIdle || isSpeaking()) return;
    recognition = new SR();
    recognition.lang = langInfo(settings.lang).speech;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) { handleHeard(text); continue; }
        // Act the moment a full command is heard, e.g. «بصير اوصفلي».
        const rest = afterWake(text);
        const intent = rest ? parse(rest) : null;
        if (intent && intent.type === "cmd" && INSTANT.has(intent.cmd)) { handleHeard(text); stopListening(); return; }
      }
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { settings.handsFree = false; speak(t().v.noMic); updateChips(); }
    };
    recognition.onend = () => { listening = false; updateChips(); setTimeout(startListening, 400); };
    try { recognition.start(); listening = true; } catch { listening = false; }
    updateChips();
  }
  function stopListening() {
    if (recognition && listening) { try { recognition.abort(); } catch {} }
    listening = false;
    updateChips();
  }

  // ---------- Choosing a voice ----------
  let trialVoiceUntil = 0;
  const usingEleven = () => settings.voiceEngine === "eleven";
  /** The voices the user can pick from right now: [{ id, name }]. */
  function voiceOptions() {
    if (usingEleven()) return settings.elevenVoices;
    const L = t();
    const voices = voicesForLang();
    const out = [];
    (voices.length ? voices : [{ name: "", lang: settings.lang }]).forEach(v =>
      STYLES.forEach((_, s) => out.push({ id: `${v.name}|${s}`, name: `${v.name || L.autoVoice}، ${L.styleNames ? L.styleNames.split(",")[s] : s + 1}` })));
    return out;
  }
  const currentVoiceId = () => usingEleven() ? settings.elevenVoiceId : settings.voiceName;
  function saveVoice(id) {
    if (usingEleven()) { settings.elevenVoiceId = id; store.set("elevenVoiceId", id); }
    else { settings.voiceName = id; store.set("voiceName", id); }
    fillVoiceSelect();
  }
  function sampleVoice() {
    const voices = voiceOptions();
    const i = voices.findIndex(v => v.id === currentVoiceId());
    const name = i >= 0 ? voices[i].name.replace(/\s*\(.*\)$/, "") : "";
    speak(t().v.voiceSample(name, Math.max(1, i + 1), Math.max(1, voices.length)));
  }
  function nextVoice() {
    const voices = voiceOptions();
    if (voices.length < 2) { speak(t().v.noVoices); return; }
    const i = voices.findIndex(v => v.id === currentVoiceId());
    saveVoice(voices[(i + 1) % voices.length].id);
    trialVoiceUntil = Date.now() + 20000;
    sampleVoice();
  }
  function changeRate(delta) {
    settings.rate = Math.min(1.6, Math.max(0.6, Math.round(((Number(settings.rate) || 1) + delta) * 10) / 10));
    store.set("rate", settings.rate);
    $("rateSelect").value = String([0.8, 1, 1.2, 1.4].reduce((a, b) => Math.abs(b - settings.rate) < Math.abs(a - settings.rate) ? b : a));
    speak(delta > 0 ? t().v.faster : t().v.slower);
  }
  function fillVoiceSelect() {
    const select = $("voiceSelect");
    select.textContent = "";
    if (!usingEleven()) {
      const auto = document.createElement("option");
      auto.value = ""; auto.textContent = t().autoVoice;
      select.append(auto);
    }
    voiceOptions().forEach(v => {
      const o = document.createElement("option");
      o.value = v.id; o.textContent = v.name;
      select.append(o);
    });
    select.value = currentVoiceId();
    $("elevenFields").hidden = !usingEleven();
  }

  async function switchLanguage(code) {
    if (!T[code] && !loadTranslation(code)) {
      speak(t().v.translating);
      await translateUI(code); // falls back to English buttons if it can't translate
    }
    settings.lang = code; store.set("lang", code);
    applyLang();
    stopListening(); // restart recognition in the new language
    speak(t().v.langReady || T.en.v.langReady);
  }

  // ---------- UI wiring ----------
  function updateChips() {
    const L = t();
    $("camDot").classList.toggle("on", !!stream);
    $("camText").textContent = stream ? L.camOn : L.camOff;
    const micOn = !!SR && settings.handsFree;
    $("micDot").classList.toggle("on", micOn && listening);
    $("micText").textContent = micOn ? L.micOn : L.micOff;
  }
  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach(s => { s.hidden = s.dataset.tab !== name; });
    document.querySelectorAll("[data-go]").forEach(b => {
      if (b.dataset.go === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }
  let wakeLock = null;
  async function requestWakeLock() { try { wakeLock = await navigator.wakeLock.request("screen"); } catch {} }

  // The first touch anywhere starts Baseer: phones only allow sound, camera and mic after a tap.
  let started = false;
  async function startBaseer() {
    if (started) return;
    started = true;
    unlockAudio();
    const V = t().v;
    speak(V.welcome);
    requestWakeLock();
    await startCamera();
    if (!settings.key) speak(V.needKey, { queue: true });
  }
  document.addEventListener("pointerdown", startBaseer, { capture: true });
  document.addEventListener("click", startBaseer, { capture: true });
  $("describeBtn").addEventListener("click", () => lookAndSay("describe"));
  document.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => {
    switch (b.dataset.act) {
      case "read": return lookAndSay("read");
      case "translate": return lookAndSay("translate");
      case "money": return lookAndSay("money");
      case "color": return lookAndSay("color");
      case "ask": $("askForm").hidden = false; $("question").focus(); return speak(t().v.ask);
      case "walk": return setWalking(!walking);
      case "where": return whereAmI();
      case "savePlace": awaitingCommandUntil = Date.now() + 10000; return speak(t().v.saveName);
      case "share": return sendLocation(false);
      case "sos":
        if (Date.now() - sosTapAt < 5000) { sosTapAt = 0; return sendLocation(true); }
        sosTapAt = Date.now(); vibrate(150); return speak(t().v.sosAgain);
    }
  }));
  $("askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("question").value.trim();
    $("question").value = "";
    lookAndSay(q ? "ask" : "describe", q);
  });
  $("lastBtn").addEventListener("click", () => speak(lastReply || t().v.nothing));
  // Settings are hidden from the tab bar; the helper opens them with #settings in the address.
  function routeFromHash() { showTab(location.hash === "#settings" ? "settings" : "home"); }
  window.addEventListener("hashchange", routeFromHash);
  document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
    showTab(b.dataset.go);
    speak(t().v.tabs[b.dataset.go]);
  }));
  $("handsFreeToggle").addEventListener("change", (e) => {
    settings.handsFree = e.target.checked;
    store.set("handsFree", settings.handsFree);
    if (settings.handsFree) startListening(); else stopListening();
    updateChips();
  });
  $("voiceSelect").addEventListener("change", (e) => { saveVoice(e.target.value); sampleVoice(); });
  $("engineSelect").addEventListener("change", (e) => {
    settings.voiceEngine = e.target.value; store.set("voiceEngine", settings.voiceEngine);
    fillVoiceSelect();
    if (usingEleven() && settings.elevenKey && !settings.elevenVoices.length) loadElevenVoices(); else sampleVoice();
  });
  $("loadVoices").addEventListener("click", () => {
    unlockAudio();
    settings.elevenKey = $("elevenKey").value.trim(); store.set("elevenKey", settings.elevenKey);
    loadElevenVoices();
  });
  $("rateSelect").addEventListener("change", (e) => { settings.rate = Number(e.target.value); store.set("rate", settings.rate); sampleVoice(); });
  $("testVoice").addEventListener("click", sampleVoice);
  $("saveSettings").addEventListener("click", () => {
    settings.key = $("keyInput").value.trim();
    settings.model = $("modelSelect").value;
    settings.trustedName = $("trustedName").value.trim();
    settings.trustedPhone = $("trustedPhone").value.trim();
    settings.elevenKey = $("elevenKey").value.trim();
    const newLang = $("langSelect").value;
    if (settings.lang !== newLang) settings.voiceName = ""; // phone voices are per language
    Object.entries(settings).forEach(([k, v]) => store.set(k, v));
    if (newLang !== settings.lang) return switchLanguage(newLang);
    applyLang();
    speak(t().v.saved);
    history.replaceState(null, "", location.pathname); // back to the main screen
    showTab("home");
  });

  // Fill the settings form.
  $("keyInput").value = settings.key;
  $("modelSelect").value = settings.model;
  $("trustedName").value = settings.trustedName;
  $("trustedPhone").value = settings.trustedPhone;
  LANGS.forEach(l => { const o = document.createElement("option"); o.value = l.code; o.textContent = l.name; $("langSelect").append(o); });
  $("langSelect").value = settings.lang;
  $("engineSelect").value = settings.voiceEngine;
  $("elevenKey").value = settings.elevenKey;
  if (!["ar", "en"].includes(settings.lang)) loadTranslation(settings.lang);
  $("handsFreeToggle").checked = settings.handsFree;
  $("rateSelect").value = String(settings.rate);
  if (synth) { synth.getVoices(); synth.onvoiceschanged = fillVoiceSelect; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && walking) requestWakeLock(); });
  applyLang();

  routeFromHash();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
