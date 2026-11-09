import { type Converted, convert } from "./convert";

export interface Dropped extends Converted {
  name: string;
}

/** Files over this size parse off the main thread. */
const WORKER_THRESHOLD = 5 * 1024 * 1024;

export async function readTraceFile(file: File): Promise<Dropped> {
  const result = file.size > WORKER_THRESHOLD ? await inWorker(file) : convert(await file.text());
  if (!result.records.length) {
    throw new Error(result.issues[0]?.message ?? "no traces found in that file");
  }
  return { ...result, name: file.name };
}

function inWorker(file: File): Promise<Converted> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (
      event: MessageEvent<{ ok: boolean; result?: Converted; error?: string }>,
    ) => {
      worker.terminate();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "couldn't parse that file"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "couldn't parse that file"));
    };
    worker.postMessage(file);
  });
}
