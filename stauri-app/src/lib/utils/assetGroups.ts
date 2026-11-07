/**
 * Группировка токенов для списка активов.
 *
 * ## Зачем отдельный модуль
 *
 * Группировка решает, что человек видит одной строкой, а что — разными.
 * Это не вёрстка: сложить `ETH` из Sepolia и `ETH` из Base Sepolia в одну
 * сумму значит показать число, которого не существует ни в одной сети.
 * Поэтому логика вынесена из компонента и покрыта тестами.
 *
 * ## Что с чем складывается
 *
 * Одна строка — это «один и тот же актив, который можно считать вместе»:
 *
 *   * mainnet-сети (Ethereum, Optimism, Arbitrum, Base) — одна группа `EVM`:
 *     ETH на них это действительно один и тот же ETH, только на разных
 *     уровнях, и Status показывает их общей суммой;
 *   * BNB Chain — своя группа `BSC`;
 *   * **каждая тестовая сеть — отдельная группа.** В Python-стиле «всё
 *     остальное в OTHER» здесь как раз и была ошибка: в testnet-режиме
 *     все пять сетей попадали в одну группу, и пять разных тестовых ETH
 *     схлопывались в одну строку.
 *
 * ## Почему ключ включает decimals
 *
 * Суммировать можно только величины в одинаковых единицах. Если у двух
 * токенов один символ, но разное число знаков (бывает у «USDC» разных
 * выпусков), `rawBalance` — это разные единицы, и их сумма бессмысленна.
 * Такие токены показываются отдельными строками.
 */

import type { WalletToken } from '$lib/stores/walletStore.svelte';

/** Сети, балансы которых считаются одним активом. */
const EVM_CHAINS = new Set([1, 10, 42161, 8453]);

/** BNB Chain. BSC Testnet (97) сюда намеренно не входит — см. `chainGroup`. */
const BSC_CHAINS = new Set([56]);

/** Человеческие имена сетей — для подписи строки. */
export const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  56: 'BNB Chain',
  97: 'BNB Testnet',
  8453: 'Base',
  42161: 'Arbitrum',
  84532: 'Base Sepolia',
  560048: 'Hoodi',
  11155111: 'Sepolia',
  11155420: 'Optimism Sepolia',
  421614: 'Arbitrum Sepolia',
};

/**
 * Группа сети.
 *
 * Неизвестная (в том числе тестовая) сеть получает собственную группу по
 * номеру: складывать её с чем-либо нельзя, пока не доказано, что это тот же
 * актив.
 */
export function chainGroup(chainId: number): string {
  if (EVM_CHAINS.has(chainId)) return 'EVM';
  if (BSC_CHAINS.has(chainId)) return 'BSC';
  return String(chainId);
}

/** Символ без невидимых символов и в верхнем регистре. */
export function normalizeSymbol(symbol: string): string {
  return String(symbol || '')
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .toUpperCase();
}

export interface AssetGroup {
  /** Уникальный ключ строки списка. */
  key: string;
  /** Группа сети: `EVM`, `BSC` или номер сети строкой. */
  group: string;
  symbol: string;
  /** Знаков после запятой; внутри группы всегда одно значение. */
  decimals: number;
  /** Сумма в минимальных единицах. */
  totalBalance: bigint;
  /** Сети, из которых сложена сумма. */
  chains: number[];
  hasError: boolean;
}

/** Безопасный разбор баланса: испорченное значение — не повод падать. */
function rawOf(token: WalletToken): { value: bigint; broken: boolean } {
  try {
    return { value: BigInt(token.balance || '0'), broken: false };
  } catch {
    return { value: 0n, broken: true };
  }
}

/**
 * Строит строки списка активов.
 *
 * Порядок: сначала с ненулевым балансом, затем по символу. Внутри группы
 * сети перечисляются в порядке приоритета (см. `CHAIN_PRIORITY` в
 * компоненте) — здесь порядок не важен, его задаёт отображение.
 */
export function groupAssets(tokens: WalletToken[]): AssetGroup[] {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- локальная карта на время вызова
  const map = new Map<string, AssetGroup>();

  for (const token of tokens) {
    const symbol = normalizeSymbol(token.symbol);
    const group = chainGroup(token.chainId);
    const baseKey = `${symbol}:${group}`;

    // Тот же символ и та же группа, но другая точность — другой актив.
    const existingBase = map.get(baseKey);
    const key =
      existingBase && existingBase.decimals !== token.decimals
        ? `${baseKey}:${token.decimals}`
        : baseKey;

    const { value, broken } = rawOf(token);
    const existing = map.get(key);

    if (existing) {
      existing.totalBalance += value;
      if (!existing.chains.includes(token.chainId)) {
        existing.chains.push(token.chainId);
      }
      existing.hasError = existing.hasError || token.hasError || broken;
    } else {
      map.set(key, {
        key,
        group,
        symbol,
        decimals: token.decimals,
        totalBalance: value,
        chains: [token.chainId],
        hasError: token.hasError || broken,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const aZero = a.totalBalance === 0n ? 1 : 0;
    const bZero = b.totalBalance === 0n ? 1 : 0;
    if (aZero !== bZero) return aZero - bZero;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Подпись строки.
 *
 * Для `EVM` и `BSC` — как в Status: `ETH (EVM)`. Для отдельной сети —
 * её имя, иначе номер: `ETH (Sepolia)`. Без имени человек не отличит
 * пять разных тестовых ETH друг от друга.
 */
export function groupLabel(group: AssetGroup): string {
  if (group.group === 'EVM' || group.group === 'BSC') {
    return `${group.symbol} (${group.group})`;
  }
  const name = CHAIN_NAMES[Number(group.group)];
  return name ? `${group.symbol} (${name})` : group.symbol;
}
