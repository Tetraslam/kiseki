"use client";

import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

/**
 * The host's chat input, under the trace. In the demos it starts the recorded run; it doesn't
 * call a model.
 */
export function Composer({
  prompt,
  running,
  onSend,
  onStop,
  placeholder = "message the agent",
}: {
  prompt?: string;
  running?: boolean;
  onSend?: (text: string) => void;
  onStop?: () => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(prompt ?? "");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(prompt ?? ""), [prompt]);
  const send = () => {
    if (running) return onStop?.();
    if (text.trim()) onSend?.(text);
  };
  return (
    <div className="border-t border-line bg-[var(--kiseki-bg,var(--bg))] p-3">
      <div className="flex items-end gap-2 rounded-[12px] bg-s1 p-2 pl-3.5 ring-1 ring-line transition-shadow duration-[90ms] focus-within:ring-[color-mix(in_srgb,var(--accent)_55%,transparent)]">
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label="message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-24 min-h-6 flex-1 resize-none bg-transparent py-1 text-[14px] leading-6 text-foreground outline-none placeholder:text-ink-3 [field-sizing:content]"
        />
        <button
          type="button"
          onClick={send}
          aria-label={running ? "stop" : "send"}
          disabled={!running && !text.trim()}
          className="grid size-8 flex-none place-items-center rounded-[8px] bg-foreground text-background transition-opacity duration-[90ms] hover:opacity-85 disabled:opacity-30"
        >
          {running ? <StopIcon weight="fill" size={14} /> : <ArrowUpIcon weight="bold" size={15} />}
        </button>
      </div>
    </div>
  );
}
