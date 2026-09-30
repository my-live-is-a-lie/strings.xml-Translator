import React, { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PWAInstallButtonProps {
  appLang?: 'ar' | 'en';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ appLang = 'ar' }) => {
  const isAr = appLang === 'ar';
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    try {
      // Detect standalone mode (already installed)
      const isStandalone =
        (typeof window.matchMedia === 'function' &&
          window.matchMedia('(display-mode: standalone)').matches) ||
        (window.navigator as unknown as { standalone?: boolean })?.standalone === true;
      setIsInstalled(isStandalone);

      const userAgent = (window.navigator?.userAgent || '').toLowerCase();
      const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
      setIsIOS(isIOSDevice);
    } catch {
      // Ignore environment detection errors
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    } catch {
      // Ignore install prompt cancellation or browser errors
    }
  };

  if (isInstalled) {
    return null;
  }

  if (deferredPrompt) {
    return (
      <button
        id="pwa-install-btn"
        onClick={handleInstallClick}
        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium shadow-xs transition cursor-pointer m3-state-layer"
        title={
          isAr
            ? 'تثبيت تطبيق مترجم نصوص أندرويد على جهازك'
            : 'Install Android Strings Translator on your device'
        }
      >
        <Smartphone className="w-3.5 h-3.5" />
        <span>{isAr ? 'تثبيت التطبيق' : 'Install App'}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          id="pwa-ios-guide-btn"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition cursor-pointer m3-state-layer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isAr ? 'تثبيت' : 'Install'}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1E1F20] p-6 m3-elevation-3 border border-slate-200/80 dark:border-slate-800/80">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  {isAr ? 'التثبيت على الشاشة الرئيسية' : 'Install to Home Screen'}
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  {isAr
                    ? 'لاستخدام هذا التطبيق بدون إنترنت على جهاز iPhone أو iPad:'
                    : 'To use this app offline on your iPhone or iPad:'}
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-700 dark:text-slate-200 text-xs leading-relaxed">
                  {isAr ? (
                    <>
                      <li>
                        اضغط على أيقونة <strong>المشاركة</strong> في شريط أدوات متصفح Safari.
                      </li>
                      <li>
                        مرّر لأسفل واضغط على <strong>إضافة إلى الشاشة الرئيسية</strong>.
                      </li>
                      <li>افتح التطبيق مباشرة من الشاشة الرئيسية للوصول الكامل بدون إنترنت.</li>
                    </>
                  ) : (
                    <>
                      <li>
                        Tap the <strong>Share</strong> icon in the Safari toolbar.
                      </li>
                      <li>
                        Scroll down and tap <strong>Add to Home Screen</strong>.
                      </li>
                      <li>Open directly from your home screen for 100% offline access.</li>
                    </>
                  )}
                </ol>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] py-2.5 text-xs font-semibold text-white dark:text-[#062E6F] shadow-xs transition m3-state-layer"
              >
                {isAr ? 'حسناً' : 'Got it'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
