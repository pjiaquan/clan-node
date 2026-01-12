import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Person } from '../types';
import { getGanzhiYear, getZodiacAnimal, getModernTimeRange, normalizeTraditionalHour, TRADITIONAL_HOURS } from '../utils/chineseTime';
import { api } from '../api';

interface EditPersonModalProps {
  person: Person;
  onClose: () => void;
  onUnsavedClose?: () => void;
  onSubmit: (id: string, updates: Partial<Person>, avatarFile: File | null, removeAvatar: boolean) => void;
}

type CustomField = { label: string; value: string };

const normalizeCustomFields = (fields: any): CustomField[] => {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => ({
    label: typeof field?.label === 'string' ? field.label : '',
    value: typeof field?.value === 'string' ? field.value : '',
  }));
};

export const EditPersonModal: React.FC<EditPersonModalProps> = ({ person, onClose, onUnsavedClose, onSubmit }) => {
  const [name, setName] = useState(person.name);
  const [englishName, setEnglishName] = useState(person.english_name || '');
  const [gender, setGender] = useState(person.gender);
  const [dob, setDob] = useState(person.dob || '');
  const [tob, setTob] = useState(normalizeTraditionalHour(person.tob || ''));
  const [dod, setDod] = useState(person.dod || '');
  const [tod, setTod] = useState(normalizeTraditionalHour(person.tod || ''));
  const [showDod, setShowDod] = useState(!!person.dod);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarImage, setAvatarImage] = useState<HTMLImageElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [customFields, setCustomFields] = useState<CustomField[]>(() => normalizeCustomFields(person.metadata?.customFields));
  const dragStateRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const cropperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skipClickRef = useRef(false);
  const clickCountRef = React.useRef(0);

  useEffect(() => {
    setName(person.name);
    setEnglishName(person.english_name || '');
    setGender(person.gender);
    setDob(person.dob || '');
    setTob(normalizeTraditionalHour(person.tob || ''));
    setDod(person.dod || '');
    setTod(normalizeTraditionalHour(person.tod || ''));
    setShowDod(!!person.dod);
    setAvatarFile(null);
    setAvatarPreview(null);
    setRemoveAvatar(false);
    setAvatarImage(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setCustomFields(normalizeCustomFields(person.metadata?.customFields));
    clickCountRef.current = 0;
  }, [person]);

  useEffect(() => {
    let active = true;
    if (!person.avatar_url) {
      setAvatarPreview(null);
      return;
    }

    api.fetchAvatarBlobUrl(person.avatar_url)
      .then((url) => {
        if (active) {
          setAvatarPreview((prev) => {
            if (prev && prev.startsWith('blob:')) {
              URL.revokeObjectURL(prev);
            }
            return url;
          });
        } else {
          URL.revokeObjectURL(url);
        }
      })
      .catch((error) => {
        console.error('Failed to load avatar preview:', error);
        setAvatarPreview(null);
      });

    return () => {
      active = false;
    };
  }, [person.avatar_url]);

  useEffect(() => {
    if (!avatarFile) return;
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  useEffect(() => {
    if (!avatarPreview) {
      setAvatarImage(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      setAvatarImage(img);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    img.src = avatarPreview;
  }, [avatarPreview]);

  const cropSize = 140;
  const baseZoom = useMemo(() => {
    if (!avatarImage) return 1;
    return Math.max(cropSize / avatarImage.width, cropSize / avatarImage.height);
  }, [avatarImage]);
  const effectiveZoom = baseZoom * zoom;

  const clampOffset = useCallback((next: { x: number; y: number }) => {
    if (!avatarImage) return next;
    const displayW = avatarImage.width * effectiveZoom;
    const displayH = avatarImage.height * effectiveZoom;
    const maxX = Math.max(0, (displayW - cropSize) / 2);
    const maxY = Math.max(0, (displayH - cropSize) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }, [avatarImage, effectiveZoom]);

  useEffect(() => {
    setOffset((prev) => clampOffset(prev));
  }, [effectiveZoom, clampOffset]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const deltaX = event.clientX - dragStateRef.current.x;
      const deltaY = event.clientY - dragStateRef.current.y;
      setOffset(clampOffset({
        x: dragStateRef.current.offsetX + deltaX,
        y: dragStateRef.current.offsetY + deltaY
      }));
    };
    const handlePointerUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [clampOffset]);

  const handleDobLabelClick = () => {
    if (showDod) return;
    clickCountRef.current += 1;
    if (clickCountRef.current >= 5) {
      setShowDod(true);
    }
  };

  const createCroppedAvatar = async () => {
    if (!avatarFile || !avatarImage) return null;
    const canvas = document.createElement('canvas');
    const outputSize = 256;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const displayW = avatarImage.width * effectiveZoom;
    const displayH = avatarImage.height * effectiveZoom;
    const imageLeft = cropSize / 2 + offset.x - displayW / 2;
    const imageTop = cropSize / 2 + offset.y - displayH / 2;
    const sourceX = (0 - imageLeft) / effectiveZoom;
    const sourceY = (0 - imageTop) / effectiveZoom;
    const sourceSize = cropSize / effectiveZoom;
    const maxSourceX = Math.max(0, avatarImage.width - sourceSize);
    const maxSourceY = Math.max(0, avatarImage.height - sourceSize);
    const clampedX = Math.max(0, Math.min(maxSourceX, sourceX));
    const clampedY = Math.max(0, Math.min(maxSourceY, sourceY));

    ctx.drawImage(
      avatarImage,
      clampedX,
      clampedY,
      sourceSize,
      sourceSize,
      0,
      0,
      outputSize,
      outputSize
    );

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return new File([blob], `avatar-${person.id}.png`, { type: 'image/png' });
  };

  const saveChanges = useCallback(async () => {
    const croppedAvatar = await createCroppedAvatar();
    const normalizedEnglish = englishName.trim();
    const nextUpdates: Partial<Person> = {
      name,
      english_name: normalizedEnglish ? normalizedEnglish : null,
      gender,
      dob: dob || undefined,
      tob: tob || undefined,
      dod: dod || undefined,
      tod: tod || undefined
    };

    const normalizedCustomFields = customFields
      .map((field) => ({
        label: field.label.trim(),
        value: field.value.trim(),
      }))
      .filter((field) => field.label || field.value);

    const initialCustomFields = normalizeCustomFields(person.metadata?.customFields)
      .map((field) => ({
        label: field.label.trim(),
        value: field.value.trim(),
      }))
      .filter((field) => field.label || field.value);

    if (JSON.stringify(normalizedCustomFields) !== JSON.stringify(initialCustomFields)) {
      nextUpdates.metadata = {
        ...(person.metadata || {}),
        customFields: normalizedCustomFields,
      };
    }

    onSubmit(person.id, nextUpdates, croppedAvatar, removeAvatar);
  }, [createCroppedAvatar, customFields, dob, dod, englishName, gender, name, onSubmit, person.id, person.metadata, removeAvatar, tob, tod]);

  const initialDob = person.dob || '';
  const initialDod = person.dod || '';
  const initialTob = normalizeTraditionalHour(person.tob || '');
  const initialTod = normalizeTraditionalHour(person.tod || '');
  const initialEnglish = person.english_name || '';
  const normalizedCustomFields = customFields
    .map((field) => ({
      label: field.label.trim(),
      value: field.value.trim(),
    }))
    .filter((field) => field.label || field.value);
  const initialCustomFields = normalizeCustomFields(person.metadata?.customFields)
    .map((field) => ({
      label: field.label.trim(),
      value: field.value.trim(),
    }))
    .filter((field) => field.label || field.value);
  const customFieldsDirty = JSON.stringify(normalizedCustomFields) !== JSON.stringify(initialCustomFields);
  const isDirty = name !== person.name
    || englishName !== initialEnglish
    || gender !== person.gender
    || dob !== initialDob
    || dod !== initialDod
    || tob !== initialTob
    || tod !== initialTod
    || customFieldsDirty
    || Boolean(avatarFile)
    || removeAvatar;

  const handleClose = useCallback(() => {
    if (isDirty) {
      onUnsavedClose?.();
    }
    onClose();
  }, [isDirty, onClose, onUnsavedClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveChanges();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    setAvatarFile(file);
    setRemoveAvatar(false);
  };

  const updateCustomField = (index: number, key: 'label' | 'value', value: string) => {
    setCustomFields((prev) =>
      prev.map((field, idx) => (idx === index ? { ...field, [key]: value } : field))
    );
  };

  const addCustomField = () => {
    setCustomFields((prev) => [...prev, { label: '', value: '' }]);
  };

  const removeCustomField = (index: number) => {
    setCustomFields((prev) => prev.filter((_, idx) => idx !== index));
  };

  const calculateAge = () => {
    if (!dob) return null;
    const birth = new Date(dob);
    const end = dod ? new Date(dod) : new Date();

    let age = end.getFullYear() - birth.getFullYear();
    const m = end.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) {
      age--;
    }

    return age;
  };

  const age = calculateAge();
  const displayAge = age === null
    ? null
    : dod
      ? age + 1 + (gender === 'F' ? 0 : 0)
      : age;
  const birthYear = dob ? new Date(dob).getFullYear() : null;
  const zodiac = birthYear ? getZodiacAnimal(birthYear) : '';
  const ganzhi = birthYear ? getGanzhiYear(birthYear) : '';
  const tobRange = tob ? getModernTimeRange(tob) : '';
  const todRange = tod ? getModernTimeRange(tod) : '';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>編輯成員</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>姓名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>英文名</label>
            <input
              value={englishName}
              onChange={(e) => setEnglishName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>頭像</label>
            <div className="avatar-picker">
              <div
                ref={cropperRef}
                className={`avatar-cropper ${avatarPreview ? 'has-image' : ''} ${isDragging ? 'dragging' : ''}`}
                onPointerDown={(event) => {
                  if (!avatarImage) return;
                  dragStateRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                    offsetX: offset.x,
                    offsetY: offset.y
                  };
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                  skipClickRef.current = true;
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                  skipClickRef.current = true;
                  window.setTimeout(() => {
                    skipClickRef.current = false;
                  }, 250);
                  const file = event.dataTransfer.files?.[0] || null;
                  handleFileSelect(file);
                }}
                style={{
                  width: cropSize,
                  height: cropSize,
                }}
              >
                {avatarPreview && avatarImage ? (
                  <img
                    src={avatarPreview}
                    alt={`${name} avatar`}
                    style={{
                      width: avatarImage.width * effectiveZoom,
                      height: avatarImage.height * effectiveZoom,
                      left: `calc(50% + ${offset.x}px)`,
                      top: `calc(50% + ${offset.y}px)`,
                    }}
                  />
                ) : (
                  <span>拖拉圖片</span>
                )}
              </div>
              <div className="avatar-actions">
                <label className="btn-secondary avatar-upload">
                  選擇圖片
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      handleFileSelect(e.target.files?.[0] || null);
                    }}
                  />
                </label>
                {avatarPreview && (
                  <input
                    className="avatar-zoom"
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                )}
                {avatarPreview && (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      setAvatarFile(null);
                      setAvatarPreview(null);
                      setAvatarImage(null);
                      setRemoveAvatar(true);
                    }}
                  >
                    移除頭像
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>性別</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
            >
              <option value="M">男</option>
              <option value="F">女</option>
              <option value="O">其他</option>
            </select>
          </div>
          <div className="form-group">
            <label onClick={handleDobLabelClick} style={{ cursor: 'pointer', userSelect: 'none' }}>
              出生日期 {zodiac && ganzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({ganzhi}年・{zodiac})</span>}
            </label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>
              出生時辰 {tobRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({tobRange})</span>}
            </label>
            <select value={tob} onChange={(e) => setTob(e.target.value)}>
              <option value="">--</option>
              {TRADITIONAL_HOURS.map((hour) => (
                <option key={hour.name} value={hour.name}>
                  {hour.name} ({hour.range})
                </option>
              ))}
            </select>
          </div>
          {showDod && (
            <>
              <div className="form-group">
                <label>歿日</label>
                <input
                  type="date"
                  value={dod}
                  onChange={(e) => setDod(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>
                  歿時辰 {todRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({todRange})</span>}
                </label>
                <select value={tod} onChange={(e) => setTod(e.target.value)}>
                  <option value="">--</option>
                  {TRADITIONAL_HOURS.map((hour) => (
                    <option key={hour.name} value={hour.name}>
                      {hour.name} ({hour.range})
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="form-group">
            <label>自訂欄位</label>
            <div className="custom-fields">
              {customFields.length === 0 && (
                <div className="custom-fields-empty">新增 Facebook、Line 等欄位</div>
              )}
              {customFields.map((field, index) => (
                <div className="custom-field-row" key={`custom-field-${index}`}>
                  <input
                    value={field.label}
                    placeholder="欄位名稱"
                    onChange={(e) => updateCustomField(index, 'label', e.target.value)}
                  />
                  <input
                    value={field.value}
                    placeholder="內容"
                    onChange={(e) => updateCustomField(index, 'value', e.target.value)}
                  />
                  <button
                    type="button"
                    className="custom-field-remove"
                    onClick={() => removeCustomField(index)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="custom-field-add" onClick={addCustomField}>
              新增欄位
            </button>
          </div>

          {displayAge !== null && (
            <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
              {dod ? `享壽 ${displayAge} 歲` : `目前 ${displayAge} 歲`}
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={handleClose}>
              取消
            </button>
            <button type="submit" className="btn-primary">
              儲存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
