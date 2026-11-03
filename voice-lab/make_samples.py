"""Makes Arabic samples with every downloaded Piper voice and times them."""
import glob, os, sys, time, wave, resource
from piper import PiperVoice, SynthesisConfig

models, out = sys.argv[1], sys.argv[2]
texts = {
    # With full diacritics (what Piper needs for correct Arabic).
    "welcome_diacritized": "هَلَّا، مَعَكَ بَصِير.",
    "describe_diacritized": "بِكُلِّ سُرُورٍ، سَأَصِفُ لَكَ مَا أَرَاهُ. انْتَبِهْ، يَبْدُو أَنَّ هُنَاكَ طَاوِلَةً أَمَامَكَ عَلَى بُعْدِ خُطْوَتَيْنِ تَقْرِيبًا. وَعَلَى يَمِينِكَ بَابٌ مَفْتُوحٌ.",
    "numbers_diacritized": "النَّصُّ الْمَكْتُوبُ هُوَ: صَيْدَلِيَّةُ النُّورِ، شَارِعُ الشَّيْخِ زَايِد. السِّعْرُ خَمْسَةٌ وَعِشْرُونَ دِرْهَمًا.",
    # Without diacritics (what the AI normally writes) to show the difference.
    "describe_plain": "بكل سرور، سأصف لك ما أراه. انتبه، يبدو أن هناك طاولة أمامك على بعد خطوتين تقريبا. وعلى يمينك باب مفتوح.",
}
lines = []
for onnx in sorted(glob.glob(os.path.join(models, "*.onnx"))):
    name = os.path.basename(onnx).replace(".onnx", "")
    t0 = time.time()
    voice = PiperVoice.load(onnx)
    load = time.time() - t0
    for label, text in texts.items():
        for speed_name, length_scale in (("normal", 1.0), ("slower", 1.15)):
            if label != "describe_diacritized" and speed_name == "slower":
                continue
            path = os.path.join(out, f"{name}__{label}__{speed_name}.wav")
            t1 = time.time()
            with wave.open(path, "wb") as w:
                voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=length_scale))
            took = time.time() - t1
            with wave.open(path) as r:
                seconds = r.getnframes() / r.getframerate()
            lines.append(f"{name}\t{label}\t{speed_name}\tload {load:.2f}s\tsynth {took:.2f}s\taudio {seconds:.2f}s\tRTF {took/seconds:.3f}")
peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
lines.append(f"peak memory {peak:.0f} MB, CPU: {os.cpu_count()} cores (GitHub runner)")
open(os.path.join(out, "timings.txt"), "w").write("\n".join(lines) + "\n")
