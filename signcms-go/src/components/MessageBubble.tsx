import { clsx } from "clsx";
import { AlertCircle, Bot, User, Wrench } from "lucide-react";
import type { ChatMessage } from "@/types";

interface Props {
  message: ChatMessage;
}

export function MessageBubble({ message }: Props) {
  const isUser      = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div className={clsx("flex gap-2 px-4", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div className={clsx(
        "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs",
        isUser      ? "bg-brand text-white"       : "bg-slate-700 text-slate-300",
      )}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Bubble */}
      <div className={clsx(
        "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
        isUser
          ? "bg-brand text-white rounded-tr-sm"
          : message.error
          ? "bg-red-950 text-red-200 border border-red-800 rounded-tl-sm"
          : "bg-slate-800 text-slate-100 rounded-tl-sm",
      )}>
        {message.error && (
          <div className="flex items-center gap-1.5 mb-1 text-red-400 text-xs font-medium">
            <AlertCircle className="w-3.5 h-3.5" />
            Error
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs bg-slate-700/60 rounded-lg px-2 py-1.5">
                <Wrench className="w-3 h-3 mt-0.5 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="text-slate-300 font-mono">{tc.tool}</span>
                  <span className="text-slate-500 ml-1">({tc.ms}ms)</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className={clsx(
          "text-[10px] mt-1 opacity-50",
          isUser ? "text-right" : "text-left",
        )}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-2 px-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
        <Bot className="w-3.5 h-3.5 text-slate-300" />
      </div>
      <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
