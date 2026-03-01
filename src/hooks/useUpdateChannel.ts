import { useEffect, useState } from "react";
import {
  UPDATE_CHANNEL_CHANGED_EVENT,
  UPDATE_CHANNEL_KEY,
  normalizeUpdateChannel,
  type UpdateChannel,
} from "../constants/updateSettings";
import { trpc } from "../services/trpc";

export function useUpdateChannel(): UpdateChannel | null {
  const [channel, setChannel] = useState<UpdateChannel | null>(null);

  useEffect(() => {
    let mounted = true;
    void trpc.store.get
      .query({ key: UPDATE_CHANNEL_KEY })
      .then((value) => {
        if (mounted) setChannel(normalizeUpdateChannel(value));
      })
      .catch((error) => console.error("Failed to load update channel", error));

    const handleChange = (event: Event) => {
      setChannel(normalizeUpdateChannel((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(UPDATE_CHANNEL_CHANGED_EVENT, handleChange);
    return () => {
      mounted = false;
      window.removeEventListener(UPDATE_CHANNEL_CHANGED_EVENT, handleChange);
    };
  }, []);

  return channel;
}
