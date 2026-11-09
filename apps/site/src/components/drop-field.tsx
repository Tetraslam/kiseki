"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Takes a trace file dropped anywhere on the page. While a file is over the window, the page
 * says it will read it, in place.
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
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

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
    <>
      {children}
      <div
        aria-hidden
        data-on={receiving || undefined}
        className="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-3 rounded-[14px] bg-[color-mix(in_oklab,var(--ai-deep)_86%,transparent)] opacity-0 ring-1 ring-white/0 transition-[opacity,box-shadow] duration-[180ms] ease-track data-on:opacity-100 data-on:ring-white/30"
      >
        <span className="font-display text-[44px] text-white">ここに置く</span>
        <span className="text-[13px] text-white/70">
          drop it. it&apos;s read in your browser, never uploaded.
        </span>
      </div>
    </>
  );
}

/** A button that opens the file chooser. */
export function OpenFile({
  onFile,
  children,
}: {
  onFile: (file: File) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="underline decoration-white/30 underline-offset-3 transition-colors duration-[90ms] hover:decoration-white"
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,.jsonl,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="trace file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
