/**
 * Форматирует строку с wei (или другими минимальными единицами)
 * в читаемый вид, учитывая decimals.
 *
 * @param weiStr - Строка с числом в минимальных единицах (например, "1000000000000000000")
 * @param decimals - Количество знаков после запятой (по умолчанию 18 для ETH)
 * @returns Отформатированная строка (например, "1.0" или "0.5")
 */
export function formatBalance(weiStr: string | undefined | null, decimals: number = 18): string {
  if (!weiStr || weiStr === '0') return '0';

  try {
    const wei = BigInt(weiStr);
    const divisor = BigInt(10 ** decimals);
    const integerPart = wei / divisor;
    const fractionalPart = wei % divisor;

    // Если дробная часть равна 0, возвращаем только целое
    if (fractionalPart === 0n) {
      return integerPart.toString();
    }

    // Иначе формируем строку и убираем лишние нули в конце
    const fracStr = fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${integerPart}.${fracStr}`;
  } catch (e) {
    console.error("Failed to format balance:", e);
    return '0';
  }
}
