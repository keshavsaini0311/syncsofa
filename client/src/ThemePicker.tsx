import { useCallback, useState } from 'react';

const THEMES = [
  { id: 'living-room', label: 'Living Room' },
  { id: 'late-show', label: 'Late Show' },
  { id: 'signal', label: 'Signal' },
  { id: 'matinee', label: 'Matinee' },
  { id: 'nightgarden', label: 'Nightgarden' },
] as const;

const STORAGE_KEY = 'syncsofa-theme';
const THEME_IDS = THEMES.map((t) => t.id);

function currentTheme(): string {
  return document.documentElement.dataset.theme ?? 'living-room';
}

/** Compact theme picker for the room header. Persists to localStorage (shared across tabs —
 * unlike the per-tab participant name) and applies instantly; index.html's inline script reads
 * the same key before first paint so a reload never flashes the previous theme. */
export function ThemePicker() {
  const [theme, setTheme] = useState(currentTheme);

  const onChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (!THEME_IDS.includes(next as (typeof THEME_IDS)[number])) return;
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }, []);

  return (
    <label className="theme-picker">
      <span className="theme-picker-label">Theme</span>
      <select value={theme} onChange={onChange} aria-label="Theme">
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}
