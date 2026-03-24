import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupPayload,
} from '../utils/backupCrypto';
import {
  DEFAULT_GRAPH_SETTINGS,
  normalizeGraphSettings,
  type EdgeLineStyle,
  type GraphSettings,
} from '../graphSettings';

type GraphSettingsPageProps = {
  currentUser: AuthUser;
  settings: GraphSettings;
  onSave: (settings: GraphSettings, options?: { navigate?: boolean }) => void;
  onBack: () => void;
  onManageSessions: () => void;
  onOpenAccount: () => void;
  onOpenSettings?: () => void;
  onManageUsers?: () => void;
  onManageNotifications?: () => void;
  onManageAuditLogs?: () => void;
  onManageRelationshipNames?: () => void;
  onLogout: () => Promise<void> | void;
};

type NumericGraphSettingsKey = {
  [Key in keyof GraphSettings]: GraphSettings[Key] extends number ? Key : never;
}[keyof GraphSettings];

type StringGraphSettingsKey = {
  [Key in keyof GraphSettings]: GraphSettings[Key] extends string ? Key : never;
}[keyof GraphSettings];

type FieldSpec = {
  key: NumericGraphSettingsKey;
  min: number;
  max: number;
  step: number;
};

const EDGE_LINE_STYLE_OPTIONS: EdgeLineStyle[] = ['orthogonal', 'spline'];

const SPACING_FIELDS: FieldSpec[] = [
  {
    key: 'repelGap',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseGap',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'expandShiftStepX',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'expandShiftStepY',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'initialOrbitBaseRadius',
    min: 40,
    max: 1600,
    step: 10,
  },
  {
    key: 'initialOrbitStepRadius',
    min: 0,
    max: 500,
    step: 2,
  },
];

const SNAP_FIELDS: FieldSpec[] = [
  {
    key: 'ySnapThreshold',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'yReleaseThreshold',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'xSnapThreshold',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'xReleaseThreshold',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'spouseSnapThreshold',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseReleaseThreshold',
    min: 0,
    max: 260,
    step: 1,
  },
];

const AUTO_LINK_FIELDS: FieldSpec[] = [
  {
    key: 'minDragDistanceForAutoLink',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearGapXThreshold',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearCenterYThreshold',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'autoSpouseMinOverlapRatio',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
  {
    key: 'autoSpouseMinVerticalOverlapRatio',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
];

const LINE_NUMERIC_FIELDS: FieldSpec[] = [
  {
    key: 'edgeOpacity',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'edgeStrokeWidth',
    min: 1,
    max: 16,
    step: 0.5,
  },
  {
    key: 'selectedEdgeStrokeWidth',
    min: 1,
    max: 24,
    step: 0.5,
  },
];

const LINE_COLOR_FIELDS: StringGraphSettingsKey[] = [
  'selectedEdgeColor',
  'edgeParentChildColor',
  'edgeSpouseColor',
  'edgeExSpouseColor',
  'edgeSiblingColor',
  'edgeInLawColor',
];

const renderField = (
  field: FieldSpec,
  t: (key: string, vars?: Record<string, string | number>) => string,
  draft: GraphSettings,
  onNumberChange: (key: NumericGraphSettingsKey, value: string) => void
) => (
  <label className="graph-settings-field" key={field.key}>
    <span className="graph-settings-field-label">{t(`settings.field.${field.key}.label`)}</span>
    <input
      className="graph-settings-input"
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={draft[field.key]}
      onChange={(event) => onNumberChange(field.key, event.target.value)}
    />
    <small>{t(`settings.field.${field.key}.hint`)}</small>
  </label>
);

export const GraphSettingsPage: React.FC<GraphSettingsPageProps> = ({
  currentUser,
  settings,
  onSave,
  onBack,
  onManageSessions,
  onOpenAccount,
  onOpenSettings,
  onManageUsers,
  onManageNotifications,
  onManageAuditLogs,
  onManageRelationshipNames,
  onLogout,
}) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<GraphSettings>(() => normalizeGraphSettings(settings));
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isImportingBackup, setIsImportingBackup] = useState(false);

  const isAdmin = currentUser.role === 'admin';

  useEffect(() => {
    setDraft(normalizeGraphSettings(settings));
  }, [settings]);

  const onNumberChange = (key: NumericGraphSettingsKey, value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setDraft((prev) => ({
      ...prev,
      [key]: next,
    }));
  };

  const onStringChange = (key: StringGraphSettingsKey, value: string) => {
    setDraft((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleSave = () => {
    onSave(normalizeGraphSettings(draft), { navigate: true });
  };

  const handleBack = () => {
    const normalizedDraft = normalizeGraphSettings(draft);
    const normalizedSettings = normalizeGraphSettings(settings);
    if (JSON.stringify(normalizedDraft) !== JSON.stringify(normalizedSettings)) {
      onSave(normalizedDraft, { navigate: true });
      return;
    }
    onBack();
  };

  const handleReset = () => {
    setDraft(DEFAULT_GRAPH_SETTINGS);
  };

  const handleEdgeLineStyleChange = (value: string) => {
    if (value !== 'orthogonal' && value !== 'spline') return;
    setDraft((prev) => ({
      ...prev,
      edgeLineStyle: value,
    }));
  };

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
            <button type="button" className="header-title-button" onClick={handleBack}>
              {t('settings.title')}
            </button>
          </h1>
        </div>
        <div className="graph-settings-header-right">
          <span className="graph-settings-user-chip">{currentUser.username}</span>
          <PageHeaderMenu
            username={currentUser.username}
            currentPage="settings"
            isAdmin={currentUser.role === 'admin'}
            onBack={handleBack}
            onManageSessions={onManageSessions}
            onOpenAccount={onOpenAccount}
            onOpenSettings={onOpenSettings}
            onManageUsers={onManageUsers}
            onManageNotifications={onManageNotifications}
            onManageAuditLogs={onManageAuditLogs}
            onManageRelationshipNames={onManageRelationshipNames}
            onLogout={onLogout}
          />
        </div>
      </header>

      <main className="graph-settings-main">
        <section className="graph-settings-panel">
          <h2>{t('settings.nodeSpacing')}</h2>
          <div className="graph-settings-grid">
            {SPACING_FIELDS.map((field) => renderField(field, t, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>{t('settings.snapParams')}</h2>
          <div className="graph-settings-grid">
            {SNAP_FIELDS.map((field) => renderField(field, t, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>{t('settings.autoLink')}</h2>
          <div className="graph-settings-grid">
            {AUTO_LINK_FIELDS.map((field) => renderField(field, t, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>{t('settings.lineDisplay')}</h2>
          <div className="graph-settings-grid">
            <label className="graph-settings-toggle">
              <input
                type="checkbox"
                checked={draft.showEdgeLabels}
                onChange={(event) => {
                  const nextChecked = event.target.checked;
                  const nextDraft = {
                    ...draft,
                    showEdgeLabels: nextChecked,
                  };
                  setDraft((prev) => ({
                    ...prev,
                    showEdgeLabels: nextChecked,
                  }));
                  onSave(normalizeGraphSettings(nextDraft), { navigate: false });
                }}
              />
              <div>
                <span className="graph-settings-field-label">{t('settings.showEdgeLabels')}</span>
                <small>{t('settings.showEdgeLabelsHint')}</small>
              </div>
            </label>

            <label className="graph-settings-field">
              <span className="graph-settings-field-label">{t('settings.field.edgeLineStyle.label')}</span>
              <select
                className="graph-settings-input"
                value={draft.edgeLineStyle}
                onChange={(event) => handleEdgeLineStyleChange(event.target.value)}
              >
                {EDGE_LINE_STYLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {t(`settings.field.edgeLineStyle.option.${option}`)}
                  </option>
                ))}
              </select>
              <small>{t('settings.field.edgeLineStyle.hint')}</small>
            </label>

            {LINE_NUMERIC_FIELDS.map((field) => renderField(field, t, draft, onNumberChange))}

            <label className="graph-settings-field">
              <span className="graph-settings-field-label">{t('settings.field.edgeDashPattern.label')}</span>
              <input
                className="graph-settings-input"
                type="text"
                value={draft.edgeDashPattern}
                onChange={(event) => onStringChange('edgeDashPattern', event.target.value)}
                placeholder="6 4"
              />
              <small>{t('settings.field.edgeDashPattern.hint')}</small>
            </label>

            {LINE_COLOR_FIELDS.map((fieldKey) => (
              <label className="graph-settings-field" key={fieldKey}>
                <span className="graph-settings-field-label">{t(`settings.field.${fieldKey}.label`)}</span>
                <input
                  className="graph-settings-input graph-settings-input-color"
                  type="color"
                  value={draft[fieldKey]}
                  onChange={(event) => onStringChange(fieldKey, event.target.value)}
                />
                <small>{t(`settings.field.${fieldKey}.hint`)}</small>
              </label>
            ))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>{t('settings.nodeDisplay')}</h2>
          <label className="graph-settings-toggle">
            <input
              type="checkbox"
              checked={draft.showBirthTimeOnNode}
              onChange={(event) => {
                const nextChecked = event.target.checked;
                const nextDraft = {
                  ...draft,
                  showBirthTimeOnNode: nextChecked,
                };
                setDraft((prev) => ({
                  ...prev,
                  showBirthTimeOnNode: nextChecked,
                }));
                onSave(normalizeGraphSettings(nextDraft), { navigate: false });
              }}
            />
            <div>
              <span className="graph-settings-field-label">{t('settings.showBirthHour')}</span>
              <small>{t('settings.showBirthHourHint')}</small>
            </div>
          </label>
        </section>

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

        <section className="graph-settings-actions">
          <button type="button" className="graph-settings-btn secondary" onClick={handleReset}>
            {t('settings.reset')}
          </button>
          <button type="button" className="graph-settings-btn primary" onClick={handleSave}>
            {t('settings.saveApply')}
          </button>
        </section>
      </main>
    </div>
  );
};
