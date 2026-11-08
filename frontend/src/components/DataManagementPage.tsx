import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthUser, NodeBackupPayload } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';
import {
  MIN_BACKUP_PASSPHRASE_LENGTH,
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupPayload,
} from '../utils/backupCrypto';

type DataManagementPageProps = {
  currentUser: AuthUser;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenAccount: () => void;
  onOpenSettings?: () => void;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageAuditLogs?: () => void;
  onManageRelationshipNames?: () => void;
  themeMode?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onLogout: () => Promise<void> | void;
};

export const DataManagementPage: React.FC<DataManagementPageProps> = ({
  currentUser,
  onBack,
  onManageSessions,
  onOpenAccount,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onManageRelationshipNames,
  themeMode,
  onToggleTheme,
  onLogout,
}) => {
  const { t } = useI18n();
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);

  const isAdmin = currentUser.role === 'admin';

  // The passphrase used to be collected with window.prompt, which shows it in
  // clear text on screen and cannot validate before closing. This asks for it
  // in masked fields instead.
  const [passphrasePrompt, setPassphrasePrompt] = useState<{
    confirm: boolean;
    resolve: (value: string | null) => void;
  } | null>(null);
  const [passphraseValue, setPassphraseValue] = useState('');
  const [passphraseConfirmValue, setPassphraseConfirmValue] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  const closePassphrasePrompt = useCallback((value: string | null) => {
    passphrasePrompt?.resolve(value);
    setPassphrasePrompt(null);
    setPassphraseValue('');
    setPassphraseConfirmValue('');
    setPassphraseError(null);
  }, [passphrasePrompt]);

  useEffect(() => {
    if (!passphrasePrompt) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePassphrasePrompt(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [passphrasePrompt, closePassphrasePrompt]);

  const requestPassphrase = (confirm: boolean) => new Promise<string | null>((resolve) => {
    setPassphraseValue('');
    setPassphraseConfirmValue('');
    setPassphraseError(null);
    setPassphrasePrompt({ confirm, resolve });
  });

  const submitPassphrase = (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrasePrompt) return;
    if (!passphraseValue.trim()) {
      setPassphraseError(t('settings.backupPassphraseRequired'));
      return;
    }
    if (passphrasePrompt.confirm) {
      if (passphraseValue.trim().length < MIN_BACKUP_PASSPHRASE_LENGTH) {
        setPassphraseError(t('settings.backupPassphraseTooShort', { min: MIN_BACKUP_PASSPHRASE_LENGTH }));
        return;
      }
      if (passphraseValue !== passphraseConfirmValue) {
        setPassphraseError(t('settings.backupPassphraseMismatch'));
        return;
      }
    }
    closePassphrasePrompt(passphraseValue);
  };

  const handleExportBackup = async () => {
    setBackupError(null);
    setBackupMessage(null);
    setIsExportingBackup(true);
    try {
      const passphrase = await requestPassphrase(true);
      if (passphrase === null) {
        setIsExportingBackup(false);
        return;
      }
      const payload = await api.exportNodeBackup();
      const encryptedPayload = await encryptBackupPayload(payload, passphrase);
      const json = JSON.stringify(encryptedPayload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `clan-node-backup-${stamp}.encrypted.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage(t('settings.backupDownloadedEncrypted'));
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : t('settings.exportFailed'));
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleImportBackup = async () => {
    if (!backupFile) return;
    const confirmationText = window.prompt(t('settings.importConfirm'));
    if (confirmationText === null) return;
    if (confirmationText.trim() !== 'DELETE') {
      setBackupError(t('settings.importConfirmMismatch'));
      return;
    }

    setBackupError(null);
    setBackupMessage(null);
    setIsImportingBackup(true);
    try {
      const text = await backupFile.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      let payload: Record<string, unknown> | NodeBackupPayload = parsed;
      if (isEncryptedBackupPayload(parsed)) {
        const passphrase = await requestPassphrase(false);
        if (passphrase === null) {
          throw new Error(t('settings.importCancelled'));
        }
        payload = await decryptBackupPayload(parsed, passphrase);
      }
      const result = await api.importNodeBackup(payload);
      setBackupMessage(
        t('settings.importDone', {
          people: result.counts.people || 0,
          relationships: result.counts.relationships || 0,
        })
      );
      setBackupFile(null);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : t('settings.importFailed'));
    } finally {
      setIsImportingBackup(false);
    }
  };

  return (
    <div className="graph-settings-page">
      <header className="graph-settings-header">
        <div className="graph-settings-header-left">
          <h1>
            <button type="button" className="header-title-button" onClick={onBack}>
              {t('dataMgmt.title')}
            </button>
          </h1>
        </div>
        <div className="graph-settings-header-right">
          <span className="graph-settings-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="dataManagement"
            isAdmin={isAdmin}
            onBack={onBack}
            onManageSessions={onManageSessions}
            onOpenAccount={onOpenAccount}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageNotifications={onManageNotifications}
            onManageAuditLogs={onManageAuditLogs}
            onManageRelationshipNames={onManageRelationshipNames}
            themeMode={themeMode}
            onToggleTheme={onToggleTheme}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="graph-settings-main">
        {isAdmin && (
          <section className="graph-settings-panel graph-backup-panel">
            <h2>{t('settings.backupTitle')}</h2>
            <p className="graph-backup-hint">{t('settings.backupHint')}</p>
            <div className="graph-backup-actions">
              <button
                type="button"
                className="graph-settings-btn secondary"
                onClick={handleExportBackup}
                disabled={isExportingBackup || isImportingBackup}
              >
                {isExportingBackup ? t('settings.exporting') : t('settings.export')}
              </button>
              <input
                className="graph-backup-file-input"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setBackupFile(nextFile);
                  setBackupError(null);
                  setBackupMessage(null);
                }}
                disabled={isExportingBackup || isImportingBackup}
              />
              <button
                type="button"
                className="graph-settings-btn primary"
                onClick={handleImportBackup}
                disabled={!backupFile || isExportingBackup || isImportingBackup}
              >
                {isImportingBackup ? t('settings.importing') : t('settings.import')}
              </button>
            </div>
            {backupFile && <small className="graph-backup-file-name">{t('settings.selectedFile', { filename: backupFile.name })}</small>}
            {backupError && <div className="graph-backup-error">{backupError}</div>}
            {backupMessage && <div className="graph-backup-success">{backupMessage}</div>}
          </section>
        )}
      </main>

      {passphrasePrompt && (
        <div className="modal-overlay" onClick={() => closePassphrasePrompt(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>{t('settings.backupPassphraseLabel')}</h2>
            <form onSubmit={submitPassphrase}>
              <p className="name-lock-hint">
                {passphrasePrompt.confirm
                  ? t('settings.backupPassphrasePrompt')
                  : t('settings.backupPassphraseImportPrompt')}
              </p>
              <div className="form-group">
                <label htmlFor="backup-passphrase">{t('settings.backupPassphraseLabel')}</label>
                <input
                  id="backup-passphrase"
                  type="password"
                  value={passphraseValue}
                  onChange={(event) => setPassphraseValue(event.target.value)}
                  autoComplete={passphrasePrompt.confirm ? 'new-password' : 'current-password'}
                  autoFocus
                  required
                />
              </div>
              {passphrasePrompt.confirm && (
                <div className="form-group">
                  <label htmlFor="backup-passphrase-confirm">
                    {t('settings.backupPassphraseConfirmLabel')}
                  </label>
                  <input
                    id="backup-passphrase-confirm"
                    type="password"
                    value={passphraseConfirmValue}
                    onChange={(event) => setPassphraseConfirmValue(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              )}
              <div className="form-actions">
                <button type="button" onClick={() => closePassphrasePrompt(null)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-primary">
                  {t('settings.backupPassphraseSubmit')}
                </button>
              </div>
              {passphraseError && <div className="login-error">{passphraseError}</div>}
              </form>
          </div>
        </div>
      )}
    </div>
  );
};
