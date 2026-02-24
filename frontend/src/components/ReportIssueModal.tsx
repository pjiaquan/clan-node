import React, { useMemo, useState } from 'react';
import type { NotificationType } from '../types';

type ReportIssueModalProps = {
  personName: string;
  onClose: () => void;
  onSubmit: (payload: { type: NotificationType; message: string }) => Promise<void>;
};

const ISSUE_TYPE_OPTIONS: Array<{ value: NotificationType; label: string }> = [
  { value: 'rename', label: '修改名稱' },
  { value: 'avatar', label: '修改頭像' },
  { value: 'relationship', label: '修改關係' },
  { value: 'other', label: '其他' },
];

const ISSUE_HINTS: Record<NotificationType, string> = {
  rename: '例如：建議改成正確姓名，並附上理由。',
  avatar: '例如：請更換頭像，並描述原因。',
  relationship: '例如：請調整父子／夫妻／手足關係。',
  other: '請描述你希望管理員處理的內容。',
};

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ personName, onClose, onSubmit }) => {
  const [type, setType] = useState<NotificationType>('rename');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = useMemo(() => ISSUE_HINTS[type], [type]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError('請填寫問題內容');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ type, message: trimmed });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>提出問題</h2>
        <p className="report-issue-person">目標人物：{personName}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>問題類型</label>
            <select value={type} onChange={(event) => setType(event.target.value as NotificationType)}>
              {ISSUE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>內容</label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={hint}
            />
            <div className="report-issue-hint">{message.length}/2000</div>
          </div>

          {error && <div className="report-issue-error">{error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? '送出中...' : '送出'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
