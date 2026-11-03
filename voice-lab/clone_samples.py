"""Clone the reference voice with Chatterbox Multilingual (Arabic) and make the test sentences."""
import sys, time, os, resource
import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

ref, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
t0 = time.time()
model = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
lines = [f"model load {time.time() - t0:.1f}s"]
texts = {
    "welcome": "هَلَّا، مَعَكَ بَصِير.",
    "describe": "أَمَامَكَ طَاوِلَةٌ، وَعَلَى يَمِينِكَ كُرْسِيٌّ.",
    "describe_plain": "أمامك طاولة، وعلى يمينك كرسي.",
    "read_numbers": "النص المكتوب هو: صيدلية النور، شارع الشيخ زايد. السعر خمسة وعشرون درهماً.",
}
for name, text in texts.items():
    for label, kw in (("calm", dict(exaggeration=0.4, cfg_weight=0.4)), ("default", {})):
        t1 = time.time()
        wav = model.generate(text, language_id="ar", audio_prompt_path=ref, **kw)
        took = time.time() - t1
        seconds = wav.shape[-1] / model.sr
        ta.save(os.path.join(out, f"clone__{name}__{label}.wav"), wav, model.sr)
        lines.append(f"{name}\t{label}\tsynth {took:.1f}s\taudio {seconds:.1f}s\tRTF {took / seconds:.2f}")
lines.append(f"peak memory {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB, CPU {os.cpu_count()} cores")
open(os.path.join(out, "timings.txt"), "w").write("\n".join(lines) + "\n")
print("\n".join(lines))
