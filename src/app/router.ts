import { useEffect, useState } from 'react';

export type TabId = 'sleep' | 'journal' | 'stats' | 'profile';
export const TABS: TabId[] = ['sleep', 'journal', 'stats', 'profile'];

export interface Route {
  tab: TabId;
  /** Додаткові сегменти шляху, напр. ['42'] для #/journal/42 */
  rest: string[];
}

function parse(hash: string): Route {
  const [first, ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = (TABS as string[]).includes(first) ? (first as TabId) : 'sleep';
  return { tab, rest };
}

export function navigate(path: string) {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
