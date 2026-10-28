import { useShortcuts, useWindowIntegration } from './app/hooks';
import { Viewport } from './canvas/Viewport';
import { Dialogs } from './ui/Dialogs';
import { Dock } from './ui/Dock';
import { StatusBar } from './ui/StatusBar';
import { ToolRail } from './ui/ToolRail';
import { OptionsBar, TopBar } from './ui/TopBar';

export function App() {
  useShortcuts();
  useWindowIntegration();
  return (
    <div className="app">
      <TopBar />
      <OptionsBar />
      <ToolRail />
      <main className="workspace">
        <Viewport />
      </main>
      <Dock />
      <StatusBar />
      <Dialogs />
    </div>
  );
}
