import { useState, useCallback, useMemo } from "react";
import { useGamepad, type GamepadAction } from "./useGamepad";
import { playHoverSound, playSelectSound } from "../utils/audio";

export interface MenuOption {
    id: string;
    label: string;
    primary?: boolean;
    experimental?: boolean;
    badge?: string;
    subLabel?: string;
    statusTone?: "default" | "success" | "warning" | "danger";
    action?: () => void;
    submenu?: MenuOption[];
}

export function useMenuNavigation(rootOptions: MenuOption[]) {
    // Stores sequence of integer indices to reach current menu level
    // i.e. [] is the root menu
    // [0] means we are currently viewing `rootOptions[0].submenu`
    const [path, setPath] = useState<number[]>([]);

    // Selected index inside the CURRENT menu list
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Compute the current visible options based on the path
    const currentOptions = useMemo(() => {
        let currentLevel = rootOptions;
        for (const index of path) {
            const nextNode = currentLevel[index];
            if (nextNode?.submenu) {
                currentLevel = nextNode.submenu;
            } else {
                break;
            }
        }
        return currentLevel;
    }, [rootOptions, path]);

    // Go up one level, restoring previous index if we want (for now, simply default to 0 to make it easy to reach top)
    const goBack = useCallback(() => {
        setPath((prevPath) => {
            if (prevPath.length > 0) {
                playSelectSound();
                return prevPath.slice(0, -1);
            }
            return prevPath;
        });
        setSelectedIndex(0);
    }, []);

    const executeCurrentOption = useCallback((index: number) => {
        playSelectSound();
        const option = currentOptions[index];
        if (option.submenu) {
            // Dive into submenu
            setPath((prev) => [...prev, index]);
            setSelectedIndex(0);
        } else if (option.action) {
            option.action();
        }
    }, [currentOptions]);

    const handleGamepadInput = useCallback(
        (action: GamepadAction) => {
            if (action === "UP") {
                setSelectedIndex((prev) => {
                    // + 1 for the synthesized back button if not at root
                    const len = path.length > 0 ? currentOptions.length + 1 : currentOptions.length;
                    const newIdx = prev > 0 ? prev - 1 : len - 1;
                    playHoverSound();
                    return newIdx;
                });
                return;
            }

            if (action === "DOWN") {
                setSelectedIndex((prev) => {
                    const len = path.length > 0 ? currentOptions.length + 1 : currentOptions.length;
                    const newIdx = prev < len - 1 ? prev + 1 : 0;
                    playHoverSound();
                    return newIdx;
                });
                return;
            }

            if (action === "A") {
                if (path.length > 0 && selectedIndex === currentOptions.length) {
                    goBack();
                } else {
                    executeCurrentOption(selectedIndex);
                }
                return;
            }

            if (action === "B") {
                if (path.length > 0) {
                    goBack();
                }
                return;
            }
        },
        [currentOptions, selectedIndex, path, executeCurrentOption, goBack]
    );

    useGamepad(handleGamepadInput);

    const handleMouseEnter = useCallback(
        (index: number) => {
            if (selectedIndex !== index) {
                playHoverSound();
                setSelectedIndex(index);
            }
        },
        [selectedIndex]
    );

    const handleClick = useCallback(
        (index: number) => {
            if (path.length > 0 && index === currentOptions.length) {
                goBack();
            } else {
                executeCurrentOption(index);
            }
        },
        [path, currentOptions, executeCurrentOption, goBack]
    );

    return {
        selectedIndex,
        handleMouseEnter,
        handleClick,
        currentOptions,
        depth: path.length,
        goBack
    };
}
