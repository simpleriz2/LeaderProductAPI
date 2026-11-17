import QRCode from 'qrcode';

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

export {normalizeAndValidate,assertQrType,toStringData} from '../modules/qr/content';
