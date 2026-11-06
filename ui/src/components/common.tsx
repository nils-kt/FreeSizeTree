import { Button, Spinner } from '@fluentui/react-components';
import { Folder20Filled, HardDrive20Regular } from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import { startScan } from '../actions';
import { useStore } from '../store';
import { typeColor } from '../theme';

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="tools">{children}</div>}
    </div>
  );
}

export const Loading = ({ label }: { label?: string }) => (
  <div className="loading"><Spinner label={label} labelPosition="below" /></div>
);

export function Empty({ icon, title, children, actions }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function NeedScan() {
  const drives = useStore(s => s.drives);
  return (
    <Empty icon={<HardDrive20Regular style={{ width: 48, height: 48 }} />} title="Noch kein Scan"
      actions={drives.map(d => (
        <Button key={d.path} appearance={d.system ? 'primary' : 'secondary'} onClick={() => startScan(d.path)}>{d.path} scannen</Button>
      ))}>
      Für diese Ansicht muss zuerst ein Laufwerk gescannt werden.
    </Empty>
  );
}

export function Meter({ value, warn, tall, color }: { value: number; warn?: boolean; tall?: boolean; color?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`meter${warn ? ' warn' : ''}${tall ? ' tall' : ''}`}>
      <i style={{ width: `${w.toFixed(2)}%`, background: color }} />
    </div>
  );
}

export const ExtBadge = ({ ext }: { ext?: string }) => (
  <span className="ext" style={{ ['--c' as string]: typeColor(ext) }}>{(ext || '').replace('.', '').slice(0, 4) || 'file'}</span>
);

/** Folder or file type icon in File Explorer style. */
export const ItemIcon = ({ kind, ext, color }: { kind: 'dir' | 'file'; ext?: string; color?: string }) =>
  kind === 'dir'
    ? <span className="fico"><Folder20Filled style={{ color: color ?? '#e8b443' }} /></span>
    : <span className="fico"><ExtBadge ext={ext} /></span>;
