import React, { useEffect, useRef, useState } from 'react';
import { getGanzhiYear, getModernTimeRange, getZodiacAnimal, normalizeTraditionalHour, TRADITIONAL_HOURS } from '../utils/chineseTime';
import { clampDay, composePartialDate } from '../utils/partialDate';
import { useI18n } from '../i18n';

interface AddPersonModalProps {
  showBirthTimeField?: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
    english_name: string | undefined,
    gender: 'M' | 'F' | 'O',
    dob?: string,
    dod?: string,
    tob?: string,
    tod?: string,
    blood_type?: string
  ) => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({
  showBirthTimeField = true,
  onClose,
  onSubmit,
}) => {
  const { t } = useI18n();
  const [dobYear, setDobYear] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobUnknown, setDobUnknown] = useState(false);
  const [dodYear, setDodYear] = useState('');
  const [dodMonth, setDodMonth] = useState('');
  const [dodDay, setDodDay] = useState('');
  const [dodUnknown, setDodUnknown] = useState(false);
  const [showDeathFields, setShowDeathFields] = useState(false);
  const birthLabelClickCountRef = useRef(0);
  const [tob, setTob] = useState('');
  const [tod, setTod] = useState('');
  const [bloodType, setBloodType] = useState('');

  const dob = composePartialDate({ year: dobYear, month: dobMonth, day: dobDay });
  const dod = composePartialDate({ year: dodYear, month: dodMonth, day: dodDay });
  const tobRange = tob ? getModernTimeRange(tob) : '';
  const todRange = tod ? getModernTimeRange(tod) : '';
  const birthYearParsed = Number.parseInt(dobYear, 10);
  const birthYear = Number.isFinite(birthYearParsed) && birthYearParsed >= 1 && birthYearParsed <= 9999
    ? birthYearParsed
    : null;
  const zodiac = birthYear ? getZodiacAnimal(birthYear) : '';
  const ganzhi = birthYear ? getGanzhiYear(birthYear) : '';
  const monthNum = Number.parseInt(dobMonth, 10);
  const deathYearParsed = Number.parseInt(dodYear, 10);
  const deathYear = Number.isFinite(deathYearParsed) && deathYearParsed >= 1 && deathYearParsed <= 9999
    ? deathYearParsed
    : null;
  const deathZodiac = deathYear ? getZodiacAnimal(deathYear) : '';
  const deathGanzhi = deathYear ? getGanzhiYear(deathYear) : '';
  const deathMonthNum = Number.parseInt(dodMonth, 10);
  const maxDobDay = birthYear && Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12
    ? new Date(birthYear, monthNum, 0).getDate()
    : 31;
  const maxDodDay = deathYear && Number.isFinite(deathMonthNum) && deathMonthNum >= 1 && deathMonthNum <= 12
    ? new Date(deathYear, deathMonthNum, 0).getDate()
    : 31;

  useEffect(() => {
    if (!dobDay) return;
    const nextDay = clampDay(dobYear, dobMonth, dobDay);
    if (nextDay !== dobDay) {
      setDobDay(nextDay);
    }
  }, [dobDay, dobMonth, dobYear]);

  useEffect(() => {
    if (!dodDay) return;
    const nextDay = clampDay(dodYear, dodMonth, dodDay);
    if (nextDay !== dodDay) {
      setDodDay(nextDay);
    }
  }, [dodDay, dodMonth, dodYear]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('addPerson.title')}</h2>
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          onSubmit(
            formData.get('name') as string,
            (formData.get('english_name') as string) || undefined,
            formData.get('gender') as 'M' | 'F' | 'O',
            dobUnknown ? undefined : dob || undefined,
            dodUnknown ? undefined : dod || undefined,
            normalizeTraditionalHour(formData.get('tob') as string || ''),
            (dodUnknown || !dod) ? undefined : normalizeTraditionalHour(tod || ''),
            (formData.get('blood_type') as string) || undefined
          );
        }}>
          <div className="form-group">
            <label>{t('personForm.name')}</label>
            <input name="name" required autoFocus />
          </div>
          <div className="form-group">
            <label>{t('personForm.englishName')}</label>
            <input name="english_name" />
          </div>
          <div className="form-group">
            <label>{t('personForm.gender')}</label>
            <select name="gender" defaultValue="O">
              <option value="M">{t('personForm.genderMale')}</option>
              <option value="F">{t('personForm.genderFemale')}</option>
              <option value="O">{t('personForm.genderOther')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('personForm.bloodType')}</label>
            <select
              name="blood_type"
              value={bloodType}
              onChange={(event) => setBloodType(event.target.value)}
            >
              <option value="">{t('common.unknown')}</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="O">O</option>
              <option value="AB">AB</option>
            </select>
          </div>
          <div className="form-group">
            <label
              onClick={() => {
                birthLabelClickCountRef.current += 1;
                if (birthLabelClickCountRef.current > 5) {
                  setShowDeathFields(true);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              {t('personForm.birthDate')} {zodiac && ganzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({t('personForm.zodiacInfo', { ganzhi, zodiac })})</span>}
            </label>
            <div className="date-input-row">
              <div className="date-input-main">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={t('personForm.yearPlaceholder')}
                  value={dobYear}
                  onChange={(e) => {
                    const nextYear = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setDobYear(nextYear);
                    if (!nextYear) {
                      setDobMonth('');
                      setDobDay('');
                    }
                  }}
                  disabled={dobUnknown}
                  className="date-year-input"
                />
                <select
                  value={dobMonth}
                  onChange={(e) => {
                    const nextMonth = e.target.value;
                    setDobMonth(nextMonth);
                    if (!nextMonth) {
                      setDobDay('');
                    }
                  }}
                  disabled={dobUnknown || !dobYear}
                  className="date-month-select"
                >
                  <option value="">{t('personForm.monthOptional')}</option>
                  {Array.from({ length: 12 }, (_, idx) => {
                    const value = String(idx + 1);
                    return (
                      <option key={value} value={value}>
                        {t('personForm.monthValue', { value })}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={dobDay}
                  onChange={(e) => setDobDay(e.target.value)}
                  disabled={dobUnknown || !dobYear || !dobMonth}
                  className="date-day-select"
                >
                  <option value="">{t('personForm.dayOptional')}</option>
                  {Array.from({ length: maxDobDay }, (_, idx) => {
                    const value = String(idx + 1);
                    return (
                      <option key={value} value={value}>
                        {t('personForm.dayValue', { value })}
                      </option>
                    );
                  })}
                </select>
              </div>
              <label className="date-unknown-toggle">
                <input
                  type="checkbox"
                  checked={dobUnknown}
                  onChange={(e) => {
                    const nextUnknown = e.target.checked;
                    setDobUnknown(nextUnknown);
                    if (nextUnknown) {
                      setDobYear('');
                      setDobMonth('');
                      setDobDay('');
                    }
                  }}
                />
                {t('common.unknown')}
              </label>
            </div>
            {!showDeathFields && (
              <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#64748b' }}>
                {t('personForm.revealDeathHint')}
              </div>
            )}
          </div>
          {showBirthTimeField && (
            <div className="form-group">
              <label>
                {t('personForm.birthHour')} {tobRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({tobRange})</span>}
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
          )}
          {showDeathFields && (
            <>
              <div className="form-group">
                <label>
                  {t('personForm.deathDate')} {deathZodiac && deathGanzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({t('personForm.zodiacInfo', { ganzhi: deathGanzhi, zodiac: deathZodiac })})</span>}
                </label>
                <div className="date-input-row">
                  <div className="date-input-main">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder={t('personForm.yearPlaceholder')}
                      value={dodYear}
                      onChange={(e) => {
                        const nextYear = e.target.value.replace(/\D/g, '').slice(0, 4);
                        setDodYear(nextYear);
                        if (!nextYear) {
                          setDodMonth('');
                          setDodDay('');
                          setTod('');
                        }
                      }}
                      disabled={dodUnknown}
                      className="date-year-input"
                    />
                    <select
                      value={dodMonth}
                      onChange={(e) => {
                        const nextMonth = e.target.value;
                        setDodMonth(nextMonth);
                        if (!nextMonth) {
                          setDodDay('');
                        }
                      }}
                      disabled={dodUnknown || !dodYear}
                      className="date-month-select"
                    >
                      <option value="">{t('personForm.monthOptional')}</option>
                      {Array.from({ length: 12 }, (_, idx) => {
                        const value = String(idx + 1);
                        return (
                          <option key={value} value={value}>
                            {t('personForm.monthValue', { value })}
                          </option>
                        );
                      })}
                    </select>
                    <select
                      value={dodDay}
                      onChange={(e) => setDodDay(e.target.value)}
                      disabled={dodUnknown || !dodYear || !dodMonth}
                      className="date-day-select"
                    >
                      <option value="">{t('personForm.dayOptional')}</option>
                      {Array.from({ length: maxDodDay }, (_, idx) => {
                        const value = String(idx + 1);
                        return (
                          <option key={value} value={value}>
                            {t('personForm.dayValue', { value })}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <label className="date-unknown-toggle">
                    <input
                      type="checkbox"
                      checked={dodUnknown}
                      onChange={(e) => {
                        const nextUnknown = e.target.checked;
                        setDodUnknown(nextUnknown);
                        if (nextUnknown) {
                          setDodYear('');
                          setDodMonth('');
                          setDodDay('');
                          setTod('');
                          setShowDeathFields(false);
                          birthLabelClickCountRef.current = 0;
                        }
                      }}
                    />
                    {t('common.unknown')}
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label>
                  {t('personForm.deathHour')} {todRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({todRange})</span>}
                </label>
                <select
                  name="tod"
                  value={tod}
                  onChange={(e) => setTod(e.target.value)}
                  disabled={dodUnknown || !dodYear}
                >
                  <option value="">-</option>
                  {TRADITIONAL_HOURS.map((hour) => (
                    <option key={hour.name} value={hour.name}>
                      {hour.name} ({hour.range})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="form-actions">
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary">
              {t('addPerson.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
