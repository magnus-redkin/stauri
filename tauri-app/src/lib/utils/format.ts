/**
 * Форматирует строку с wei (или другими минимальными единицами)
 * в читаемый вид, учитывая decimals.
 *
 * @param weiStr - Строка с числом в минимальных единицах (например, "1000000000000000000")
 * @param decimals - Количество знаков после запятой (по умолчанию 18 для ETH)
 * @param maxFractionDigits - Максимум знаков после запятой в выводе (по умолчанию 6)
 * @returns Отформатированная строка (например, "1.0" или "0.5")
 * @throws Error если входное значение не может быть преобразовано в BigInt
 */
export function formatBalance(
  weiStr: string | undefined | null,
  decimals: number = 18,
  maxFractionDigits: number = 6
): string {
  if (!weiStr || weiStr === '0') return '0';

  // Если decimals некорректны, используем 18 (ETH по умолчанию)
  const safeDecimals = Number.isInteger(decimals) && decimals >= 0 ? decimals : 18;

  let wei: bigint;
  try {
    wei = BigInt(weiStr);
  } catch (e) {
    // Не глотаем ошибку — пусть вызывающий код решает, что делать
    throw new Error(`Invalid balance value: "${weiStr}"`);
  }

  const divisor = 10n ** BigInt(safeDecimals);
  const integerPart = wei / divisor;
  const fractionalPart = wei % divisor;

  // Если дробная часть равна 0, возвращаем только целое
  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  // Формируем дробную часть с ведущими нулями
  let fracStr = fractionalPart.toString().padStart(safeDecimals, '0');

  // Ограничиваем количество знаков после запятой
  if (fracStr.length > maxFractionDigits) {
    fracStr = fracStr.substring(0, maxFractionDigits);
  }

  // Убираем лишние нули в конце
  fracStr = fracStr.replace(/0+$/, '');

  if (!fracStr) {
    return integerPart.toString();
  }

  return `${integerPart}.${fracStr}`;
}
