import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthUser } from '../types';
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
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
};

const SPACING_FIELDS: FieldSpec[] = [
  {
    key: 'repelGap',
    label: '防重叠间距',
    hint: '拖拽后自动避让的节点最小间距（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseGap',
    label: '配偶吸附间距',
    hint: '夫妻节点吸附时保留的水平间距（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'expandShiftStepX',
    label: '展开偏移 X',
    hint: '展开折叠分支时，避开重叠的 X 方向步长（px）',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'expandShiftStepY',
    label: '展开偏移 Y',
    hint: '展开折叠分支时，避开重叠的 Y 方向步长（px）',
    min: 20,
    max: 1200,
    step: 5,
  },
  {
    key: 'initialOrbitBaseRadius',
    label: '初始半径',
    hint: '没有历史坐标时，围绕中心的初始半径（px）',
    min: 40,
    max: 1600,
    step: 10,
  },
  {
    key: 'initialOrbitStepRadius',
    label: '半径增量',
    hint: '初始摆放时，每个节点递增的半径（px）',
    min: 0,
    max: 500,
    step: 2,
  },
];

const SNAP_FIELDS: FieldSpec[] = [
  {
    key: 'ySnapThreshold',
    label: 'Y 吸附阈值',
    hint: '拖拽时进入水平对齐吸附的阈值（px）',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'yReleaseThreshold',
    label: 'Y 释放阈值',
    hint: '拖拽离开水平吸附状态需要的阈值（px）',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'xSnapThreshold',
    label: 'X 吸附阈值',
    hint: '拖拽时进入垂直对齐吸附的阈值（px）',
    min: 4,
    max: 200,
    step: 1,
  },
  {
    key: 'xReleaseThreshold',
    label: 'X 释放阈值',
    hint: '拖拽离开垂直吸附状态需要的阈值（px）',
    min: 4,
    max: 220,
    step: 1,
  },
  {
    key: 'spouseSnapThreshold',
    label: '夫妻吸附阈值',
    hint: '拖拽到配偶附近时自动对齐的阈值（px）',
    min: 0,
    max: 240,
    step: 1,
  },
  {
    key: 'spouseReleaseThreshold',
    label: '夫妻释放阈值',
    hint: '离开夫妻吸附状态需要的阈值（px）',
    min: 0,
    max: 260,
    step: 1,
  },
];

const AUTO_LINK_FIELDS: FieldSpec[] = [
  {
    key: 'minDragDistanceForAutoLink',
    label: '最小拖拽距离',
    hint: '超过该距离才触发自动连线判断（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearGapXThreshold',
    label: '近距离 X 阈值',
    hint: '自动连线时横向邻近判定阈值（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'nearCenterYThreshold',
    label: '中心 Y 阈值',
    hint: '自动连线时纵向中心对齐判定阈值（px）',
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: 'autoSpouseMinOverlapRatio',
    label: '最小重叠比例',
    hint: '自动配偶连线的最小重叠面积比例（0~1）',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
  {
    key: 'autoSpouseMinVerticalOverlapRatio',
    label: '最小纵向重叠比例',
    hint: '自动配偶连线的最小纵向重叠比例（0~1）',
    min: 0.05,
    max: 1,
    step: 0.01,
  },
];

const renderField = (
  field: FieldSpec,
  draft: GraphSettings,
  onNumberChange: (key: NumericGraphSettingsKey, value: string) => void
) => (
  <label className="graph-settings-field" key={field.key}>
    <span className="graph-settings-field-label">{field.label}</span>
    <input
      className="graph-settings-input"
      type="number"
      min={field.min}
      max={field.max}
      step={field.step}
      value={draft[field.key]}
      onChange={(event) => onNumberChange(field.key, event.target.value)}
    />
    <small>{field.hint}</small>
  </label>
);

export const GraphSettingsPage: React.FC<GraphSettingsPageProps> = ({
  currentUser,
  settings,
  onSave,
  onBack,
  onLogout,
}) => {
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
      setBackupMessage('備份已下載');
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '匯出備份失敗');
    } finally {
      setIsExportingBackup(false);
    }
  };

  const handleImportBackup = async () => {
    if (!backupFile) return;
    const confirmed = window.confirm('匯入將覆蓋目前所有節點、關係、頭像索引與自訂欄位，確定繼續？');
    if (!confirmed) return;

    setBackupError(null);
    setBackupMessage(null);
    setIsImportingBackup(true);
    try {
      const text = await backupFile.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const result = await api.importNodeBackup(parsed);
      setBackupMessage(`匯入完成：${result.counts.people || 0} 個節點，${result.counts.relationships || 0} 條關係`);
      setBackupFile(null);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '匯入備份失敗');
    } finally {
      setIsImportingBackup(false);
    }
  };

  return (
    <div className="graph-settings-page">
      <header className="graph-settings-header">
        <div className="graph-settings-header-left">
          <button type="button" className="graph-settings-btn ghost" onClick={handleBack}>
            返回族谱
          </button>
          <div>
            <h1>图形设置</h1>
            <p>保存后将自动应用到节点拖拽、吸附和自动连线</p>
          </div>
        </div>
        <div className="graph-settings-header-right">
          <span className="graph-settings-user-chip">{currentUser.username}</span>
          <button type="button" className="graph-settings-btn ghost" onClick={onLogout}>
            登出
          </button>
        </div>
      </header>

      <main className="graph-settings-main">
        <section className="graph-settings-panel">
          <h2>节点间距</h2>
          <div className="graph-settings-grid">
            {SPACING_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>粘性参数</h2>
          <div className="graph-settings-grid">
            {SNAP_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>自动连线</h2>
          <div className="graph-settings-grid">
            {AUTO_LINK_FIELDS.map((field) => renderField(field, draft, onNumberChange))}
          </div>
        </section>

        <section className="graph-settings-panel">
          <h2>節點顯示</h2>
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
              <span className="graph-settings-field-label">顯示出生時辰</span>
              <small>關閉時「新增/編輯節點」不顯示出生時辰欄位，開啟後才會顯示</small>
            </div>
          </label>
        </section>

        {isAdmin && (
          <section className="graph-settings-panel graph-backup-panel">
            <h2>節點資料備份（Admin）</h2>
            <p className="graph-backup-hint">可匯出/匯入節點資料。匯入時會覆蓋目前資料，建議先匯出一份再操作。</p>
            <div className="graph-backup-actions">
              <button
                type="button"
                className="graph-settings-btn secondary"
                onClick={handleExportBackup}
                disabled={isExportingBackup || isImportingBackup}
              >
                {isExportingBackup ? '匯出中...' : '匯出備份 JSON'}
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
                {isImportingBackup ? '匯入中...' : '匯入備份'}
              </button>
            </div>
            {backupFile && <small className="graph-backup-file-name">已選擇：{backupFile.name}</small>}
            {backupError && <div className="graph-backup-error">{backupError}</div>}
            {backupMessage && <div className="graph-backup-success">{backupMessage}</div>}
          </section>
        )}

        <section className="graph-settings-actions">
          <button type="button" className="graph-settings-btn secondary" onClick={handleReset}>
            恢复默认
          </button>
          <button type="button" className="graph-settings-btn primary" onClick={handleSave}>
            保存并应用
          </button>
        </section>
      </main>
    </div>
  );
};
