"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyCommand({ command, tone }: { command: string; tone?: "dye" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={
        tone === "dye"
          ? "inline-flex h-9 items-center gap-1 rounded-[8px] bg-black/25 pl-3.5 pr-1 font-mono text-[12.5px] text-white ring-1 ring-white/15"
          : "inline-flex h-9 items-center gap-1 rounded-[6px] bg-s1 pl-3.5 pr-1 font-mono text-[13px] ring-1 ring-line"
      }
    >
      <span className="select-all">
        <span className="opacity-50">$ </span>
        {command}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="copy install command"
        onClick={() => {
          navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
