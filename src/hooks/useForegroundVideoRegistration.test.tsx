import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { ForegroundMediaProvider } from "../contexts/ForegroundMediaContext";
import { useForegroundVideoRegistration } from "./useForegroundVideoRegistration";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useForegroundVideoRegistration", () => {
  it("returns a stable API object when the id does not change", () => {
    const registrations: Array<ReturnType<typeof useForegroundVideoRegistration>> = [];

    function Probe() {
      const registration = useForegroundVideoRegistration("main");

      useEffect(() => {
        registrations.push(registration);
      }, [registration]);

      return null;
    }

    const view = render(
      <ForegroundMediaProvider>
        <Probe />
      </ForegroundMediaProvider>
    );

    view.rerender(
      <ForegroundMediaProvider>
        <Probe />
      </ForegroundMediaProvider>
    );

    expect(registrations).toHaveLength(1);
  });
});
