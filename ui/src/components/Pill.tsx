import { Button } from '@fluentui/react-components';
import type { ReactNode } from 'react';

/** Filter chip: filled with the accent color when selected (Windows 11 Photos/Store style). */
export const Pill = ({ on, onClick, children, icon }: { on: boolean; onClick: () => void; children: ReactNode; icon?: ReactNode }) => (
  <Button size="small" shape="circular" appearance={on ? 'primary' : 'secondary'} aria-pressed={on}
    icon={icon as any} iconPosition="after" onClick={onClick}>
    {children}
  </Button>
);
