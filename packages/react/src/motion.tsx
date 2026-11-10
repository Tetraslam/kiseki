import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * Opens and closes its content in place: height and opacity, on the open curve. Opening mounts
 * the content at zero height, measures it, and grows to that many pixels, then lets go to `auto`
 * so later growth isn't clipped. Closing starts from the measured height and keeps the content
 * mounted until the transition ends. Under reduced motion the durations are zero and it snaps.
 */
export function Reveal({
  open,
  children,
}: {
  open: boolean;
  /** Called with whether the content should render. */
  children: (shown: boolean) => ReactNode;
}) {
  const [shown, setShown] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const startedOpen = useRef(open);

  useLayoutEffect(() => {
    if (open) setShown(true);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` re-runs it once the content has mounted.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Content that starts open shows at once; only changes animate.
    if (startedOpen.current) {
      startedOpen.current = false;
      return;
    }
    const instant = Number.parseFloat(getComputedStyle(el).transitionDuration) === 0;
    const settle = (event?: TransitionEvent) => {
      if (event && (event.target !== el || event.propertyName !== "height")) return;
      el.removeEventListener("transitionend", settle);
      el.style.overflow = "";
      if (open) el.style.height = "";
      else setShown(false);
    };
    el.style.overflow = "hidden";
    if (open) {
      // Reopening mid-close continues from where it is.
      if (!el.style.height) el.style.height = "0px";
      const target = el.scrollHeight;
      el.getBoundingClientRect();
      el.style.height = `${target}px`;
    } else {
      el.style.height = `${el.getBoundingClientRect().height}px`;
      el.getBoundingClientRect();
      el.style.height = "0px";
    }
    // Opacity rides along through the Web Animations API, on the same clock as the height.
    for (const running of el.getAnimations())
      if (!(running instanceof CSSTransition)) running.cancel();
    if (!instant)
      el.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }], {
        duration: 180,
        easing: "cubic-bezier(0.25, 0.8, 0.25, 1)",
        fill: open ? "none" : "forwards",
      });
    if (instant) settle();
    else el.addEventListener("transitionend", settle);
    return () => el.removeEventListener("transitionend", settle);
  }, [open, shown]);

  if (!shown) return null;
  return (
    <div ref={ref} className="kiseki-disclosure">
      {children(true)}
    </div>
  );
}
