import {generateQrVCard} from './vcard';
// utils/validateQRData.ts
const validator = require('validator');

export type QRType =
  | 'PHONE'
  | 'LINK'
  | 'EMAIL'
  | 'TEXT'
  | 'WHATSAPP'
  | 'TELEGRAM'
  | 'CONTACT';

export function validateQRData(qrType: QRType, qrData: string): string | null {
  switch (qrType) {
    case 'PHONE':
    case 'WHATSAPP':
      if (!/^[+]\d{5,15}$/.test(qrData)) {
        return 'Номер телефона должен начинаться с + и содержать от 5 до 15 цифр';
      }
      break;

    case 'EMAIL':
      if (!validator.isEmail(qrData)) {
        return 'Неверный email';
      }
      break;

    case 'LINK':
      if (
        !validator.isURL(qrData, {
          require_protocol: false,
          protocols: ['http', 'https'],
          allow_underscores: true,
        })
      ) {
        return 'Неверный URL';
      }
      break;

    case 'TELEGRAM':
      if (!/^@[a-zA-Z0-9_]{5,32}$/.test(qrData)) {
        return 'Telegram username должен начинаться с @ и быть от 5 до 32 символов';
      }
      break;

    case 'CONTACT':
      try {
        const parsed = JSON.parse(qrData);
        if (!parsed.name || typeof parsed.name !== 'string') {
          return 'Контакт должен содержать поле name';
        }
      } catch {
        return 'Неверный JSON формат контакта';
      }
      break;

    case 'TEXT':
      if (qrData.length > 1000) {
        return 'Слишком длинный текст (макс 1000 символов)';
      }
      break;

    default:
      return 'Неподдерживаемый тип QR';
  }

  return null; // Все прошло
}

const ALLOWED_QR_TYPES = ['PHONE','LINK','EMAIL','TEXT','WHATSAPP','TELEGRAM','CONTACT'] as const;
export type AllowedQrType = typeof ALLOWED_QR_TYPES[number];

export function toStringData(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw ?? '');
}

export function normalizeAndValidate(qrType: AllowedQrType, qrDataRaw: unknown): string {
  // приведение к строке/JSON
  let data = toStringData(qrDataRaw);

  // CONTACT: разрешаем JSON -> VCARD, либо уже готовый VCARD
  if (qrType === 'CONTACT') {
    if (data.startsWith('BEGIN:VCARD')) {
      // уже VCARD
    } else {
      try {
        const contactObj = JSON.parse(data);
        data = generateQrVCard(contactObj);
      } catch (e) {
        throw new Error('Неверный формат контактных данных');
      }
    }
    return data;
  }

  // для не-CONTACT: валидация строкой
  if (typeof data !== 'string') {
    throw new Error('qrData должен быть строкой или объектом');
  }

  // Спец-нормализация под типы
  if (qrType === 'PHONE' || qrType === 'WHATSAPP') {
    // Remove visual separators only; never truncate or silently discard an extension/embedded '+'.
    const cleaned = data.replace(/[\s().-]/g, '');
    data = cleaned.startsWith('+') ? cleaned : '+' + cleaned;
  }

  if (qrType === 'TELEGRAM') {
    if (!data.startsWith('@')) data = '@' + data.replace(/^@+/, '');
  }

  const validationError = validateQRData(qrType, data);
  if (validationError) throw new Error(validationError);

  return data;
}

export function assertQrType(type?: string): asserts type is AllowedQrType {
  if (!type || !ALLOWED_QR_TYPES.includes(type as AllowedQrType)) {
    throw new Error('Неверный тип qrType');
  }
}

