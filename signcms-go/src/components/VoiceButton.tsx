import { useState, useRef } from "react";
import { Mic, MicOff } from "lucide-react";
import { clsx } from "clsx";

interface Props {
  onTranscript: (text: string) => void;
  disabled?:    boolean;
  language?:    string;
}

type SpeechRecInstance = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror:  (() => void) | null;
  onend:    (() => void) | null;
  start(): void; stop(): void;
};

type SpeechRecCtor = new () => SpeechRecInstance;

function getSpeechRec(): SpeechRecCtor | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as SpeechRecCtor | undefined;
}

export function VoiceButton({ onTranscript, disabled, language = "zh-TW" }: Props) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecInstance | null>(null);

  const SpeechRec = getSpeechRec();
  if (!SpeechRec) return null;

  const toggle = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }

    const rec           = new SpeechRec();
    rec.lang            = language;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript.trim()) onTranscript(transcript.trim());
    };
    rec.onerror  = () => setListening(false);
    rec.onend    = () => setListening(false);

    rec.start();
    recRef.current = rec;
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      className={clsx(
        "p-2 rounded-full transition-colors",
        listening
          ? "bg-red-500 text-white animate-pulse"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-700",
        disabled && "opacity-40 pointer-events-none",
      )}
      aria-label={listening ? "Stop recording" : "Start voice input"}
    >
      {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </button>
  );
}
