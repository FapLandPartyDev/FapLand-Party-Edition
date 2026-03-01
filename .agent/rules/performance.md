---
trigger: always_on
---

# Code Quality: Game Performance & Optimization

You are building a real-time game. Performance, memory management, and maintaining a strict 60fps are your top priorities.

## 1. React Re-render Optimization

- **Prevent Unnecessary Renders:** You MUST wrap complex or frequently updated components in `React.memo()`.
- **Memoize Everything:** Always use `useMemo` for derived calculations and `useCallback` for functions passed as props, especially when passing data down to `@pixi/react` components.
- **Decouple State:** Do not store high-frequency game state (like exact X/Y pixel coordinates of a moving token) in standard React state (`useState`) if it causes the entire game board to re-render. Use `useRef` or a dedicated PixiJS ticker loop for rapid visual updates.

## 2. PixiJS Rendering Pipeline

- **Sprites Over Graphics:** Do not use `PIXI.Graphics` (like `drawRect` or `drawCircle`) for static objects that appear frequently. Instead, use `PIXI.Sprite` with a shared base texture.
- **Cache as Bitmap:** If you must use complex `Graphics` or text that does not change shape, always set `cacheAsBitmap = true`. This forces PixiJS to take a snapshot of the vector graphic and render it as a highly optimized texture.
- **Limit Event Crawling:** For any PixiJS container or sprite that the player does not click on (like the background or non-interactive board tiles), you MUST set `interactiveChildren = false` and `interactive = false`. This prevents the PixiJS event system from wasting CPU cycles calculating hitboxes.

## 3. Network & Hardware Efficiency

- **Debounce & Throttle:** When sending supabase network intents, throttle rapid actions to prevent flooding the network.
- **Non-Blocking Logic:** The hardware synchronization calculation (TheHandy HSP commands) must never block the main rendering thread.
- **Texture Garbage Collection:** Ensure textures and components are properly destroyed (using `.destroy(true)`) when a player leaves a match to prevent memory leaks.
