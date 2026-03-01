import { memo, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";

type DeferredImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  alt: string;
  activationPriority?: number;
  rootMargin?: string;
  suspended?: boolean;
};

const DEFAULT_ROOT_MARGIN = "240px";
const MAX_PRIORITY_DELAY_MS = 180;
const PRIORITY_STEP_MS = 36;

const activationQueue: Array<() => void> = [];
let activationFrameId: number | null = null;

function flushActivationQueue() {
  activationFrameId = null;
  const next = activationQueue.shift();
  next?.();
  if (activationQueue.length > 0) {
    activationFrameId = window.requestAnimationFrame(flushActivationQueue);
  }
}

function enqueueActivation(callback: () => void): () => void {
  activationQueue.push(callback);
  if (activationFrameId === null) {
    activationFrameId = window.requestAnimationFrame(flushActivationQueue);
  }
  return () => {
    const index = activationQueue.indexOf(callback);
    if (index >= 0) {
      activationQueue.splice(index, 1);
    }
    if (activationQueue.length === 0 && activationFrameId !== null) {
      window.cancelAnimationFrame(activationFrameId);
      activationFrameId = null;
    }
  };
}

export const DeferredImage = memo(function DeferredImage({
  src,
  alt,
  activationPriority = 0,
  rootMargin = DEFAULT_ROOT_MARGIN,
  suspended = false,
  ...imgProps
}: DeferredImageProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [shouldAttachSource, setShouldAttachSource] = useState(false);

  useEffect(() => {
    setShouldAttachSource(false);
  }, [src]);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || shouldAttachSource || suspended) {
      return;
    }

    let cancelled = false;
    let removeQueuedActivation: (() => void) | null = null;
    let idleCallbackId: number | null = null;
    let timeoutId: number | null = null;
    let observer: IntersectionObserver | null = null;

    const priorityDelayMs = Math.min(
      MAX_PRIORITY_DELAY_MS,
      Math.max(0, activationPriority) * PRIORITY_STEP_MS
    );

    const activate = () => {
      if (cancelled) return;
      removeQueuedActivation = enqueueActivation(() => {
        if (!cancelled) {
          setShouldAttachSource(true);
        }
      });
    };

    const scheduleActivation = () => {
      if (cancelled || removeQueuedActivation) {
        return;
      }
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(
          () => {
            idleCallbackId = null;
            timeoutId = window.setTimeout(activate, priorityDelayMs);
          },
          { timeout: 240 }
        );
        return;
      }
      timeoutId = window.setTimeout(activate, 16 + priorityDelayMs);
    };

    if (typeof window.IntersectionObserver === "function") {
      observer = new window.IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            observer = null;
            scheduleActivation();
          }
        },
        { root: null, rootMargin }
      );
      observer.observe(image);
    } else {
      scheduleActivation();
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      removeQueuedActivation?.();
    };
  }, [activationPriority, rootMargin, shouldAttachSource, suspended]);

  return (
    <img
      {...imgProps}
      ref={imageRef}
      alt={alt}
      src={shouldAttachSource ? src : undefined}
      data-deferred-image={shouldAttachSource ? "loaded" : "pending"}
    />
  );
});
