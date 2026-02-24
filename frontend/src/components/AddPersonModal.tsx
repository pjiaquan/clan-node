import React, { useState } from 'react';
import { getGanzhiYear, getModernTimeRange, getZodiacAnimal, normalizeTraditionalHour, TRADITIONAL_HOURS } from '../utils/chineseTime';

interface AddPersonModalProps {
  onClose: () => void;
  onSubmit: (name: string, english_name: string | undefined, gender: 'M' | 'F' | 'O', dob?: string, dod?: string, tob?: string, tod?: string) => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({ onClose, onSubmit }) => {
  const [dob, setDob] = useState('');
  const [dobUnknown, setDobUnknown] = useState(false);
  const [tob, setTob] = useState('');
  const [tod, setTod] = useState('');

  const tobRange = tob ? getModernTimeRange(tob) : '';
  const todRange = tod ? getModernTimeRange(tod) : '';
  const birthYear = dob ? new Date(dob).getFullYear() : null;
  const zodiac = birthYear ? getZodiacAnimal(birthYear) : '';
  const ganzhi = birthYear ? getGanzhiYear(birthYear) : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>新增成員</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          onSubmit(
            formData.get('name') as string,
            (formData.get('english_name') as string) || undefined,
            formData.get('gender') as 'M' | 'F' | 'O',
            dobUnknown ? undefined : dob || undefined,
            formData.get('dod') as string || undefined,
            normalizeTraditionalHour(formData.get('tob') as string || ''),
            normalizeTraditionalHour(formData.get('tod') as string || '')
          );
        }}>
          <div className="form-group">
            <label>姓名</label>
            <input name="name" required autoFocus />
          </div>
          <div className="form-group">
            <label>英文名</label>
            <input name="english_name" />
          </div>
          <div className="form-group">
            <label>性別</label>
            <select name="gender" defaultValue="O">
              <option value="M">男</option>
              <option value="F">女</option>
              <option value="O">其他</option>
            </select>
          </div>
          <div className="form-group">
            <label>
              出生日期 {zodiac && ganzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({ganzhi}年・{zodiac})</span>}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="date"
                name="dob"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                disabled={dobUnknown}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={dobUnknown}
                  onChange={(e) => {
                    const nextUnknown = e.target.checked;
                    setDobUnknown(nextUnknown);
                    if (nextUnknown) {
                      setDob('');
                    }
                  }}
                />
                未知
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>
              出生時辰 {tobRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({tobRange})</span>}
            </label>
            <select name="tob" value={tob} onChange={(e) => setTob(e.target.value)}>
              <option value="">--</option>
              {TRADITIONAL_HOURS.map((hour) => (
                <option key={hour.name} value={hour.name}>
                  {hour.name} ({hour.range})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>歿日</label>
            <input type="date" name="dod" />
          </div>
          <div className="form-group">
            <label>
              歿時辰 {todRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({todRange})</span>}
            </label>
            <select name="tod" value={tod} onChange={(e) => setTod(e.target.value)}>
              <option value="">--</option>
              {TRADITIONAL_HOURS.map((hour) => (
                <option key={hour.name} value={hour.name}>
                  {hour.name} ({hour.range})
                </option>
              ))}
            </select>
          </div>
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-primary">
              新增
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
