import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Key, Loader2, Shield, Terminal, X } from 'lucide-react';
import { AuthUser } from '@/types/notes';

interface GoogleAccountSelectorModalProps {
  isOpen: boolean;
  provider: 'google' | 'github';
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

export function GoogleAccountSelectorModal({
  isOpen,
  provider,
  onClose,
  onSuccess,
}: GoogleAccountSelectorModalProps) {
  const isGoogle = provider === 'google';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [demoName, setDemoName] = useState(isGoogle ? 'Google User' : 'GitHub User');
  const [demoEmail, setDemoEmail] = useState(isGoogle ? 'user@gmail.com' : 'user@github.com');
  const [useDemoFallback, setUseDemoFallback] = useState(false);

  if (!isOpen) return null;

  const handleStartRealOAuth = async () => {
    setError(null);
    setLoading(true);
    const endpoint = isGoogle ? '/api/auth/google' : '/api/auth/github';

    try {
      const res = await fetch(endpoint, { method: 'GET', redirect: 'manual' });
      if (res.status === 503 || res.status >= 400) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'OAuth client credentials are not configured on the server environment.');
        setShowGuide(true);
        setLoading(false);
        return;
      }
      window.location.href = endpoint;
    } catch {
      window.location.href = endpoint;
    }
  };

  const handleDemoAuthenticate = (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    const userId = `usr-oauth-${provider}-${now.toString(36)}`;
    const publicUser: AuthUser = {
      id: userId,
      name: demoName.trim() || (isGoogle ? 'Google User' : 'GitHub User'),
      email: demoEmail.trim().toLowerCase(),
      createdAt: now,
    };
    onSuccess(publicUser);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-modal-title"
        className="w-full max-w-[500px] rounded-2xl border border-neutral-200 dark:border-white/15 bg-white dark:bg-[#1a1a1f] shadow-2xl overflow-hidden p-6 sm:p-7 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[15px] shadow-xs ${
                isGoogle ? 'bg-red-500' : 'bg-neutral-900 dark:bg-neutral-800'
              }`}
            >
              {isGoogle ? 'G' : 'GH'}
            </div>
            <div>
              <h2
                id="oauth-modal-title"
                className="text-[16px] font-semibold text-neutral-950 dark:text-white"
              >
                Sign in with {isGoogle ? 'Google' : 'GitHub'} (Real OAuth 2.0)
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Authenticate securely via official {isGoogle ? 'Google' : 'GitHub'} accounts
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.07] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-[13.5px] font-medium">Redirecting to {isGoogle ? 'Google' : 'GitHub'} OAuth...</span>
            </div>
          ) : showGuide ? (
            <div className="space-y-4 text-[13px] text-neutral-700 dark:text-neutral-300">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-800 dark:text-amber-200 text-[12.5px] leading-relaxed">
                <span className="font-semibold block mb-1">Server Credentials Required</span>
                {error || `To use real ${isGoogle ? 'Google' : 'GitHub'} authentication, you must configure client credentials in your server environment.`}
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-neutral-950 dark:text-white text-[13.5px] flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-blue-500" />
                  <span>How to add real {isGoogle ? 'Google' : 'GitHub'} OAuth credentials</span>
                </h3>

                {isGoogle ? (
                  <div className="space-y-2 text-[12.5px] text-neutral-600 dark:text-neutral-400 leading-relaxed bg-neutral-50 dark:bg-white/[0.03] p-3.5 rounded-xl border border-neutral-200 dark:border-white/10">
                    <p className="font-medium text-neutral-900 dark:text-white">1. Google Cloud Console Setup:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline inline-flex items-center gap-0.5">Google Cloud Console <ExternalLink className="w-3 h-3" /></a> and create/select a project.</li>
                      <li>Configure the OAuth consent screen (Choose <strong>Internal</strong> for organization-only access without verification, or <strong>External</strong> for test users).</li>
                      <li>Create credentials &gt; OAuth client ID &gt; Web application.</li>
                      <li>Add Authorized redirect URI: <code className="bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 rounded text-xs">https://&lt;your-domain&gt;/api/auth/google/callback</code></li>
                    </ul>
                    <p className="font-medium text-neutral-900 dark:text-white mt-2">2. Environment Variables:</p>
                    <pre className="bg-neutral-900 text-neutral-100 p-2.5 rounded-lg text-xs overflow-x-auto font-mono">
{`GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
APP_URL=https://your-app-domain.run.app`}
                    </pre>
                  </div>
                ) : (
                  <div className="space-y-2 text-[12.5px] text-neutral-600 dark:text-neutral-400 leading-relaxed bg-neutral-50 dark:bg-white/[0.03] p-3.5 rounded-xl border border-neutral-200 dark:border-white/10">
                    <p className="font-medium text-neutral-900 dark:text-white">1. GitHub Developer Settings Setup:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Go to GitHub Settings &gt; Developer settings &gt; OAuth Apps &gt; Register a new application.</li>
                      <li>Homepage URL: <code className="bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 rounded text-xs">https://&lt;your-domain&gt;</code></li>
                      <li>Authorization callback URL: <code className="bg-neutral-200 dark:bg-neutral-800 px-1 py-0.5 rounded text-xs">https://&lt;your-domain&gt;/api/auth/github/callback</code></li>
                    </ul>
                    <p className="font-medium text-neutral-900 dark:text-white mt-2">2. Environment Variables:</p>
                    <pre className="bg-neutral-900 text-neutral-100 p-2.5 rounded-lg text-xs overflow-x-auto font-mono">
{`GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
APP_URL=https://your-app-domain.run.app`}
                    </pre>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="px-3 py-2 rounded-lg text-[13px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.07] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setUseDemoFallback(true)}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 cursor-pointer"
                >
                  Use test account instead
                </button>
              </div>
            </div>
          ) : useDemoFallback ? (
            <form onSubmit={handleDemoAuthenticate} className="space-y-4">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-blue-800 dark:text-blue-200 text-[12.5px] leading-relaxed">
                <span className="font-semibold block mb-0.5">Test Account Mode</span>
                Simulating verified sign-in from {isGoogle ? 'Google' : 'GitHub'} without live server secrets.
              </div>

              <div>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={demoName}
                  onChange={(e) => setDemoName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={demoEmail}
                  onChange={(e) => setDemoEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setUseDemoFallback(false)}
                  className="px-3 py-2 rounded-lg text-[13px] font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/[0.07] cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  Continue to Workspace
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 py-4 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-neutral-100 dark:bg-white/[0.06] flex items-center justify-center text-neutral-800 dark:text-neutral-200 font-bold text-xl shadow-xs border border-neutral-200 dark:border-white/10">
                {isGoogle ? 'G' : 'GH'}
              </div>

              <div>
                <h3 className="text-[15px] font-semibold text-neutral-950 dark:text-white mb-1">
                  Connect your {isGoogle ? 'Google' : 'GitHub'} Account
                </h3>
                <p className="text-[13px] text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto leading-relaxed">
                  NoteCraft will securely authenticate your identity using OAuth 2.0 with {isGoogle ? 'Google' : 'GitHub'}.
                </p>
              </div>

              <div className="pt-3 space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleStartRealOAuth()}
                  className={`w-full py-2.5 px-4 rounded-xl text-[13.5px] font-medium text-white transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                    isGoogle
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-neutral-900 dark:bg-neutral-800 hover:bg-neutral-800 dark:hover:bg-neutral-700'
                  }`}
                >
                  <span>Continue with {isGoogle ? 'Google' : 'GitHub'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="w-full py-2 px-4 rounded-xl text-[13px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/[0.06] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>How to configure server OAuth credentials</span>
                </button>
              </div>

<div>
                <span className="flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Secure OAuth 2.0 Flow</span>
                </span>
                <span>Encrypted Session</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
