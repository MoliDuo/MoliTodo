import { Check } from "lucide-react";
import { useState } from "react";
import { normalizeHex, PRESETS } from "../lib/theme";

/** Preset swatches, a box for a colour code, and the system colour picker. */
export function ColorPicker({
  value,
  onChange,
  noneLabel,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  /** When given, a first swatch that clears the colour. */
  noneLabel?: string;
}) {
  const [code, setCode] = useState(value ?? "");
  const [bad, setBad] = useState(false);
  // A new value from outside (a swatch, another device) replaces whatever was typed.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setCode(value ?? "");
    setBad(false);
  }

  const commit = (input: string) => {
    if (input.trim() === "" && noneLabel) return onChange(null);
    const color = normalizeHex(input);
    if (!color) return setBad(true);
    setBad(false);
    onChange(color);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2.5">
        {noneLabel && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-pressed={value === null}
            className={`border-border text-muted flex h-9 items-center rounded-full border px-3 text-xs ${
              value === null
                ? "ring-text ring-2 ring-offset-2 ring-offset-[var(--moli-surface)]"
                : ""
            }`}
          >
            {noneLabel}
          </button>
        )}
        {PRESETS.map((preset) => (
          <button
            key={preset.color}
            type="button"
            title={`${preset.name} ${preset.color}`}
            aria-label={preset.name}
            aria-pressed={value === preset.color}
            onClick={() => onChange(preset.color)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: preset.color }}
          >
            {value === preset.color && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          commit(code);
        }}
      >
        <label
          className="border-border relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border"
          style={{ background: normalizeHex(code) ?? value ?? "transparent" }}
          title="取色器"
        >
          <input
            type="color"
            aria-label="取色器"
            value={normalizeHex(code) ?? value ?? "#a34e00"}
            onChange={(event) => {
              setCode(event.target.value);
              commit(event.target.value);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          value={code}
          aria-label="色号"
          aria-invalid={bad}
          placeholder="#a34e00"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => {
            setCode(event.target.value);
            setBad(false);
          }}
          onBlur={() => code !== (value ?? "") && commit(code)}
          className={`bg-surface-2 w-32 min-w-0 rounded-lg px-3 py-2 font-mono text-sm outline-none ${
            bad ? "ring-danger ring-1" : "focus:ring-accent focus:ring-1"
          }`}
        />
        <button type="submit" className="bg-surface-2 hover:bg-border rounded-lg px-3 py-2 text-sm">
          用这个
        </button>
      </form>
      {bad && (
        <p className="text-danger mt-1 text-xs">不是色号，要像 #a34e00 这样（6 位，0-9 和 a-f）</p>
      )}
    </div>
  );
}
