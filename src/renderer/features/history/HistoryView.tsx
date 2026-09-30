import { Codicon } from '../../components/Codicon';
import { es } from '../../i18n/es';
import { SideBarHeader } from '../side-bar/SideBarHeader';

export function HistoryView(): React.JSX.Element {
  return (
    <div className="sidebar-view" data-view="history">
      <SideBarHeader title={es.sideBar.historyTitle} />
      <div className="empty-state">
        <Codicon name="history" size={48} color="var(--fg-muted)" />
        <p>{es.sideBar.historyEmpty}</p>
      </div>
    </div>
  );
}
