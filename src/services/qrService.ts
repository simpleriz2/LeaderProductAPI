import {generateQrVCard} from '../modules/qr/vcard';
import QRCode from 'qrcode';
import { validateQRData } from '../utils/validateQRData';

import {validateQrImageOptions,type QrImageOptions as QRCodeOptions} from '../modules/qr/imageOptions';

/**
 * Генерирует QR код в формате Base64
 * @param data Данные для кодирования в QR
 * @param options Опции генерации
 * @returns Promise с Data URL (base64) изображения QR кода
 * @throws Ошибка генерации QR кода
 */
export const generateQRCode = async (
  data: string,
  options: QRCodeOptions = {}
): Promise<string> => {
  try {
    const defaultOptions=validateQrImageOptions(options);

    if (!data || typeof data !== 'string') {
      throw new Error('Данные для QR кода должны быть непустой строкой');
    }

    return await QRCode.toDataURL(data, defaultOptions);
  } catch (error) {
    console.error('Ошибка генерации QR кода:', error);
    throw new Error(
      `Не удалось сгенерировать QR код: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`
    );
  }
};

const ALLOWED_QR_TYPES = ['PHONE','LINK','EMAIL','TEXT','WHATSAPP','TELEGRAM','CONTACT'] as const;
type AllowedQrType = typeof ALLOWED_QR_TYPES[number];

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

