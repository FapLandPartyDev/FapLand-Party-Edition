import { useCallback, useEffect, useMemo } from "react";
import { useForegroundMedia } from "../contexts/ForegroundMediaContext";

export function useForegroundVideoRegistration(id: string) {
  const { register, unregister, setPlaying } = useForegroundMedia();

  useEffect(() => {
    register(id);
    return () => {
      unregister(id);
    };
  }, [id, register, unregister]);

  const markPlaying = useCallback(
    (playing: boolean) => {
      setPlaying(id, playing);
    },
    [id, setPlaying]
  );

  const handlePlay = useCallback(() => {
    setPlaying(id, true);
  }, [id, setPlaying]);

  const handlePause = useCallback(() => {
    setPlaying(id, false);
  }, [id, setPlaying]);

  const handleEnded = useCallback(() => {
    setPlaying(id, false);
  }, [id, setPlaying]);

  return useMemo(
    () => ({
      markPlaying,
      handlePlay,
      handlePause,
      handleEnded,
    }),
    [handleEnded, handlePause, handlePlay, markPlaying]
  );
}
