import { useEffect } from "react";

export function useGlobalParallax() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;

    const applyParallax = (x: number, y: number) => {
      root.style.setProperty("--parallax-x", String(x));
      root.style.setProperty("--parallax-y", String(y));
    };

    const onPointerMove = (event: PointerEvent) => {
      const normalizedX = ((event.clientX / window.innerWidth) - 0.5) * 2;
      const normalizedY = ((event.clientY / window.innerHeight) - 0.5) * 2;

      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        applyParallax(normalizedX, normalizedY);
      });
    };

    const reset = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        applyParallax(0, 0);
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
      if (raf) cancelAnimationFrame(raf);
      applyParallax(0, 0);
    };
  }, []);
}

