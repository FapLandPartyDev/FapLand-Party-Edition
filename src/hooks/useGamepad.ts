import { useEffect, useRef } from "react";

export type GamepadAction = "UP" | "DOWN" | "LEFT" | "RIGHT" | "A" | "B";

export const useGamepad = (onInput: (action: GamepadAction) => void) => {
    const requestRef = useRef<number | undefined>(undefined);
    const lastInputTime = useRef<number>(0);
    const debounceMs = 250; // Throttle limit for consecutive inputs

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" || e.key === "Backspace") {
                const now = performance.now();
                if (now - lastInputTime.current > debounceMs) {
                    onInput("B");
                    lastInputTime.current = now;
                }
            } else if (e.key === "ArrowUp") {
                const now = performance.now();
                if (now - lastInputTime.current > debounceMs) {
                    onInput("UP");
                    lastInputTime.current = now;
                }
            } else if (e.key === "ArrowDown") {
                const now = performance.now();
                if (now - lastInputTime.current > debounceMs) {
                    onInput("DOWN");
                    lastInputTime.current = now;
                }
            } else if (e.key === "Enter") {
                const now = performance.now();
                if (now - lastInputTime.current > debounceMs) {
                    onInput("A");
                    lastInputTime.current = now;
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        const checkGamepad = () => {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = gamepads[0];
            const now = performance.now();

            if (gp && now - lastInputTime.current > debounceMs) {
                let actionFired = false;

                // Typical Gamepad Mapping: 
                // Left Stick Y-Axis is axes[1], where -1.0 is UP, 1.0 is DOWN
                // D-Pad UP is buttons[12], D-Pad DOWN is buttons[13]
                // Cross/A Button is buttons[0], Circle/B is buttons[1]

                const leftStickY = gp.axes.length > 1 ? gp.axes[1] : 0;

                const dpadUp = gp.buttons.length > 12 && gp.buttons[12].pressed;
                const dpadDown = gp.buttons.length > 13 && gp.buttons[13].pressed;

                const buttonA = gp.buttons.length > 0 && gp.buttons[0].pressed;
                const buttonB = gp.buttons.length > 1 && gp.buttons[1].pressed;

                if (leftStickY < -0.5 || dpadUp) {
                    onInput("UP");
                    actionFired = true;
                } else if (leftStickY > 0.5 || dpadDown) {
                    onInput("DOWN");
                    actionFired = true;
                } else if (buttonA) {
                    onInput("A");
                    actionFired = true;
                    // Slightly longer debounce for A presses to avoid double clicking
                    lastInputTime.current = now + 100;
                } else if (buttonB) {
                    onInput("B");
                    actionFired = true;
                    lastInputTime.current = now + 100;
                }

                if (actionFired) {
                    lastInputTime.current = now;
                }
            }

            requestRef.current = requestAnimationFrame(checkGamepad);
        };

        requestRef.current = requestAnimationFrame(checkGamepad);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            if (requestRef.current !== undefined) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [onInput]);
};
