import { useId, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import edge2 from "./device-guide/edge-2.png";
import solacePro from "./device-guide/solace-pro.png";
import "./CompatibleDevices.css";

export function CompatibleDevices() {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const connectionHintId = useId();
  const products = [
    {
      name: "Lovense Solace Pro",
      control: t`Linear motion`,
      url: "https://www.lovense.com/solace-pro-ai-automatic-blowjob-machine-men",
      image: solacePro,
    },
    {
      name: "Lovense Edge 2",
      control: t`Vibration`,
      url: "https://www.lovense.com/adjustable-prostate-massager",
      image: edge2,
    },
  ];

  return (
    <div>
      <button
        type="button"
        aria-haspopup="dialog"
        className="device-guide-trigger"
        onClick={() => dialogRef.current?.showModal()}
      >
        <span>
          <Trans>Don’t own a device?</Trans>
        </span>
        <span aria-hidden="true">→</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        aria-describedby={connectionHintId}
        className="device-guide"
      >
        <div className="device-guide-layout">
          <header className="device-guide-header">
            <form method="dialog">
              <button type="submit" className="device-guide-back">
                <span aria-hidden="true">←</span> <Trans>Back</Trans>
              </button>
            </form>
          </header>

          <section className="device-guide-hero" aria-labelledby={headingId}>
            <div className="device-guide-hero-copy">
              <h1 id={headingId}>
                <Trans>Compatible with FapLand</Trans>
              </h1>
              <p id={connectionHintId}>
                <Trans>Both devices connect through Intiface Central 3.0 or later.</Trans>
              </p>
            </div>
            <div className="device-guide-art" aria-hidden="true">
              <div className="device-guide-orbit" />
            </div>
          </section>

          <ul className="device-guide-products">
            {products.map(({ name, control, url, image }) => (
              <li key={url}>
                <a
                  className="device-guide-product"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="device-guide-product-art">
                    <img src={image} alt="" width={240} height={240} />
                  </div>
                  <span className="device-guide-product-name">
                    {name}
                    <span className="device-guide-product-control">{control}</span>
                  </span>
                  <span className="device-guide-product-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="device-guide-disclosure">
            <Trans>
              These are affiliate links. Any commissions earned go directly toward FapLand
              development.
            </Trans>
          </p>
        </div>
      </dialog>
    </div>
  );
}
