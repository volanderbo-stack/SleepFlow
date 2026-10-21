import { TAG_IDS, type TagId } from '../db/types';
import { uk } from '../i18n/uk';

interface Props {
  value: TagId[];
  onChange: (tags: TagId[]) => void;
}

export function TagPicker({ value, onChange }: Props) {
  const toggle = (t: TagId) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="chips">
      {TAG_IDS.map((t) => {
        const on = value.includes(t);
        return (
          <button key={t} type="button" className={`chip${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => toggle(t)}>
            <span aria-hidden="true">{uk.tagEmoji[t]}</span>
            {uk.tags[t]}
          </button>
        );
      })}
    </div>
  );
}
