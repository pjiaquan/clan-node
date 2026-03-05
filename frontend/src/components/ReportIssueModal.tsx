import React, { useMemo, useState } from 'react';
import type { NotificationType } from '../types';
import { useI18n } from '../i18n';

type ReportIssueModalProps = {
  personName: string;
  onClose: () => void;
  onSubmit: (payload: { type: NotificationType; message: string }) => Promise<void>;
};

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ personName, onClose, onSubmit }) => {
  const { t } = useI18n();
  const [type, setType] = useState<NotificationType>('rename');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueTypeOptions: Array<{ value: NotificationType; label: string }> = useMemo(() => ([
    { value: 'rename', label: t('notification.type.rename') },
    { value: 'avatar', label: t('notification.type.avatar') },
    { value: 'relationship', label: t('notification.type.relationship') },
    { value: 'other', label: t('notification.type.other') },
  ]), [t]);

  const hint = useMemo(() => {
    const hints: Record<NotificationType, string> = {
      rename: t('report.hint.rename'),
      avatar: t('report.hint.avatar'),
      relationship: t('report.hint.relationship'),
      other: t('report.hint.other'),
    };
    return hints[type];
  }, [t, type]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError(t('report.emptyDetails'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ type, message: trimmed });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('report.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>{t('report.title')}</h2>
        <p className="report-issue-person">{t('report.targetPerson', { name: personName })}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>{t('report.issueType')}</label>
            <select value={type} onChange={(event) => setType(event.target.value as NotificationType)}>
              {issueTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t('report.details')}</label>
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
            <button type="button" onClick={onClose} disabled={submitting}>{t('common.cancel')}</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? t('report.submitting') : t('report.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
