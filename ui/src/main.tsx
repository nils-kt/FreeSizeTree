import { createRoot } from 'react-dom/client';
import { boot } from './actions';
import { App } from './App';
import { hasHost } from './bridge';
import { notifyError } from './notify';
import './styles.css';

// The app's own context menus replace the browser's.
document.addEventListener('contextmenu', e => e.preventDefault());

createRoot(document.getElementById('root')!).render(<App />);
if (hasHost) boot().catch(notifyError);
