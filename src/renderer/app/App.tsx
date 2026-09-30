import { useEffect } from 'react';
import { ContextMenuHost } from '../components/ContextMenuHost';
import { Toasts } from '../components/Toasts';
import { QuickInput } from '../features/palette/QuickInput';
import { Dialogs } from '../features/dialogs/Dialogs';
import { useUiStore } from '../stores/ui-store';
import { Workbench } from './Workbench';

export function App(): React.JSX.Element {
  const theme = useUiStore((s) => s.effectiveTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  return (
    <>
      <Workbench />
      <QuickInput />
      <Dialogs />
      <ContextMenuHost />
      <Toasts />
    </>
  );
}
