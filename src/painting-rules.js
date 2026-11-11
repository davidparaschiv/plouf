import { t } from './i18n.js';
export function normalizeItem(value) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
export function itemKey(value) {
  return normalizeItem(value).normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}
export function validateItems(value) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !normalizeItem(v))) throw Error(t('itemsInvalid'));
  const items = value.map(normalizeItem);
  if (new Set(items.map(itemKey)).size !== items.length) throw Error(t('itemsUnique'));
  return items;
}
