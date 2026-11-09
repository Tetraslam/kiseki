import { useCallback, useEffect, useRef, useState } from "react";

/** A value the host may control. Uncontrolled until `value` is passed. */
export function useControllable<T>(
  value: T | undefined,
  initial: T | (() => T),
  onChange: ((next: T) => void) | undefined,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [inner, setInner] = useState(initial);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const latest = useRef(current);
  latest.current = current;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: T) => T)(latest.current) : (next as T);
      if (Object.is(resolved, latest.current)) return;
      latest.current = resolved;
      if (!controlled) setInner(resolved);
      onChangeRef.current?.(resolved);
    },
    [controlled],
  );
  return [current, set];
}

/** True once `active` has stayed true for `ms`. Placeholders wait 200ms so fast loads never flash. */
export function useDelayed(active: boolean, ms = 200): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return shown;
}

export function toggleIn(list: readonly string[], keys: readonly string[], open?: boolean) {
  const set = new Set(list);
  const shouldOpen = open ?? keys.some((key) => !set.has(key));
  for (const key of keys) {
    if (shouldOpen) set.add(key);
    else set.delete(key);
  }
  return [...set];
}
