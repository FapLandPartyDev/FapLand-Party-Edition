import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/connect")({
  component: ConnectRedirect,
});

function ConnectRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({
      to: "/settings",
      search: { section: "hardware" },
      replace: true,
    });
  }, [navigate]);

  return null;
}
