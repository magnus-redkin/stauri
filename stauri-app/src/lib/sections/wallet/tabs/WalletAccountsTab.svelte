<script lang="ts">
  /**
   * Аккаунты кошелька.
   *
   * ## Почему этот экран появился
   *
   * В левой панели кошелька была ссылка «Управление аккаунтами», которая
   * открывала раздел профиля Stauri (`EditProfile`) — там меняются имя и
   * аватар, но нет ни одного кошелька. Ссылка вела туда только потому, что
   * отдельного экрана не существовало, а поле `walletState.accounts` никто
   * не заполнял.
   *
   * ## Что здесь можно и чего нельзя
   *
   * Показываем то, что реально знает бэкенд: адрес, путь деривации и имя.
   * Добавление и удаление аккаунтов — отдельная работа: в status-go это
   * `accounts_addAccount`/`accounts_deleteAccount`, и они требуют пароль
   * и решения, что делать с балансом. Здесь этого нет осознанно — экран
   * честно показывает существующее вместо кнопок, которые ничего не делают.
   */
  import { i18n } from '$lib/i18n';
  import { walletState } from '$lib/stores/walletStore.svelte';

  let copied = $state('');

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      copied = address;
      setTimeout(() => { if (copied === address) copied = ''; }, 2000);
    } catch (e) {
      console.error(e);
    }
  }

  /** Короткий вид адреса для заголовка: начало и конец. */
  function short(addr: string): string {
    if (addr.length <= 14) return addr;
    return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  }
</script>

<div class="h-full flex flex-col p-6 overflow-auto">
  <h3 class="text-lg font-semibold mb-1">{i18n.t('Manage accounts')}</h3>
  <p class="text-xs text-muted-foreground mb-4 max-w-md">
    {i18n.t('These are the wallet accounts of this profile. Each has its own address on every EVM network.')}
  </p>

  {#if walletState.accounts.length === 0}
    <p class="text-muted-foreground text-sm">{i18n.t('No wallet addresses')}</p>
  {:else}
    <div class="border border-border rounded-lg divide-y divide-border max-w-xl">
      {#each walletState.accounts as account (account.address)}
        <div class="p-4 flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground">
              {account.name || short(account.address)}
            </div>
            <div class="text-xs font-mono text-muted-foreground mt-1 break-all">
              {account.address}
            </div>
            {#if account.path}
              <div class="text-xs text-muted-foreground mt-1">
                {i18n.t('Path')}: <span class="font-mono">{account.path}</span>
              </div>
            {/if}
          </div>

          <button
            onclick={() => copy(account.address)}
            class="shrink-0 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-secondary transition-colors"
          >
            {copied === account.address ? i18n.t('Copied!') : i18n.t('Copy')}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!--
    Честная граница: добавление аккаунтов ещё не сделано. Пользователь
    должен узнать это из интерфейса, а не из неработающей кнопки.
  -->
  <p class="text-xs text-muted-foreground mt-4 max-w-xl">
    {i18n.t('Adding and removing accounts will be available later.')}
  </p>
</div>
