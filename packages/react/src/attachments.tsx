import type { Attachment } from "@tetraslam/kiseki-core";
import { useState } from "react";

/**
 * Images and files attached to a turn or returned by a tool. Images keep their aspect ratio
 * reserved before they load, so nothing below moves when they arrive. Clicking an image toggles
 * it between a thumbnail and its full width.
 */
export function Attachments({ items }: { items: Attachment[] }) {
  return (
    <div className="kiseki-attachments">
      {items.map((item, i) =>
        item.type === "image" && item.url ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: attachments keep their order.
          <ImageAttachment key={i} item={item} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <span key={i} className="kiseki-file">
            <FileIcon />
            <span className="kiseki-mono">{item.name ?? item.media_type ?? "file"}</span>
          </span>
        ),
      )}
    </div>
  );
}

function ImageAttachment({ item }: { item: Attachment }) {
  const [large, setLarge] = useState(false);
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : undefined;
  return (
    <button
      type="button"
      className="kiseki-image"
      data-large={large || undefined}
      aria-expanded={large}
      title={item.name}
      style={{
        aspectRatio: ratio,
        width: item.width
          ? `min(100%, ${large ? item.width : Math.min(item.width, 280)}px)`
          : undefined,
      }}
      onClick={(event) => {
        event.stopPropagation();
        setLarge((l) => !l);
      }}
    >
      <img
        src={item.url}
        alt={item.name ?? "attached image"}
        width={item.width}
        height={item.height}
        loading="lazy"
        decoding="async"
      />
    </button>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 1.75h5.5L12.25 4.5v9.75H4z M9.5 1.75V4.5h2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
