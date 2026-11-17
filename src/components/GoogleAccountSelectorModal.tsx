import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Key, Loader2, Shield, Terminal, X } from 'lucide-react';
import { AuthUser } from '@/types/notes';

interface GoogleAccountSelectorModalProps {
  isOpen: boolean;
  provider: 'google' | 'github';
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}

interface OAuthStatus {
  googleConfigured: boolean;
  githubConfigured: boolean;
  googleClientId?: string | null;
  githubClientId?: string | null;
  appUrl: string;
  googleCallbackUrl: string;
  githubCallbackUrl: string;
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
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);

  // Test account fallback fields
  const [useTestAccount, setUseTestAccount] = useState(false);
  const [testName, setTestName] = useState(isGoogle ? 'Google User' : 'GitHub User');
  const [testEmail, setTestEmail] = useState(isGoogle ? 'developer@gmail.com' : 'developer@github.com');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentCallbackUrl = `${origin}/api/auth/${provider}/callback`;

  // Listen for popup callback message
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data.user) {
        onSuccess(event.data.user);
        onClose();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, onSuccess, onClose]);

  // Fetch status of server OAuth configuration
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/auth/oauth-status')
      .then((res) => res.json())
      .then((data: OAuthStatus) => setOauthStatus(data))
      .catch(() => setOauthStatus(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const isConfigured = isGoogle
    ? oauthStatus?.googleConfigured ?? false
    : oauthStatus?.githubConfigured ?? false;

  const handleStartRealOAuth = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/auth/${provider}/url`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.url) {
        setError(
          data.error ||
            `${isGoogle ? 'GOOGLE_CLIENT_ID' : 'GITHUB_CLIENT_ID'} is not configured on the server environment.`
        );
        setLoading(false);
        return;
      }

      // Open popup window directly to provider's auth URL
      const width = 560;
      const height = 680;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        data.url,
        `${provider}_oauth_popup`,
        `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`
      );

      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        // Fall back to direct redirect if popup blocked
        window.location.href = data.url;
      } else {
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach server OAuth endpoint.');
      setLoading(false);
    }
  };

  const handleCopyCallbackUrl = () => {
    const url = oauthStatus ? (isGoogle ? oauthStatus.googleCallbackUrl : oauthStatus.githubCallbackUrl) : currentCallbackUrl;
    navigator.clipboard.writeText(url);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  const sampleEnvText = isGoogle
    ? `GOOGLE_CLIENT_ID=your_actual_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_actual_client_secret
APP_URL=${oauthStatus?.appUrl || origin}`
    : `GITHUB_CLIENT_ID=your_actual_github_client_id
GITHUB_CLIENT_SECRET=your_actual_github_client_secret
APP_URL=${oauthStatus?.appUrl || origin}`;

  const handleCopyEnv = () => {
    navigator.clipboard.writeText(sampleEnvText);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  const handleTestAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = Date.now();
    const userId = `usr-oauth-${provider}-${now.toString(36)}`;
    const user: AuthUser = {
      id: userId,
      name: testName.trim() || (isGoogle ? 'Google User' : 'GitHub User'),
      email: testEmail.trim().toLowerCase(),
      createdAt: now,
    };
    onSuccess(user);
    onClose();
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
        className="w-full max-w-[520px] rounded-2xl border border-neutral-200 dark:border-white/15 bg-white dark:bg-[#1a1a1f] shadow-2xl overflow-hidden p-6 sm:p-7 max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-[14.5px] shadow-xs ${
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
                Sign in with {isGoogle ? 'Google' : 'GitHub'}
              </h2>
              <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                Official OAuth 2.0 Authentication
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

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-[13px]">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-neutral-500 dark:text-neutral-400">
              <Loader2 className="w-7 h-7 animate-spin text-blue-600 dark:text-blue-400" />
              <span className="text-[13.5px] font-medium">Opening {isGoogle ? 'Google' : 'GitHub'} sign-in popup...</span>
            </div>
          ) : useTestAccount ? (
            <form onSubmit={handleTestAccountSubmit} className="space-y-4">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-blue-800 dark:text-blue-200 text-[12.5px] leading-relaxed">
                <span className="font-semibold block mb-0.5">Quick Test Login</span>
                Instant sign-in for previewing NoteCraft without requiring live OAuth keys.
              </div>

              <div>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[12px] font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-white/12 bg-white dark:bg-[#121214] text-[13px] text-neutral-950 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setUseTestAccount(false)}
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
            <div className="space-y-4">
              {/* Status Banner */}
              <div
                className={`rounded-xl border p-3.5 text-[12.5px] leading-relaxed ${
                  isConfigured
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold mb-1 text-[13px]">
                  <Shield className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    {isConfigured
                      ? `${isGoogle ? 'Google' : 'GitHub'} OAuth 2.0 Credentials Active`
                      : `Server credentials required for real ${isGoogle ? 'Google' : 'GitHub'} login`}
                  </span>
                </div>
                {isConfigured ? (
                  <div className="space-y-1">
                    <p className="text-neutral-700 dark:text-neutral-300">
                      Client ID: <code className="font-mono text-xs text-neutral-900 dark:text-white bg-neutral-200/60 dark:bg-black/30 px-1.5 py-0.5 rounded break-all">{oauthStatus?.googleClientId || 'Connected'}</code>
                    </p>
                    <p className="text-[12px] text-neutral-600 dark:text-neutral-400">
                      Click the button below to sign in with your real Google account.
                    </p>
                  </div>
                ) : (
                  <p>
                    In Portainer or Docker, replace placeholder values with your real credentials obtained from {isGoogle ? 'Google Cloud Console' : 'GitHub Developer Settings'}.
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Main Action Button */}
              <div>
                <button
                  type="button"
                  onClick={() => void handleStartRealOAuth()}
                  className={`w-full py-2.5 px-4 rounded-xl text-[13.5px] font-medium text-white transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                    isGoogle
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-neutral-900 dark:bg-neutral-800 hover:bg-neutral-800 dark:hover:bg-neutral-700'
                  }`}
                >
                  <span>Connect with {isGoogle ? 'Google' : 'GitHub'} (Popup)</span>
                </button>
              </div>

              {/* Step-by-step Setup Box */}
              <div className="space-y-3 pt-2">
                <h3 className="font-semibold text-neutral-950 dark:text-white text-[13px] flex items-center gap-1.5">
                  <Key className="w-4 h-4 text-blue-500 shrink-0" />
                  <span>Portainer & {isGoogle ? 'Google Cloud' : 'GitHub'} Setup Guide</span>
                </h3>

                {/* 1. Callback URI */}
                <div className="bg-neutral-50 dark:bg-white/[0.03] p-3 rounded-xl border border-neutral-200 dark:border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                      1. Authorized Redirect URI (Add to {isGoogle ? 'Google Console' : 'GitHub App'}):
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyCallbackUrl}
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {copiedCallback ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy URI</span>
                        </>
                      )}
                    </button>
                  </div>
                  <code className="block bg-neutral-200/80 dark:bg-neutral-900 px-2.5 py-1.5 rounded-lg text-xs font-mono text-neutral-900 dark:text-neutral-200 break-all select-all">
                    {oauthStatus ? (isGoogle ? oauthStatus.googleCallbackUrl : oauthStatus.githubCallbackUrl) : currentCallbackUrl}
                  </code>
                </div>

                {/* 2. Portainer Env Config */}
                <div className="bg-neutral-50 dark:bg-white/[0.03] p-3 rounded-xl border border-neutral-200 dark:border-white/10 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-neutral-800 dark:text-neutral-200">
                      2. Environment variables to set in Portainer:
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyEnv}
                      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      {copiedEnv ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy Env</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="bg-neutral-900 text-neutral-200 p-2.5 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed select-all">
{sampleEnvText}
                  </pre>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-normal">
                    Important: Replace <code className="text-neutral-700 dark:text-neutral-300 font-mono">your_actual_client_id</code> and <code className="text-neutral-700 dark:text-neutral-300 font-mono">your_actual_client_secret</code> with your real keys generated in {isGoogle ? 'Google Cloud Credentials' : 'GitHub Developer Settings'}. Restart your Portainer container after applying.
                  </p>
                </div>

                {isGoogle && (
                  <div className="text-[11.5px] text-neutral-500 dark:text-neutral-400 flex items-center justify-between">
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <span>Open Google Cloud Credentials</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span>User Type: Internal or External</span>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between border-t border-neutral-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setUseTestAccount(true)}
                  className="text-[12.5px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
                >
                  Use test account instead
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-lg text-[12.5px] font-medium bg-neutral-100 hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/15 text-neutral-800 dark:text-neutral-200 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
