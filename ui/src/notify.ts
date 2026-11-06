export type Intent = 'success' | 'info' | 'warning' | 'error';
type Dispatch = (message: string, intent: Intent) => void;

let dispatch: Dispatch = () => {};

/** Called once by the toaster host component. */
export function setNotifier(fn: Dispatch) { dispatch = fn; }

export const notify = (message: string, intent: Intent = 'success') => dispatch(message, intent);
export const notifyError = (e: unknown) => dispatch(e instanceof Error ? e.message : String(e), 'error');
