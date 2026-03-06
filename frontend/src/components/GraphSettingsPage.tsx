import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';
import { PageHeaderMenu } from './PageHeaderMenu';
import { useI18n } from '../i18n';
import {
  DEFAULT_GRAPH_SETTINGS,
  normalizeGraphSettings,
  type GraphSettings,
} from '../graphSettings';

type GraphSettingsPageProps = {
  currentUser: AuthUser;
  settings: GraphSettings;
  onSave: (settings: GraphSettings, options?: { navigate?: boolean }) => void;
  onBack: () => void;
  onLogout: () => Promise<void> | void;
};

type NumericGraphSettingsKey = {
  [Key in keyof GraphSettings]: GraphSettings[Key] extends number ? Key : never;
}[keyof GraphSettings];

type FieldSpec = {
  key: NumericGraphSettingsKey;
  min: number;
  max: number;
  step: number;
};

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

  const handleExportBackup = async () => {
    setBackupError(null);
    setBackupMessage(null);
    setIsExportingBackup(true);
    try {
      const payload = await api.exportNodeBackup();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const link = document.createElement('a');
      link.href = url;
      link.download = `clan-node-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage(t('settings.backupDownloaded'));
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
      const result = await api.importNodeBackup(parsed);
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
            onBack={handleBack}
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
