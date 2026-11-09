"use client";

import { FileArrowUpIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Takes a trace file dropped anywhere on the page. While a file is over the window, the field
 * shows that it will receive it.
 */
export function DropField({
  onFile,
  children,
}: {
  onFile: (file: File) => void;
  children: ReactNode;
}) {
  const [receiving, setReceiving] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current++;
      setReceiving(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setReceiving(false);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setReceiving(false);
      const file = event.dataTransfer?.files[0];
      if (file) onFileRef.current(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="relative">
      {children}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-sm text-ink-3">
        <p className="max-w-[62ch]">
          drop an opentraces <code className="font-mono text-[12px]">.jsonl</code>, a claude code
          session, an <code className="font-mono text-[12px]">opencode session export</code>, or a
          codex or pi session anywhere on this page. it renders in your browser; nothing is
          uploaded.
        </p>
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <FileArrowUpIcon data-icon="inline-start" />
          open a file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,.jsonl,application/json"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </div>
      <div
        aria-hidden
        data-on={receiving || undefined}
        className="pointer-events-none absolute inset-[-12px] grid place-items-center rounded-xl bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] opacity-0 ring-1 ring-ember/0 backdrop-blur-[2px] transition-[opacity,box-shadow] duration-220 ease-standard data-on:opacity-100 data-on:ring-ember/60"
      >
        <span className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background">
          drop to read it here
        </span>
      </div>
    </div>
  );
}
