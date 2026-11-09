import { convert } from "./convert";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const text = await event.data.text();
    self.postMessage({ ok: true, result: convert(text) });
  } catch (error) {
    self.postMessage({ ok: false, error: (error as Error).message });
  }
};
