import type { CSSProperties } from "react";
import type { MapBackgroundMedia } from "../game/types";

type MapBackgroundMediaProps = {
  background?: MapBackgroundMedia;
  className?: string;
  parallaxOffset?: { x: number; y: number };
  testId?: string;
};

const positionToObjectPosition = (position: MapBackgroundMedia["position"]): string => {
  switch (position) {
    case "top":
      return "center top";
    case "bottom":
      return "center bottom";
    case "left":
      return "left center";
    case "right":
      return "right center";
    case "center":
    default:
      return "center center";
  }
};

const fitToObjectFit = (fit: MapBackgroundMedia["fit"], kind: MapBackgroundMedia["kind"]) => {
  if (fit === "contain") return "contain";
  if (fit === "stretch") return "fill";
  if (fit === "tile" && kind === "image") return "cover";
  return "cover";
};

export function MapBackgroundMedia({
  background,
  className = "",
  parallaxOffset = { x: 0, y: 0 },
  testId = "map-background-media",
}: MapBackgroundMediaProps) {
  if (!background) return null;

  const effectiveOffsetX =
    background.offsetX + (background.motion === "parallax" ? parallaxOffset.x : 0);
  const effectiveOffsetY =
    background.offsetY + (background.motion === "parallax" ? parallaxOffset.y : 0);
  const translate = `translate(${effectiveOffsetX}px, ${effectiveOffsetY}px)`;
  const scale = `scale(${background.scale})`;
  const mediaStyle: CSSProperties = {
    opacity: background.opacity,
    filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
    transform: `${translate} ${scale}`,
    transformOrigin: "center",
  };
  const objectStyle: CSSProperties = {
    ...mediaStyle,
    objectFit: fitToObjectFit(background.fit, background.kind),
    objectPosition: positionToObjectPosition(background.position),
  };

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
      data-testid={testId}
    >
      {background.kind === "image" && background.fit === "tile" ? (
        <div
          className="absolute inset-0"
          style={{
            ...mediaStyle,
            backgroundImage: `url("${background.uri}")`,
            backgroundPosition: positionToObjectPosition(background.position),
            backgroundRepeat: "repeat",
            backgroundSize: `${Math.max(24, 256 * background.scale)}px auto`,
          }}
        />
      ) : background.kind === "video" ? (
        <video
          className="absolute inset-0 h-full w-full"
          src={background.uri}
          muted
          loop
          autoPlay
          playsInline
          style={objectStyle}
        />
      ) : (
        <img
          className="absolute inset-0 h-full w-full"
          src={background.uri}
          alt=""
          draggable={false}
          style={objectStyle}
        />
      )}
      {background.dim > 0 && (
        <div className="absolute inset-0 bg-black" style={{ opacity: background.dim }} />
      )}
    </div>
  );
}
