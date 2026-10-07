using System;
using System.Diagnostics;
using System.Globalization;
using System.Speech.Recognition;
using System.Speech.Synthesis;

public static class SapiSpike {
    public const string Script = "Please review the latest changes, check the tests, and tell me which files need attention before we release the new version.";
    public static int Main(string[] args) {
        if (args.Length == 0) return 2;
        if (args[0] == "generate") {
            using (var voice = new SpeechSynthesizer()) {
                voice.SelectVoice("Microsoft David Desktop");
                voice.Rate = -1;
                voice.SetOutputToWaveFile(args[1], new System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, System.Speech.AudioFormat.AudioBitsPerSample.Sixteen, System.Speech.AudioFormat.AudioChannel.Mono));
                voice.Speak(Script);
            }
            return 0;
        }
        var timer = Stopwatch.StartNew();
        using (var engine = new SpeechRecognitionEngine(new CultureInfo("en-US"))) {
            engine.LoadGrammar(new DictationGrammar());
            engine.SpeechHypothesized += (sender, ev) => Console.WriteLine("HYP\t" + timer.Elapsed.TotalMilliseconds.ToString("F3", CultureInfo.InvariantCulture) + "\t" + ev.Result.Text);
            engine.SpeechRecognized += (sender, ev) => Console.WriteLine("TEXT\t" + timer.Elapsed.TotalMilliseconds.ToString("F3", CultureInfo.InvariantCulture) + "\t" + ev.Result.Text);
            engine.SetInputToWaveFile(args[1]);
            while (engine.Recognize() != null) { }
        }
        Console.WriteLine("DONE\t" + timer.Elapsed.TotalMilliseconds.ToString("F3", CultureInfo.InvariantCulture));
        return 0;
    }
}
