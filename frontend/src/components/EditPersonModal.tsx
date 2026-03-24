import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Avatar, Person } from '../types';
import { getGanzhiYear, getZodiacAnimal, getModernTimeRange, normalizeTraditionalHour, TRADITIONAL_HOURS } from '../utils/chineseTime';
import { api } from '../api';
import { clampDay, composePartialDate, parsePartialDate } from '../utils/partialDate';
import { useI18n } from '../i18n';

export type EditPersonAvatarActions = {
  setPrimaryAvatarId?: string | null;
  deleteAvatarIds?: string[];
};

interface EditPersonModalProps {
  person: Person;
  showBirthTimeField?: boolean;
  canInvite?: boolean;
  onClose: () => void;
  onUnsavedClose?: () => void;
  onSubmit: (
    id: string,
    updates: Partial<Person>,
    avatarFile: File | null,
    removeAvatar: boolean,
    avatarActions?: EditPersonAvatarActions
  ) => Promise<void> | void;
  onInvite?: (id: string, email: string) => Promise<void> | void;
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

const MAX_AVATAR_BYTES = 20 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const formatSaveError = (
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string
) => {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('unsupported file type')) {
    return t('editPerson.errorUnsupportedImage');
  }
  if (raw.includes('file is too large') || raw.includes('HTTP 413')) {
    return t('editPerson.errorImageTooLarge');
  }
  if (raw.includes('HTTP 400')) {
    return t('editPerson.errorBadRequest');
  }
  return raw || t('editPerson.errorSaveFailed');
};

export const EditPersonModal: React.FC<EditPersonModalProps> = ({
  person,
  showBirthTimeField = true,
  canInvite = false,
  onClose,
  onUnsavedClose,
  onSubmit,
  onInvite,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState(person.name);
  const [isNameEditable, setIsNameEditable] = useState(false);
  const [englishName, setEnglishName] = useState(person.english_name || '');
  const [email, setEmail] = useState(person.email || '');
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
  const [isInviting, setIsInviting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
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
    setIsNameEditable(false);
    setEnglishName(person.english_name || '');
    setEmail(person.email || '');
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
    setIsInviting(false);
    setSaveError(null);
    setInviteNotice(null);
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
    const croppedAvatar = avatarFile
      ? ((await createCroppedAvatar()) || avatarFile)
      : null;
    const normalizedEnglish = englishName.trim();
    const nextUpdates: Partial<Person> = {
      name,
      english_name: normalizedEnglish ? normalizedEnglish : null,
      email: email.trim() ? email.trim().toLowerCase() : null,
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
    email,
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
  const initialEmail = person.email || '';
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
    || email !== initialEmail
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
    setSaveError(null);
    setIsSaving(true);
    try {
      await saveChanges();
    } catch (error) {
      console.error('Failed to save person changes:', error);
      setSaveError(formatSaveError(error, t));
    } finally {
      setIsSaving(false);
    }
  };

  const handleInvite = useCallback(async () => {
    if (!onInvite || isInviting || isSaving) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setSaveError(t('editPerson.emailRequired'));
      setInviteNotice(null);
      return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(normalizedEmail)) {
      setSaveError(t('editPerson.emailInvalid'));
      setInviteNotice(null);
      return;
    }
    setIsInviting(true);
    setSaveError(null);
    setInviteNotice(null);
    try {
      await onInvite(person.id, normalizedEmail);
      setEmail(normalizedEmail);
      setInviteNotice(t('editPerson.inviteSent', { email: normalizedEmail }));
    } catch (error) {
      console.error('Failed to invite person account:', error);
      setSaveError(error instanceof Error ? error.message : t('editPerson.inviteFailed'));
    } finally {
      setIsInviting(false);
    }
  }, [email, isInviting, isSaving, onInvite, person.id, t]);

  const handleUnlockNameEdit = useCallback(() => {
    if (isNameEditable) return;
    const confirmed = window.confirm(t('editPerson.unlockConfirm'));
    if (!confirmed) return;
    setIsNameEditable(true);
  }, [isNameEditable, t]);

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
    if (file.size > MAX_AVATAR_BYTES) {
      setSaveError(t('editPerson.errorImageTooLarge'));
      return;
    }
    if (!ACCEPTED_AVATAR_TYPES.has(file.type)) {
      setSaveError(t('editPerson.errorUnsupportedImage'));
      return;
    }
    setSaveError(null);
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
  const avatarStatusTone = removeAvatar
    ? 'warning'
    : avatarFile
      ? 'accent'
      : activePrimaryAvatarId
        ? 'stable'
        : 'muted';
  const avatarStatusLabel = removeAvatar
    ? t('editPerson.avatarStatusMarkedRemove')
    : avatarFile
      ? t('editPerson.avatarStatusPendingNew')
      : activePrimaryAvatarId
        ? t('editPerson.avatarStatusUsingExisting')
        : t('editPerson.avatarStatusNone');
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-edit-person" onClick={(e) => e.stopPropagation()}>
        <h2>{t('editPerson.title')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <div className="name-lock-row">
              <label>{t('personForm.name')}</label>
              {!isNameEditable ? (
                <button
                  type="button"
                  className="btn-secondary name-lock-btn"
                  onClick={handleUnlockNameEdit}
                  disabled={isSaving}
                >
                  <span className="name-lock-btn-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6.5 8V6.9a3.5 3.5 0 1 1 7 0" />
                      <path d="M5.5 8h7a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z" />
                      <path d="M9.9 11.35a1.45 1.45 0 1 0 0 2.9" />
                    </svg>
                  </span>
                  <span className="name-lock-btn-label">{t('editPerson.unlockName')}</span>
                </button>
              ) : (
                <span className="name-lock-chip">{t('editPerson.nameUnlocked')}</span>
              )}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={!isNameEditable}
              className={!isNameEditable ? 'name-input-locked' : undefined}
              required
              autoFocus={isNameEditable}
            />
            {!isNameEditable && (
              <small className="name-lock-hint">{t('editPerson.nameLockHint')}</small>
            )}
          </div>
          <div className="form-group">
            <label>{t('personForm.englishName')}</label>
            <input
              value={englishName}
              onChange={(e) => setEnglishName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>{t('personForm.email')}</label>
            <div className="person-email-row">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setInviteNotice(null);
                }}
                placeholder={t('personForm.emailPlaceholder')}
                autoComplete="email"
              />
              {canInvite && onInvite && (
                <button
                  type="button"
                  className={`btn-secondary person-invite-btn${isInviting ? ' is-loading' : ''}`}
                  onClick={handleInvite}
                  disabled={isInviting || isSaving}
                >
                  {isInviting ? t('editPerson.inviting') : t('editPerson.invite')}
                </button>
              )}
            </div>
            {inviteNotice && (
              <small className="person-email-hint is-success">{inviteNotice}</small>
            )}
            {!inviteNotice && canInvite && onInvite && (
              <small className="person-email-hint">{t('editPerson.inviteHelp')}</small>
            )}
          </div>
          <div className="form-group">
            <label>{t('editPerson.avatar')}</label>
            <div className="avatar-picker">
              <div className="avatar-editor-main">
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
                    <span>{t('editPerson.dragPhotoHere')}</span>
                  )}
                </div>
                <div className="avatar-editor-meta">
                  <div className="avatar-status-row">
                    <span className={`avatar-status-badge tone-${avatarStatusTone}`}>
                      {avatarStatusLabel}
                    </span>
                    <span className="avatar-status-chip">
                      {t('editPerson.availableCount', { count: availableAvatars.length })}
                    </span>
                  </div>
                  <p className="avatar-editor-hint">
                    {t('editPerson.avatarHint')}
                  </p>
                  <div className="avatar-actions-row">
                    <label className="btn-secondary avatar-upload">
                      {t('editPerson.choosePhoto')}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(e) => {
                          handleFileSelect(e.target.files?.[0] || null);
                          e.currentTarget.value = '';
                        }}
                      />
                    </label>
                    {canRemoveAvatar && (
                      <button
                        type="button"
                        className="btn-danger avatar-danger-btn"
                        onClick={() => {
                          const confirmed = window.confirm(t('editPerson.removePrimaryConfirm'));
                          if (!confirmed) return;
                          setAvatarFile(null);
                          setSelectedPrimaryAvatarId(null);
                          setRemoveAvatar(true);
                        }}
                      >
                        {t('editPerson.removePrimary')}
                      </button>
                    )}
                  </div>
                  {avatarPreview && (
                    <div className="avatar-zoom-wrap">
                      <div className="avatar-zoom-head">
                        <span>{t('editPerson.zoom')}</span>
                        <span>{zoomPercent}%</span>
                      </div>
                      <input
                        className="avatar-zoom"
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              </div>
              {initialAvatars.length > 0 && (
                <div className="avatar-library">
                  <div className="avatar-library-head">
                    <span>{t('editPerson.photoLibrary')}</span>
                    <span>{t('editPerson.libraryCount', { count: initialAvatars.length })}</span>
                  </div>
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
                          <button
                            type="button"
                            className="avatar-gallery-preview"
                            disabled={deleted}
                            onClick={() => {
                              setSelectedPrimaryAvatarId(avatar.id);
                              setRemoveAvatar(false);
                            }}
                          >
                            <img src={previewUrl} alt={`${name} avatar`} />
                            {isPrimary && <span className="avatar-badge is-primary">{t('editPerson.primary')}</span>}
                            {deleted && <span className="avatar-badge is-deleted">{t('editPerson.pendingDelete')}</span>}
                          </button>
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
                              {isPrimary ? t('editPerson.currentPrimary') : t('editPerson.setPrimary')}
                            </button>
                            {!deleted ? (
                              <button
                                type="button"
                                className="btn-danger avatar-gallery-danger"
                                onClick={() => markAvatarForDelete(avatar.id)}
                              >
                                {t('common.delete')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => undoDeleteAvatar(avatar.id)}
                              >
                                {t('editPerson.undo')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {saveError && (
                <div className="report-issue-error" style={{ marginTop: '0.55rem' }}>
                  {saveError}
                </div>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>{t('personForm.gender')}</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
            >
              <option value="M">{t('personForm.genderMale')}</option>
              <option value="F">{t('personForm.genderFemale')}</option>
              <option value="O">{t('personForm.genderOther')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('personForm.bloodType')}</label>
            <select
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
                <button
                  type="button"
                  className="date-year-btn"
                  onClick={() => adjustDobYear(-1)}
                  disabled={dobUnknown || !dobYear}
                  title={t('editPerson.decreaseYear')}
                >
                  {t('editPerson.decreaseYearShort')}
                </button>
                <button
                  type="button"
                  className="date-year-btn"
                  onClick={() => adjustDobYear(1)}
                  disabled={dobUnknown || !dobYear}
                  title={t('editPerson.increaseYear')}
                >
                  {t('editPerson.increaseYearShort')}
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
              <select value={tob} onChange={(e) => setTob(e.target.value)}>
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
            <label>{t('editPerson.customFields')}</label>
            <div className="custom-fields">
              {customFields.length === 0 && (
                <div className="custom-fields-empty">{t('editPerson.customFieldsEmpty')}</div>
              )}
              {customFields.map((field, index) => (
                <div className="custom-field-row" key={`custom-field-${index}`}>
                  <input
                    value={field.label}
                    placeholder={t('editPerson.fieldName')}
                    onChange={(e) => updateCustomField(index, 'label', e.target.value)}
                  />
                  <input
                    value={field.value}
                    placeholder={t('editPerson.fieldValue')}
                    onChange={(e) => updateCustomField(index, 'value', e.target.value)}
                  />
                  <button
                    type="button"
                    className="custom-field-remove"
                    onClick={() => removeCustomField(index)}
                  >
                    {t('editPerson.removeField')}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="custom-field-add" onClick={addCustomField}>
              {t('editPerson.addField')}
            </button>
          </div>

          {(westernAge !== null || traditionalAge !== null) && (
            <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#64748b', textAlign: 'center' }}>
              {westernAge !== null && (
                <div>{dod
                  ? t('editPerson.ageAtDeath', { age: westernAge })
                  : t('editPerson.currentAge', { age: westernAge })}</div>
              )}
              {traditionalAge !== null && (
                <div>{dod
                  ? t('editPerson.traditionalAgeAtDeath', { age: traditionalAge })
                  : t('editPerson.currentTraditionalAge', { age: traditionalAge })}</div>
              )}
            </div>
          )}

          <div className="form-actions">
            <button type="button" onClick={handleClose} disabled={isSaving}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={`btn-primary modal-save-btn${isSaving ? ' is-loading' : ''}`}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <span className="btn-inline-spinner" aria-hidden="true" />
                  <span>{t('common.saving')}</span>
                </>
              ) : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
