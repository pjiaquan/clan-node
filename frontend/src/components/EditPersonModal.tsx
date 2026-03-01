import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Avatar, Person } from '../types';
import { getGanzhiYear, getZodiacAnimal, getModernTimeRange, normalizeTraditionalHour, TRADITIONAL_HOURS } from '../utils/chineseTime';
import { api } from '../api';
import { clampDay, composePartialDate, parsePartialDate } from '../utils/partialDate';

export type EditPersonAvatarActions = {
  setPrimaryAvatarId?: string | null;
  deleteAvatarIds?: string[];
};

interface EditPersonModalProps {
  person: Person;
  onClose: () => void;
  onUnsavedClose?: () => void;
  onSubmit: (
    id: string,
    updates: Partial<Person>,
    avatarFile: File | null,
    removeAvatar: boolean,
    avatarActions?: EditPersonAvatarActions
  ) => Promise<void> | void;
}

type CustomField = { label: string; value: string };

const normalizeCustomFields = (fields: any): CustomField[] => {
  if (!Array.isArray(fields)) return [];
  return fields.map((field) => ({
    label: typeof field?.label === 'string' ? field.label : '',
    value: typeof field?.value === 'string' ? field.value : '',
  }));
};

const normalizeAvatars = (avatars: any): Avatar[] => {
  if (!Array.isArray(avatars)) return [];
  return avatars
    .filter((avatar) => typeof avatar?.id === 'string' && typeof avatar?.avatar_url === 'string')
    .map((avatar, index) => ({
      id: avatar.id,
      person_id: typeof avatar.person_id === 'string' ? avatar.person_id : '',
      avatar_url: avatar.avatar_url,
      storage_key: typeof avatar.storage_key === 'string' ? avatar.storage_key : null,
      is_primary: avatar.is_primary === true,
      sort_order: Number.isFinite(avatar.sort_order) ? Number(avatar.sort_order) : index,
      created_at: typeof avatar.created_at === 'string' ? avatar.created_at : null,
      updated_at: typeof avatar.updated_at === 'string' ? avatar.updated_at : null,
    }))
    .sort((left, right) => {
      if (left.is_primary !== right.is_primary) return left.is_primary ? -1 : 1;
      if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
      return left.id.localeCompare(right.id);
    });
};

export const EditPersonModal: React.FC<EditPersonModalProps> = ({ person, onClose, onUnsavedClose, onSubmit }) => {
  const [name, setName] = useState(person.name);
  const [englishName, setEnglishName] = useState(person.english_name || '');
  const [gender, setGender] = useState(person.gender);
  const [bloodType, setBloodType] = useState(person.blood_type || '');
  const initialDobParts = parsePartialDate(person.dob);
  const [dobYear, setDobYear] = useState(initialDobParts.year);
  const [dobMonth, setDobMonth] = useState(initialDobParts.month);
  const [dobDay, setDobDay] = useState(initialDobParts.day);
  const [dobUnknown, setDobUnknown] = useState(!person.dob);
  const [tob, setTob] = useState(normalizeTraditionalHour(person.tob || ''));
  const initialDodParts = parsePartialDate(person.dod);
  const [dodYear, setDodYear] = useState(initialDodParts.year);
  const [dodMonth, setDodMonth] = useState(initialDodParts.month);
  const [dodDay, setDodDay] = useState(initialDodParts.day);
  const [dodUnknown, setDodUnknown] = useState(!person.dod);
  const [showDeathFields, setShowDeathFields] = useState(Boolean(person.dod || person.tod));
  const birthLabelClickCountRef = useRef(0);
  const [tod, setTod] = useState(normalizeTraditionalHour(person.tod || ''));
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [avatarImage, setAvatarImage] = useState<HTMLImageElement | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [customFields, setCustomFields] = useState<CustomField[]>(() => normalizeCustomFields(person.metadata?.customFields));
  const [selectedPrimaryAvatarId, setSelectedPrimaryAvatarId] = useState<string | null>(() => {
    const avatars = normalizeAvatars(person.avatars);
    return avatars.find((avatar) => avatar.is_primary)?.id || avatars[0]?.id || null;
  });
  const [deleteAvatarIds, setDeleteAvatarIds] = useState<string[]>([]);
  const dragStateRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const cropperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skipClickRef = useRef(false);

  useEffect(() => {
    const nextAvatars = normalizeAvatars(person.avatars);
    const nextDobParts = parsePartialDate(person.dob);
    setName(person.name);
    setEnglishName(person.english_name || '');
    setGender(person.gender);
    setBloodType(person.blood_type || '');
    setDobYear(nextDobParts.year);
    setDobMonth(nextDobParts.month);
    setDobDay(nextDobParts.day);
    setDobUnknown(!person.dob);
    setTob(normalizeTraditionalHour(person.tob || ''));
    const nextDodParts = parsePartialDate(person.dod);
    setDodYear(nextDodParts.year);
    setDodMonth(nextDodParts.month);
    setDodDay(nextDodParts.day);
    setDodUnknown(!person.dod);
    setShowDeathFields(Boolean(person.dod || person.tod));
    birthLabelClickCountRef.current = 0;
    setTod(normalizeTraditionalHour(person.tod || ''));
    setAvatarFile(null);
    setAvatarPreview(null);
    setRemoveAvatar(false);
    setAvatarImage(null);
    setIsSaving(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setCustomFields(normalizeCustomFields(person.metadata?.customFields));
    setSelectedPrimaryAvatarId(nextAvatars.find((avatar) => avatar.is_primary)?.id || nextAvatars[0]?.id || null);
    setDeleteAvatarIds([]);
  }, [person]);

  const initialAvatars = useMemo(() => normalizeAvatars(person.avatars), [person.avatars]);
  const initialPrimaryAvatarId = useMemo(
    () => initialAvatars.find((avatar) => avatar.is_primary)?.id || initialAvatars[0]?.id || null,
    [initialAvatars]
  );
  const availableAvatars = useMemo(
    () => initialAvatars.filter((avatar) => !deleteAvatarIds.includes(avatar.id)),
    [initialAvatars, deleteAvatarIds]
  );
  const activePrimaryAvatarId = selectedPrimaryAvatarId && availableAvatars.some((avatar) => avatar.id === selectedPrimaryAvatarId)
    ? selectedPrimaryAvatarId
    : (availableAvatars.find((avatar) => avatar.is_primary)?.id || availableAvatars[0]?.id || null);
  const activePrimaryAvatarUrl = useMemo(() => {
    const selected = availableAvatars.find((avatar) => avatar.id === activePrimaryAvatarId);
    return selected?.avatar_url || null;
  }, [availableAvatars, activePrimaryAvatarId]);

  useEffect(() => {
    if (activePrimaryAvatarId !== selectedPrimaryAvatarId) {
      setSelectedPrimaryAvatarId(activePrimaryAvatarId);
    }
  }, [activePrimaryAvatarId, selectedPrimaryAvatarId]);

  useEffect(() => {
    let active = true;
    if (avatarFile) return () => undefined;
    if (!activePrimaryAvatarUrl) {
      setAvatarPreview(null);
      return;
    }

    api.fetchAvatarBlobUrl(activePrimaryAvatarUrl)
      .then((url) => {
        if (!url) {
          if (active) {
            setAvatarPreview(null);
          }
          return;
        }
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
  }, [activePrimaryAvatarUrl, avatarFile]);

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

  const dob = composePartialDate({ year: dobYear, month: dobMonth, day: dobDay });
  const dod = composePartialDate({ year: dodYear, month: dodMonth, day: dodDay });

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

  const stopAvatarDrag = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      dragStateRef.current = null;
    };
  }, []);

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
      blood_type: bloodType ? bloodType : null,
      dob: dobUnknown ? null : (dob ? dob : null),
      tob: tob ? tob : null,
      dod: dodUnknown ? null : (dod ? dod : null),
      tod: (dodUnknown || !dod) ? null : (tod ? tod : null)
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

    const avatarActions: EditPersonAvatarActions = {};
    if (deleteAvatarIds.length > 0) {
      avatarActions.deleteAvatarIds = [...deleteAvatarIds];
    }
    if (selectedPrimaryAvatarId !== initialPrimaryAvatarId) {
      avatarActions.setPrimaryAvatarId = selectedPrimaryAvatarId;
    }
    const hasAvatarActions = Object.keys(avatarActions).length > 0;

    await onSubmit(
      person.id,
      nextUpdates,
      croppedAvatar,
      removeAvatar,
      hasAvatarActions ? avatarActions : undefined
    );
  }, [
    createCroppedAvatar,
    customFields,
    deleteAvatarIds,
    dob,
    dobUnknown,
    dod,
    dodUnknown,
    englishName,
    gender,
    bloodType,
    initialPrimaryAvatarId,
    name,
    onSubmit,
    person.id,
    person.metadata,
    removeAvatar,
    selectedPrimaryAvatarId,
    tob,
    tod
  ]);

  const initialDob = person.dob ? (composePartialDate(parsePartialDate(person.dob)) || person.dob) : '';
  const initialDod = person.dod ? (composePartialDate(parsePartialDate(person.dod)) || person.dod) : '';
  const initialTob = normalizeTraditionalHour(person.tob || '');
  const initialTod = normalizeTraditionalHour(person.tod || '');
  const initialEnglish = person.english_name || '';
  const initialBloodType = person.blood_type || '';
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
  const avatarPrimaryDirty = selectedPrimaryAvatarId !== initialPrimaryAvatarId;
  const avatarDeleteDirty = deleteAvatarIds.length > 0;
  const isDirty = name !== person.name
    || englishName !== initialEnglish
    || gender !== person.gender
    || bloodType !== initialBloodType
    || dob !== initialDob
    || dobUnknown !== !person.dob
    || dod !== initialDod
    || dodUnknown !== !person.dod
    || tob !== initialTob
    || tod !== initialTod
    || customFieldsDirty
    || Boolean(avatarFile)
    || removeAvatar
    || avatarPrimaryDirty
    || avatarDeleteDirty;

  const handleClose = useCallback(() => {
    if (isSaving) return;
    if (isDirty) {
      onUnsavedClose?.();
    }
    onClose();
  }, [isDirty, isSaving, onClose, onUnsavedClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveChanges();
    } catch (error) {
      console.error('Failed to save person changes:', error);
    } finally {
      setIsSaving(false);
    }
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
    setSelectedPrimaryAvatarId(null);
  };

  const markAvatarForDelete = (avatarId: string) => {
    setDeleteAvatarIds((prev) => (
      prev.includes(avatarId) ? prev : [...prev, avatarId]
    ));
    if (selectedPrimaryAvatarId === avatarId) {
      setSelectedPrimaryAvatarId(null);
    }
  };

  const undoDeleteAvatar = (avatarId: string) => {
    setDeleteAvatarIds((prev) => prev.filter((id) => id !== avatarId));
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

  const birthYearParsed = Number.parseInt(dobYear, 10);
  const birthYear = Number.isFinite(birthYearParsed) && birthYearParsed >= 1 && birthYearParsed <= 9999
    ? birthYearParsed
    : null;
  const deathYearParsed = Number.parseInt(dodYear, 10);
  const deathYear = Number.isFinite(deathYearParsed) && deathYearParsed >= 1 && deathYearParsed <= 9999
    ? deathYearParsed
    : null;
  const zodiac = birthYear ? getZodiacAnimal(birthYear) : '';
  const ganzhi = birthYear ? getGanzhiYear(birthYear) : '';
  const deathZodiac = deathYear ? getZodiacAnimal(deathYear) : '';
  const deathGanzhi = deathYear ? getGanzhiYear(deathYear) : '';
  const tobRange = tob ? getModernTimeRange(tob) : '';
  const todRange = tod ? getModernTimeRange(tod) : '';
  const monthNum = Number.parseInt(dobMonth, 10);
  const deathMonthNum = Number.parseInt(dodMonth, 10);
  const deathDayNum = Number.parseInt(dodDay, 10);
  const maxDobDay = birthYear && Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12
    ? new Date(birthYear, monthNum, 0).getDate()
    : 31;
  const maxDodDay = deathYear && Number.isFinite(deathMonthNum) && deathMonthNum >= 1 && deathMonthNum <= 12
    ? new Date(deathYear, deathMonthNum, 0).getDate()
    : 31;
  const adjustDobYear = (delta: number) => {
    const yearNum = Number.parseInt(dobYear, 10);
    if (!Number.isFinite(yearNum)) return;
    const nextYear = Math.max(1, Math.min(9999, yearNum + delta));
    const nextYearText = String(nextYear);
    setDobYear(nextYearText);
    setDobDay((prev) => clampDay(nextYearText, dobMonth, prev));
  };
  const calculateWesternAge = () => {
    if (!birthYear) return null;
    const hasDod = Boolean(deathYear);
    const now = new Date();
    let age = (deathYear ?? now.getFullYear()) - birthYear;
    const birthMonthNum = Number.parseInt(dobMonth, 10);
    const birthDayNum = Number.parseInt(dobDay, 10);
    if (Number.isFinite(birthMonthNum) && birthMonthNum >= 1 && birthMonthNum <= 12) {
      const endMonth = hasDod
        ? (Number.isFinite(deathMonthNum) && deathMonthNum >= 1 && deathMonthNum <= 12 ? deathMonthNum : null)
        : (now.getMonth() + 1);
      const endDay = hasDod
        ? (Number.isFinite(deathDayNum) && deathDayNum >= 1 && deathDayNum <= 31 ? deathDayNum : null)
        : now.getDate();
      if (endMonth !== null && endMonth < birthMonthNum) {
        age--;
      } else if (
        endMonth !== null
        && endMonth === birthMonthNum
        && Number.isFinite(birthDayNum)
        && birthDayNum >= 1
        && birthDayNum <= 31
        && endDay !== null
        && endDay < birthDayNum
      ) {
        age--;
      }
    }
    return age;
  };
  const calculateTraditionalAge = () => {
    if (!birthYear) return null;
    return (deathYear ?? new Date().getFullYear()) - birthYear + 1;
  };
  const westernAge = calculateWesternAge();
  const traditionalAge = calculateTraditionalAge();
  const canRemoveAvatar = Boolean(avatarPreview || activePrimaryAvatarUrl || avatarFile);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-edit-person" onClick={(e) => e.stopPropagation()}>
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
                  if (!avatarImage || event.button !== 0) return;
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragStateRef.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    offsetX: offset.x,
                    offsetY: offset.y
                  };
                }}
                onPointerMove={(event) => {
                  const dragState = dragStateRef.current;
                  if (!dragState || dragState.pointerId !== event.pointerId) return;
                  event.preventDefault();
                  const deltaX = event.clientX - dragState.x;
                  const deltaY = event.clientY - dragState.y;
                  setOffset(clampOffset({
                    x: dragState.offsetX + deltaX,
                    y: dragState.offsetY + deltaY
                  }));
                }}
                onPointerUp={stopAvatarDrag}
                onPointerCancel={stopAvatarDrag}
                onLostPointerCapture={stopAvatarDrag}
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
                {canRemoveAvatar && (
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => {
                      const confirmed = window.confirm('確定要移除目前主頭像嗎？');
                      if (!confirmed) return;
                      setAvatarFile(null);
                      setSelectedPrimaryAvatarId(null);
                      setRemoveAvatar(true);
                    }}
                  >
                    移除主頭像
                  </button>
                )}
              </div>
              {initialAvatars.length > 0 && (
                <div className="avatar-gallery">
                  {initialAvatars.map((avatar) => {
                    const deleted = deleteAvatarIds.includes(avatar.id);
                    const isPrimary = !deleted && avatar.id === activePrimaryAvatarId;
                    const previewUrl = api.resolveAvatarUrl(avatar.avatar_url) || avatar.avatar_url;
                    return (
                      <div
                        key={avatar.id}
                        className={`avatar-gallery-item ${isPrimary ? 'is-primary' : ''} ${deleted ? 'is-deleted' : ''}`}
                      >
                        <img src={previewUrl} alt={`${name} avatar`} />
                        <div className="avatar-gallery-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={deleted || isPrimary}
                            onClick={() => {
                              setSelectedPrimaryAvatarId(avatar.id);
                              setRemoveAvatar(false);
                            }}
                          >
                            {isPrimary ? '主頭像' : '設主頭像'}
                          </button>
                          {!deleted ? (
                            <button
                              type="button"
                              className="btn-danger"
                              onClick={() => markAvatarForDelete(avatar.id)}
                            >
                              刪除
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => undoDeleteAvatar(avatar.id)}
                            >
                              還原
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
            <label>血型</label>
            <select
              value={bloodType}
              onChange={(event) => setBloodType(event.target.value)}
            >
              <option value="">未知</option>
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
              出生日期 {zodiac && ganzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({ganzhi}年・{zodiac})</span>}
            </label>
            <div className="date-input-row">
              <div className="date-input-main">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="年"
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
                  <option value="">月(選填)</option>
                  {Array.from({ length: 12 }, (_, idx) => {
                    const value = String(idx + 1);
                    return (
                      <option key={value} value={value}>
                        {value}月
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
                  <option value="">日(選填)</option>
                  {Array.from({ length: maxDobDay }, (_, idx) => {
                    const value = String(idx + 1);
                    return (
                      <option key={value} value={value}>
                        {value}日
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  className="date-year-btn"
                  onClick={() => adjustDobYear(-1)}
                  disabled={dobUnknown || !dobYear}
                  title="年份減一"
                >
                  -年
                </button>
                <button
                  type="button"
                  className="date-year-btn"
                  onClick={() => adjustDobYear(1)}
                  disabled={dobUnknown || !dobYear}
                  title="年份加一"
                >
                  +年
                </button>
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
                未知
              </label>
            </div>
            {!showDeathFields && (
              <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: '#64748b' }}>
                連點出生日期標籤 6 次可顯示歿日欄位
              </div>
            )}
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
          {showDeathFields && (
            <>
              <div className="form-group">
                <label>
                  歿日 {deathZodiac && deathGanzhi && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({deathGanzhi}年・{deathZodiac})</span>}
                </label>
                <div className="date-input-row">
                  <div className="date-input-main">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="年"
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
                      <option value="">月(選填)</option>
                      {Array.from({ length: 12 }, (_, idx) => {
                        const value = String(idx + 1);
                        return (
                          <option key={value} value={value}>
                            {value}月
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
                      <option value="">日(選填)</option>
                      {Array.from({ length: maxDodDay }, (_, idx) => {
                        const value = String(idx + 1);
                        return (
                          <option key={value} value={value}>
                            {value}日
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
                    未知
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label>
                  歿時辰 {todRange && <span style={{ marginLeft: '0.5rem', color: '#64748b' }}>({todRange})</span>}
                </label>
                <select
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

          {(westernAge !== null || traditionalAge !== null) && (
            <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
              {westernAge !== null && (
                <div>{dod ? `西元享壽 ${westernAge} 歲` : `西元目前 ${westernAge} 歲`}</div>
              )}
              {traditionalAge !== null && (
                <div>{dod ? `中華享壽(虛歲) ${traditionalAge} 歲` : `中華目前(虛歲) ${traditionalAge} 歲`}</div>
              )}
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={handleClose} disabled={isSaving}>
              取消
            </button>
            <button
              type="submit"
              className={`btn-primary modal-save-btn${isSaving ? ' is-loading' : ''}`}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <span className="btn-inline-spinner" aria-hidden="true" />
                  <span>儲存中...</span>
                </>
              ) : '儲存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
