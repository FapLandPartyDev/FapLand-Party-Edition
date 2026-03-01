import type { ReactNode } from "react";
import type { PerkIconKey } from "../../game/types";

type PerkIconProps = {
  iconKey: PerkIconKey | null | undefined;
  className?: string;
  title?: string;
};

export function getPerkIconGlyph(iconKey: PerkIconKey | null | undefined): string {
  switch (iconKey) {
    case "loadedDice":
      return "◆";
    case "steadySteps":
      return "⇧";
    case "longInterlude":
      return "◷";
    case "jammedDice":
      return "⛓";
    case "cementBoots":
      return "▦";
    case "coldStreak":
      return "❄";
    case "scoreLeech":
      return "◌";
    case "panicLoop":
      return "↻";
    case "stickyFingers":
      return "✋";
    case "snakeEyes":
      return "⚁";
    case "milker":
      return "◉";
    case "noRest":
      return "☾";
    case "highspeed":
      return "⇈";
    case "virus":
      return "☣";
    case "virusMax":
      return "☢";
    case "succubus":
      return "♆";
    case "jackhammer":
      return "⚒";
    case "pause":
      return "⏸";
    case "skip":
      return "⏭";
    case "heal":
      return "✚";
    case "shield":
      return "🛡";
    case "cleaner":
      return "🧹";
    case "doubler":
      return "2×";
    case "lazyHero":
      return "☁";
    case "gooooal":
      return "★";
    case "beGentle":
      return "~";
    default:
      return "✦";
  }
}

function resolvePath(iconKey: PerkIconKey | null | undefined): ReactNode {
  switch (iconKey) {
    case "loadedDice":
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="9" cy="9" r="1.5" fill="currentColor" />
          <circle cx="15" cy="12" r="1.5" fill="currentColor" />
          <circle cx="11.5" cy="16" r="1.5" fill="currentColor" />
        </>
      );
    case "steadySteps":
      return (
        <>
          <path d="M6 18V8" />
          <path d="M10 18V6" />
          <path d="M14 18V10" />
          <path d="M6 8l4-4 4 4" />
        </>
      );
    case "longInterlude":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v6l4 2" />
        </>
      );
    case "jammedDice":
      return (
        <>
          <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
          <path d="M6 15l9-9" />
          <path d="M9 18l9-9" />
          <circle cx="9" cy="9" r="1.4" fill="currentColor" />
          <circle cx="15" cy="15" r="1.4" fill="currentColor" />
        </>
      );
    case "cementBoots":
      return (
        <>
          <path d="M5 15h6l2 4H5z" />
          <path d="M11 15h7l1 4h-6z" />
          <path d="M8 15V9h4v6" />
          <path d="M14 15v-4h3v4" />
        </>
      );
    case "coldStreak":
      return (
        <>
          <path d="M12 4v16" />
          <path d="M8 6l4 4 4-4" />
          <path d="M8 18l4-4 4 4" />
          <path d="M5 12h14" />
          <path d="M7 8l2 2" />
          <path d="M15 14l2 2" />
        </>
      );
    case "scoreLeech":
      return (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 6v12" />
          <path d="M16 8c-1-1.2-2.2-2-4-2-2.4 0-4 1.2-4 3s1.8 2.6 4 3 4 1.2 4 3-1.6 3-4 3c-1.8 0-3.2-.7-4.2-2" />
        </>
      );
    case "panicLoop":
      return (
        <>
          <path d="M12 5a7 7 0 1 0 6.2 3.7" />
          <path d="M15 4h4v4" />
          <path d="M12 9v4l3 2" />
        </>
      );
    case "stickyFingers":
      return (
        <>
          <path d="M8 13V7a1 1 0 0 1 2 0v5" />
          <path d="M10 12V5.5a1 1 0 0 1 2 0V12" />
          <path d="M12 12V6a1 1 0 0 1 2 0v6" />
          <path d="M14 13V8a1 1 0 0 1 2 0v7" />
          <path d="M8 12l-2-1a1.4 1.4 0 0 0-1.7 2.1l3.2 4.6A4 4 0 0 0 10.8 19H15a4 4 0 0 0 4-4v-1.5" />
        </>
      );
    case "snakeEyes":
      return (
        <>
          <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
          <circle cx="9" cy="9" r="1.5" fill="currentColor" />
          <circle cx="15" cy="15" r="1.5" fill="currentColor" />
          <path d="M6 18L18 6" />
        </>
      );
    case "milker":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 4v3M20 12h-3M12 20v-3M4 12h3" />
        </>
      );
    case "noRest":
      return (
        <>
          <path d="M14 5a7 7 0 1 0 5 10.5A6 6 0 1 1 14 5z" />
        </>
      );
    case "highspeed":
      return (
        <>
          <path d="M4 16h12" />
          <path d="M8 12h12" />
          <path d="M12 8h8" />
          <path d="M13 6l7 6-7 6" />
        </>
      );
    case "virus":
      return (
        <>
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
          <circle cx="12" cy="5.5" r="2" />
          <circle cx="17.6" cy="8.4" r="2" />
          <circle cx="17.6" cy="15.6" r="2" />
          <circle cx="12" cy="18.5" r="2" />
          <circle cx="6.4" cy="15.6" r="2" />
          <circle cx="6.4" cy="8.4" r="2" />
          <path d="M12 7.5v2.3M15.8 9.3l-1.8 1.3M15.8 14.7l-1.8-1.3M12 16.5v-2.3M8.2 14.7l1.8-1.3M8.2 9.3l1.8 1.3" />
        </>
      );
    case "virusMax":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 5v14M5 12h14" />
          <path d="M7.5 7.5l9 9M16.5 7.5l-9 9" />
        </>
      );
    case "succubus":
      return (
        <>
          <path d="M12 4c3.8 0 7 3 7 6.8 0 4.4-4.1 7.1-7 9.2-2.9-2.1-7-4.8-7-9.2C5 7 8.2 4 12 4z" />
          <path d="M9 10c1.4.2 2.6.2 3 0s1.6-.2 3 0" />
        </>
      );
    case "jackhammer":
      return (
        <>
          <path d="M6 9h9l3 3-3 3H6z" />
          <path d="M6 11H3M6 13H2" />
          <path d="M15 9V6h3v3" />
          <path d="M15 15v3h3v-3" />
        </>
      );
    case "pause":
      return (
        <>
          <rect x="6" y="5" width="4" height="14" rx="1.2" />
          <rect x="14" y="5" width="4" height="14" rx="1.2" />
        </>
      );
    case "skip":
      return (
        <>
          <path d="M6 6l7 6-7 6z" />
          <path d="M13 6l7 6-7 6z" />
          <path d="M20 6v12" />
        </>
      );
    case "heal":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3l7 3v5c0 4.5-2.6 7.7-7 10-4.4-2.3-7-5.5-7-10V6z" />
        </>
      );
    case "cleaner":
      return (
        <>
          <path d="M5 18h14" />
          <path d="M7 18l2-9h6l2 9" />
          <path d="M9 9l1-2h4l1 2" />
        </>
      );
    case "doubler":
      return (
        <>
          <path d="M5 9l4 3-4 3" />
          <path d="M11 9l4 3-4 3" />
          <path d="M16 8v8" />
          <path d="M19 8h2v8h-2" />
        </>
      );
    case "lazyHero":
      return (
        <>
          <path d="M7 17h9a4 4 0 1 0-.8-7.9A5 5 0 0 0 6 11a3 3 0 0 0 1 6z" />
        </>
      );
    case "gooooal":
      return (
        <>
          <path d="M12 3l2.3 5 5.5.6-4.1 3.7 1.2 5.4L12 15l-4.9 2.7 1.2-5.4L4.2 8.6l5.5-.6z" />
        </>
      );
    case "beGentle":
      return (
        <>
          <path d="M4 13c1.5-2 2.5-2 4 0s2.5 2 4 0 2.5-2 4 0 2.5 2 4 0" />
          <path d="M4 9c1.5-2 2.5-2 4 0" />
        </>
      );
    default:
      return (
        <>
          <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
        </>
      );
  }
}

export function PerkIcon({ iconKey, className, title }: PerkIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title ? <title>{title}</title> : null}
      {resolvePath(iconKey)}
    </svg>
  );
}
