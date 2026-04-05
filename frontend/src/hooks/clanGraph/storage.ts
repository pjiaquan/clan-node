const ACTIVE_LAYER_STORAGE_KEY = 'clan.layer.active';
const defaultCenterId = '296f7664-ec3c-49c4-946c-4c54e8ce96e4';

export { defaultCenterId };

export const parseMetadata = (value: unknown) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const readStoredActiveLayerId = () => {
  try {
    return localStorage.getItem(ACTIVE_LAYER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

export const persistActiveLayerId = (layerId: string) => {
  try {
    if (layerId) localStorage.setItem(ACTIVE_LAYER_STORAGE_KEY, layerId);
  } catch (err) {
    console.warn('Failed to persist active layer id:', err);
  }
};

export const getCenterStorageKey = (layerId: string) => `clan.centerId.${layerId}`;

export const persistCenterId = (layerId: string, id: string) => {
  try {
    localStorage.setItem(getCenterStorageKey(layerId), id);
  } catch (err) {
    console.warn('Failed to persist centerId:', err);
  }
};

export const clearStoredLayerState = (layerId: string) => {
  try {
    localStorage.removeItem(getCenterStorageKey(layerId));
  } catch (error) {
    console.warn('Failed to clear stored layer state:', error);
  }
};

export const queueLayerFocus = (layerId: string, centerId: string, zoom = 1) => {
  try {
    localStorage.setItem('clan.pendingFocus', JSON.stringify({
      id: centerId,
      zoom,
      layerId,
    }));
    localStorage.removeItem('clan.pendingFocusPosition');
    localStorage.removeItem('clan.pendingCenterId');
  } catch (error) {
    console.warn('Failed to queue layer focus:', error);
  }
};

export const persistLastEditedFocus = (id: string, layerId: string, zoom: number) => {
  try {
    localStorage.setItem('clan.lastEditedId', id);
    localStorage.setItem('clan.pendingFocus', JSON.stringify({ id, zoom, layerId }));
  } catch (error) {
    console.warn('Failed to persist last edited id:', error);
  }
};
