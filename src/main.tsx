import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  window.addEventListener(
    'error',
    (event) => {
      // Suppress cross-origin "Script error." or empty uncaught error notifications from browser extensions/iframes
      if (!event.error && (!event.message || event.message === 'Script error.')) {
        event.preventDefault();
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
  });
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center">
          <div className="max-w-md space-y-4">
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              حدث خطأ غير متوقع / Something went wrong
            </h1>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-full bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition cursor-pointer"
            >
              إعادة تحميل التطبيق / Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
