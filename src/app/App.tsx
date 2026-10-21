import { useEffect } from 'react';
import { ConfirmDialog, Toast } from '../components/Overlays';
import { TabBar } from '../components/TabBar';
import { MoonIcon } from '../components/Icons';
import { JournalScreen } from '../screens/JournalScreen';
import { NightDetailScreen } from '../screens/NightDetailScreen';
import { NightModeScreen } from '../screens/NightModeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SleepScreen } from '../screens/SleepScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { WhyBadSleepScreen } from '../screens/WhyBadSleepScreen';
import { useRoute } from './router';
import { useApp } from './store';

export function App() {
  const route = useRoute();
  const ready = useApp((s) => s.ready);
  const init = useApp((s) => s.init);
  const nightMode = useApp((s) => s.tracking.phase === 'running' || s.tracking.phase === 'stopping');

  useEffect(() => {
    init().catch((e) => console.error('init failed', e));
  }, [init]);

  if (!ready) {
    return (
      <div className="splash">
        <MoonIcon size={48} />
      </div>
    );
  }

  if (nightMode) {
    return (
      <>
        <NightModeScreen />
        <Toast />
      </>
    );
  }

  let screen;
  const key = `${route.tab}/${route.rest.join('/')}`;
  if (route.tab === 'journal' && route.rest[0]) screen = <NightDetailScreen id={Number(route.rest[0])} />;
  else if (route.tab === 'journal') screen = <JournalScreen />;
  else if (route.tab === 'stats' && route.rest[0] === 'why') screen = <WhyBadSleepScreen />;
  else if (route.tab === 'stats') screen = <StatsScreen />;
  else if (route.tab === 'profile') screen = <ProfileScreen />;
  else screen = <SleepScreen />;

  return (
    <div className="app">
      <main className="app__main" key={key}>
        {screen}
      </main>
      <TabBar active={route.tab} />
      <Toast />
      <ConfirmDialog />
    </div>
  );
}
