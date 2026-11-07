/**
 * Какая вкладка открыта в разделе «Кошелёк».
 *
 * ## Почему отдельный стор, а не `$state` в `WalletMain`
 *
 * Вкладку переключают два места: сами кнопки в правой панели и ссылка
 * «Управление аккаунтами» в левой. Локальное состояние компонента не видно
 * левой панели, а держать копию в двух компонентах — гарантированный
 * рассинхрон: нажал «Управление аккаунтами», правая панель осталась на
 * «Активах», и ссылка снова выглядит нерабочей.
 */

export type WalletTab = 'assets' | 'send' | 'receive' | 'buy' | 'swap' | 'accounts';

export const walletView = $state({
  activeTab: 'assets' as WalletTab,
});

export function selectWalletTab(tab: WalletTab): void {
  walletView.activeTab = tab;
}

export function resetWalletView(): void {
  walletView.activeTab = 'assets';
}
