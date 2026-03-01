import { useEffect, useRef } from "react";

type DifficultySectionNumberInputProps = {
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

export function DifficultySectionNumberInput({
  value,
  min,
  max,
  disabled,
  onChange,
}: DifficultySectionNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input) {
      input.value = String(value);
    }
  }, [value]);

  const commitDraft = (rawValue: string) => {
    if (rawValue.trim() === "") return;
    const nextValue = Number(rawValue);
    if (Number.isFinite(nextValue)) {
      onChange(nextValue);
    }
  };

  return (
    <input
      ref={inputRef}
      type="number"
      min={min}
      max={max}
      defaultValue={value}
      disabled={disabled}
      onChange={(event) => {
        commitDraft(event.target.value);
      }}
      onBlur={(event) => {
        const draft = event.currentTarget.value;
        if (draft.trim() === "" || !Number.isFinite(Number(draft))) {
          event.currentTarget.value = String(value);
          return;
        }

        const normalizedValue = Math.max(min, Math.min(max, Math.floor(Number(draft))));
        event.currentTarget.value = String(normalizedValue);
        onChange(normalizedValue);
      }}
      className="mt-1 w-full rounded-md border border-cyan-300/25 bg-black/45 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-cyan-200/70 disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
