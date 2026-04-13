import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import type { PendingMfaChallenge } from '../types';

interface LoginPageProps {
  error?: string | null;
  notice?: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onLoginWithPasskey?: () => Promise<void>;
  onVerifyMfa?: (code: string) => Promise<void>;
  onUseEmailMfa?: () => Promise<void>;
  onUseTotpMfa?: () => void;
  onUsePasskeyMfa?: () => Promise<void>;
  onCancelMfa?: () => void;
  pendingMfa?: PendingMfaChallenge | null;
  pendingMfaMethod?: 'totp' | 'email';
  onResendVerification?: (email: string) => Promise<void>;
  resendBusy?: boolean;
  onForgotPassword?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  error,
  notice,
  onLogin,
  onLoginWithPasskey,
  onVerifyMfa,
  onUseEmailMfa,
  onUseTotpMfa,
  onUsePasskeyMfa,
  pendingMfa = null,
  pendingMfaMethod = 'email',
  onResendVerification,
  resendBusy = false,
  onForgotPassword,
}) => {
  const { isZh, t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const logoSrc = `${import.meta.env.BASE_URL}family_tree_logo.png`;
  const landingCopy = isZh
    ? {
        eyebrow: 'Clan Node',
        title: '把家族脈絡整理成可搜尋、可協作、可長期維護的活資料。',
        body: '不是只有一張靜態族譜圖，而是一套可管理帳號、人物資料、稱呼、通知與操作紀錄的家族系統。',
        primaryMetric: '多圖層家族圖譜',
        metrics: [
          { value: 'Graph', label: '視覺化親屬關係' },
          { value: 'Roles', label: '管理員與只讀權限' },
          { value: 'Audit', label: '修改記錄可追蹤' },
        ],
        highlights: [
          '以圖形方式瀏覽親子、手足、配偶與姻親關係',
          '支援邀請登入、Email 驗證、MFA 與 Session 管理',
          '可自訂稱呼、通知流程、圖層與資料備份',
        ],
        featureTitle: '為真正會持續更新的家族資料而設計',
        features: [
          {
            title: '共享同一份族譜',
            description: '管理員維護資料，只讀成員安全查閱，不再散落在紙本、相簿或零碎訊息裡。',
          },
          {
            title: '把細節留在節點上',
            description: '除了姓名與關係，還能延伸到頭像、自訂欄位、時間資訊與多圖層結構。',
          },
          {
            title: '保留治理能力',
            description: '通知、稽核紀錄、關係稱呼與備份流程，讓家族資料能長期維護而不是越用越亂。',
          },
        ],
      }
    : {
        eyebrow: 'Clan Node',
        title: 'Turn family history into a living system instead of a static chart.',
        body: 'Clan Node combines genealogy, access control, notifications, kinship naming, and auditability in one graph-based workspace.',
        primaryMetric: 'Layered family graph',
        metrics: [
          { value: 'Graph', label: 'Visual kinship mapping' },
          { value: 'Roles', label: 'Admin and read-only access' },
          { value: 'Audit', label: 'Traceable change history' },
        ],
        highlights: [
          'Browse parent, sibling, spouse, and in-law relationships as a graph',
          'Support invitations, email verification, MFA, and session controls',
          'Customize relationship labels, notifications, layers, and backups',
        ],
        featureTitle: 'Built for family records that keep evolving',
        features: [
          {
            title: 'One shared source of truth',
            description: 'Admins maintain the data while family members get a clean read-only view instead of fragmented documents and chat threads.',
          },
          {
            title: 'Richer than names on a tree',
            description: 'Store avatars, custom metadata, time details, and layered graph structure directly on the people and relationships you manage.',
          },
          {
            title: 'Operational controls included',
            description: 'Notifications, audit logs, relationship-name management, and backups keep the dataset maintainable over time.',
          },
        ],
      };

  useEffect(() => {
    setMfaCode('');
  }, [pendingMfa?.session_id, pendingMfaMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(email.trim().toLowerCase(), password);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onVerifyMfa) return;
    setSubmitting(true);
    try {
      await onVerifyMfa(mfaCode.trim());
    } finally {
      setSubmitting(false);
    }
  };

  const canResend = Boolean(onResendVerification && email.trim());
  const cardStageKey = pendingMfa ? `mfa-card-${pendingMfaMethod}` : 'login-card';

  const handleResend = async () => {
    if (!onResendVerification || !email.trim()) return;
    await onResendVerification(email.trim().toLowerCase());
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="landing-panel" aria-label={landingCopy.eyebrow}>
          <div className="landing-brand">
            <div className="login-logo-shell landing-logo-shell">
              <img className="login-logo" src={logoSrc} alt="Family Tree logo" />
            </div>
            <span className="landing-eyebrow">{landingCopy.eyebrow}</span>
          </div>
          <h1 className="landing-title">{landingCopy.title}</h1>
          <p className="landing-body">{landingCopy.body}</p>

          <div className="landing-metric-card">
            <strong>{landingCopy.primaryMetric}</strong>
            <div className="landing-metrics">
              {landingCopy.metrics.map((metric) => (
                <div key={metric.label} className="landing-metric-item">
                  <span>{metric.value}</span>
                  <small>{metric.label}</small>
                </div>
              ))}
            </div>
          </div>

          <ul className="landing-highlight-list">
            {landingCopy.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>

          <div className="landing-feature-grid">
            <h2>{landingCopy.featureTitle}</h2>
            {landingCopy.features.map((feature) => (
              <article key={feature.title} className="landing-feature-card">
                <strong>{feature.title}</strong>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <div key={cardStageKey} className="login-card">
          <div className="login-card-heading">
            <h2>Family Tree</h2>
            <p>{pendingMfa
              ? pendingMfaMethod === 'totp'
                ? t('login.totpPrompt')
                : t('login.mfaPrompt', { email: pendingMfa.masked_email })
              : t('login.prompt')}
            </p>
          </div>
          {pendingMfa ? (
            <form key={`mfa-form-${pendingMfaMethod}`} onSubmit={handleVerifyMfa}>
              <div className="form-group">
                <label htmlFor="login-mfa-code">{pendingMfaMethod === 'totp' ? t('login.totpCode') : t('login.mfaCode')}</label>
                <input
                  id="login-mfa-code"
                  name="mfa_code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D+/g, '').slice(0, 6))}
                  autoComplete="one-time-code"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  autoFocus
                  required
                />
              </div>
              {notice && <div className="notice-info">{notice}</div>}
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? t('login.mfaVerifying') : t('login.verifyMfa')}
              </button>
              <div className="login-secondary-actions">
                {pendingMfa.methods.includes('email') && pendingMfaMethod !== 'email' && onUseEmailMfa && (
                  <button
                    type="button"
                    className="user-admin-btn secondary"
                    onClick={() => { void onUseEmailMfa(); }}
                    disabled={submitting}
                  >
                    {t('login.useEmailFallback')}
                  </button>
                )}
                {pendingMfa.methods.includes('totp') && pendingMfaMethod !== 'totp' && onUseTotpMfa && (
                  <button
                    type="button"
                    className="user-admin-btn secondary"
                    onClick={onUseTotpMfa}
                    disabled={submitting}
                  >
                    {t('login.useAuthenticatorApp')}
                  </button>
                )}
                {pendingMfa.methods.includes('passkey') && onUsePasskeyMfa && (
                  <button
                    type="button"
                    className="user-admin-btn secondary"
                    onClick={() => { void onUsePasskeyMfa(); }}
                    disabled={submitting}
                  >
                    {t('login.usePasskey')}
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form key="login-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="login-email">{t('login.email')}</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="login-password">{t('login.password')}</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {notice && <div className="notice-info">{notice}</div>}
              {error && <div className="login-error">{error}</div>}
              {error?.toLowerCase().includes('email not verified') && (
                <button
                  type="button"
                  className="user-admin-btn secondary"
                  disabled={!canResend || resendBusy}
                  onClick={handleResend}
                >
                  {resendBusy ? t('login.resendingVerification') : t('login.resendVerification')}
                </button>
              )}
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? t('login.signingIn') : t('login.signIn')}
              </button>
              {onLoginWithPasskey && (
                <button type="button" className="auth-secondary-btn" onClick={() => { void onLoginWithPasskey(); }} disabled={submitting}>
                  {t('login.signInWithPasskey')}
                </button>
              )}
              {onForgotPassword && (
                <button type="button" className="auth-secondary-btn" onClick={onForgotPassword} disabled={submitting}>
                  {t('login.forgotPassword')}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
