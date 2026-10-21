import type { ComponentType } from 'react';
import { TABS, type TabId } from '../app/router';
import { uk } from '../i18n/uk';
import { BookIcon, ChartIcon, MoonIcon, UserIcon } from './Icons';

const ICONS: Record<TabId, ComponentType<{ size?: number }>> = {
  sleep: MoonIcon,
  journal: BookIcon,
  stats: ChartIcon,
  profile: UserIcon,
};

export function TabBar({ active }: { active: TabId }) {
  return (
    <nav className="tabbar" aria-label="Розділи">
      {TABS.map((t) => {
        const Icon = ICONS[t];
        return (
          <a key={t} href={`#/${t}`} className={`tabbar__item${t === active ? ' is-active' : ''}`} aria-current={t === active ? 'page' : undefined}>
            <Icon size={22} />
            <span>{uk.tabs[t]}</span>
          </a>
        );
      })}
    </nav>
  );
}
