"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="inline-flex h-9 items-center gap-1 rounded-lg bg-s1 pl-3.5 pr-1 font-mono text-[13px] ring-1 ring-line">
      <span className="select-all">
        <span className="text-ink-3">$ </span>
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
