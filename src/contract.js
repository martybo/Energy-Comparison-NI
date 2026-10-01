/**
 * The published dataset contract.
 *
 * validate.js decides whether each tariff can be costed, and is deliberately
 * tolerant of a dataset that lacks optional structure so the page can degrade
 * gracefully. This module states the structure a dataset must have to be
 * published at all: the fields the page reads (the payment-method labels that
 * populate the filter and the result cards, the supplier notices) and the
 * canonical fields every tariff record carries, whether or not today's page
 * reads them.
 *
 * It exists because a dataset can validate cleanly and still break the page:
 * the first automatically extracted candidate carried every tariff correctly
 * but no `payment_methods` map, so the payment-method filter offered nothing
 * and the results showed raw keys. A missing key is not a null — null says
 * "the source does not state this"; an absent key says the field was dropped.
 */

import { PAYMENT_METHODS } from './validate.js';

export const SCHEMA_VERSION = 2;

/** Display labels for the payment-method keys. A fixed vocabulary, not tariff data. */
export const PAYMENT_METHOD_LABELS = Object.freeze({
  prepayment: 'Prepayment',
  direct_debit_ebill: 'Direct Debit (e-bill)',
  direct_debit_postal: 'Direct Debit (postal bill)',
  on_receipt_ebill: 'Pay on receipt of e-bill',
  on_receipt_postal: 'Pay on receipt of bill'
});

/** Top-level keys, in the order a dataset file writes them. */
export const DATASET_KEYS = ['schema_version', 'dataset', 'payment_methods', 'supplier_notes', 'tariffs'];

/** The dataset header fields documented in docs/DATA.md. */
export const HEADER_KEYS = [
  'effective_from',
  'published',
  'source',
  'source_url',
  'vat_treatment',
  'rate_unit',
  'standing_unit',
  'conditions_verified'
];

/** Every tariff record's keys, in the order a dataset file writes them. */
export const TARIFF_KEYS = [
  'id',
  'supplier',
  'name',
  'meter_type',
  'status',
  'rate_basis',
  'headline_discount_pct',
  'headline_discount_wording',
  'intro_period_months',
  'intro_period_basis',
  'reverts_to',
  'contract',
  'eligibility',
  'rates',
  'adjustments',
  'start_date',
  'notes'
];

const has = (object, key) => object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Lists every way a dataset falls short of the contract. Empty means it meets it.
 *
 * With `reference` — the dataset currently published — it also refuses any
 * key the reference carries that the dataset does not: whatever a published
 * dataset has, its successor must not silently drop, even a field this
 * contract does not (yet) name.
 */
export function contractViolations(dataset, { reference = null } = {}) {
  const violations = [];
  const add = (code, where, message) => violations.push({ code, where, message });

  if (!isPlainObject(dataset)) {
    add('not_an_object', 'dataset', 'The dataset is not a JSON object.');
    return violations;
  }

  for (const key of DATASET_KEYS) {
    if (!has(dataset, key)) add('missing_key', key, `The dataset has no "${key}".`);
  }
  if (has(dataset, 'schema_version') && dataset.schema_version !== SCHEMA_VERSION) {
    add('schema_version', 'schema_version', `schema_version is ${JSON.stringify(dataset.schema_version)}, expected ${SCHEMA_VERSION}.`);
  }

  const header = dataset.dataset;
  if (has(dataset, 'dataset')) {
    for (const key of HEADER_KEYS) {
      if (!has(header, key)) add('missing_header_field', `dataset.${key}`, `The dataset header has no "${key}".`);
    }
  }

  if (has(dataset, 'supplier_notes')) {
    if (!isPlainObject(dataset.supplier_notes)) {
      add('supplier_notes_shape', 'supplier_notes', 'supplier_notes must be an object of supplier name to note.');
    } else {
      for (const [supplier, note] of Object.entries(dataset.supplier_notes)) {
        if (typeof note !== 'string' || note.trim() === '') add('supplier_note_empty', `supplier_notes.${supplier}`, `The note for ${supplier} is empty.`);
      }
    }
  }

  const labels = isPlainObject(dataset.payment_methods) ? dataset.payment_methods : {};
  if (has(dataset, 'payment_methods') && !isPlainObject(dataset.payment_methods)) {
    add('payment_methods_shape', 'payment_methods', 'payment_methods must be an object of payment-method key to label.');
  }
  for (const [key, label] of Object.entries(labels)) {
    if (!PAYMENT_METHODS.includes(key)) add('payment_method_unknown', `payment_methods.${key}`, `"${key}" is not a payment method.`);
    if (typeof label !== 'string' || label.trim() === '') add('payment_method_label_empty', `payment_methods.${key}`, `"${key}" has no label.`);
  }

  const tariffs = Array.isArray(dataset.tariffs) ? dataset.tariffs : [];
  if (has(dataset, 'tariffs') && !Array.isArray(dataset.tariffs)) add('tariffs_shape', 'tariffs', 'tariffs must be an array.');

  // The page offers, and labels results with, exactly these methods. One the
  // map does not label is one the filter cannot offer and a result card can
  // only show as a raw key.
  const offered = new Set(tariffs.flatMap((t) => (Array.isArray(t?.rates) ? t.rates.map((r) => r?.payment_method) : [])));
  for (const method of offered) {
    if (typeof labels[method] !== 'string' || labels[method].trim() === '') {
      add('payment_method_unlabelled', `payment_methods.${method}`, `Tariffs are priced for "${method}", but payment_methods gives it no label.`);
    }
  }

  for (const tariff of tariffs) {
    const where = `tariffs.${tariff?.id ?? '(no id)'}`;
    for (const key of TARIFF_KEYS) {
      if (!has(tariff, key)) add('missing_tariff_field', `${where}.${key}`, `Tariff ${tariff?.id ?? '(no id)'} has no "${key}".`);
    }
  }

  if (isPlainObject(reference)) {
    for (const key of Object.keys(reference)) {
      if (!has(dataset, key) && !DATASET_KEYS.includes(key)) {
        add('dropped_key', key, `The published dataset has "${key}"; this one does not.`);
      }
    }
    if (isPlainObject(reference.dataset) && isPlainObject(header)) {
      for (const key of Object.keys(reference.dataset)) {
        if (!has(header, key) && !HEADER_KEYS.includes(key)) {
          add('dropped_header_field', `dataset.${key}`, `The published dataset header has "${key}"; this one does not.`);
        }
      }
    }
    // A field every published tariff carries is part of that dataset's
    // structure, so every tariff in its successor must carry it too.
    const referenceTariffs = Array.isArray(reference.tariffs) ? reference.tariffs : [];
    if (referenceTariffs.length > 0) {
      const common = Object.keys(referenceTariffs[0]).filter((key) => referenceTariffs.every((t) => has(t, key)));
      for (const key of common.filter((k) => !TARIFF_KEYS.includes(k))) {
        for (const tariff of tariffs) {
          if (!has(tariff, key)) add('dropped_tariff_field', `tariffs.${tariff?.id ?? '(no id)'}.${key}`, `Every published tariff has "${key}"; tariff ${tariff?.id ?? '(no id)'} does not.`);
        }
      }
    }
  }

  return violations;
}
