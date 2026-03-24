import React, { useState } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';
import {
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

  const promptForExportPassphrase = () => {
    const first = window.prompt(t('settings.backupPassphrasePrompt'));
    if (first === null) return null;
    if (!first.trim()) {
      throw new Error(t('settings.backupPassphraseRequired'));
    }
    const second = window.prompt(t('settings.backupPassphraseConfirmPrompt'));
    if (second === null) return null;
    if (first !== second) {
      throw new Error(t('settings.backupPassphraseMismatch'));
    }
    return first;
  };

  const promptForImportPassphrase = () => {
    const passphrase = window.prompt(t('settings.backupPassphraseImportPrompt'));
    if (passphrase === null) return null;
    if (!passphrase.trim()) {
      throw new Error(t('settings.backupPassphraseRequired'));
    }
    return passphrase;
  };

  const handleExportBackup = async () => {
    setBackupError(null);
    setBackupMessage(null);
    setIsExportingBackup(true);
    try {
      const passphrase = promptForExportPassphrase();
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
    const confirmed = window.confirm(
      t('settings.importConfirm')
    );
    if (!confirmed) return;

    setBackupError(null);
    setBackupMessage(null);
    setIsImportingBackup(true);
    try {
      const text = await backupFile.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const payload = isEncryptedBackupPayload(parsed)
        ? await decryptBackupPayload(parsed, (() => {
          const passphrase = promptForImportPassphrase();
          if (passphrase === null) {
            throw new Error(t('settings.importCancelled'));
          }
          return passphrase;
        })())
        : parsed;
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
    </div>
  );
};
