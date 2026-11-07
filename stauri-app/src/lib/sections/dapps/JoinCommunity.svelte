<script lang="ts">
  /**
   * Форма вступления в сообщество.
   *
   * ## Почему отдельным компонентом
   *
   * Шагов много и они не про дерево каталога: выбор раскрываемых адресов,
   * airdrop-адрес, пароль, проверка токен-гейта. Держать это в `DappsMain`
   * значило бы смешать навигацию по каталогу с формой, у которой своя
   * логика и своё состояние.
   *
   * ## Почему «Вступить» — не одно нажатие
   *
   * В status-go `requestToJoinCommunity` требует непустой список адресов,
   * `airdropAddress` внутри него и подпись на каждый адрес — а подпись
   * проверяет пароль (`GetVerifiedWalletAccount`). Поэтому сначала выбор
   * адресов и пароль.
   */
  import { i18n } from '$lib/i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    communitiesState,
    joinSelectedCommunity,
    checkEligibility,
    loadWalletAddresses,
  } from '$lib/stores/communitiesStore.svelte';
  import { loadChats } from '$lib/stores/chatsStore.svelte';

  let { onDone }: { onDone?: () => void } = $props();

  let password = $state('');
  /**
   * Отмеченные адреса.
   *
   * `SvelteSet` нельзя оборачивать в `$state`: он реактивен сам. Поэтому
   * множество не пересоздаётся, а очищается и наполняется — переприсваивание
   * потеряло бы подписки.
   */
  const selectedAddresses = new SvelteSet<string>();
  let airdropAddress = $state('');
  let message = $state<{ kind: 'ok' | 'pending' | 'error'; text: string } | null>(null);

  const entry = $derived(communitiesState.selected);

  /**
   * Готовит форму при монтировании: тянет адреса и проверяет токен-гейт.
   *
   * По умолчанию отмечаем все адреса — это и есть «Share all addresses to
   * join» из SIM. Снять лишние пользователь может вручную.
   *
   * Готовим здесь, а не в родителе: компонент монтируется ровно тогда, когда
   * пользователь раскрыл форму, и это же место знает о своём состоянии.
   * `untrack` не нужен — `$effect` ниже пишет только в локальные `$state`.
   */
  let prepared = false;
  $effect(() => {
    if (prepared || !entry) return;
    prepared = true;
    void (async () => {
      const addresses = await loadWalletAddresses();
      selectedAddresses.clear();
      for (const addr of addresses) selectedAddresses.add(addr);
      airdropAddress = addresses[0] || '';

      // Для токен-гейта сразу проверяем, проходят ли адреса: иначе
      // пользователь введёт пароль и получит отказ от владельца.
      if (entry.access === 'token') await checkEligibility();
    })();
  });

  function toggleAddress(address: string) {
    if (selectedAddresses.has(address)) {
      selectedAddresses.delete(address);
      if (airdropAddress === address) airdropAddress = '';
    } else {
      selectedAddresses.add(address);
      if (!airdropAddress) airdropAddress = address;
    }
  }

  async function submit() {
    if (communitiesState.isBusy) return;
    message = null;

    const addresses = [...selectedAddresses];
    const result = await joinSelectedCommunity(addresses, airdropAddress, password);

    if (result.ok) {
      password = '';
      // Каналы появятся после ответа владельца, но список стоит обновить
      // сразу: для AUTO_ACCEPT сообщества ответ приходит почти мгновенно.
      await loadChats(true);
      message = { kind: 'pending', text: i18n.t('Request sent') };
    } else {
      message = { kind: 'error', text: result.error || i18n.t('Join failed') };
    }
  }
</script>

<div class="p-2 space-y-2 border-t border-border">
  {#if message}
    <p class="text-xs {message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}">
      {message.text}
    </p>
  {/if}

  {#if communitiesState.eligibility?.checked}
    <div class="p-2 rounded-md border border-border text-xs">
      {#if communitiesState.eligibility.satisfied}
        <p class="text-foreground">{i18n.t('You are eligible to join as member')}</p>
      {:else}
        <p class="text-destructive">{i18n.t('Your addresses do not meet the conditions')}</p>
      {/if}
    </div>
  {/if}

  <!--
    Выбор адресов — не формальность: без него status-go откажет
    (RequestToJoinCommunity.Validate требует непустой список и
    airdropAddress внутри него).
  -->
  <p class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
    {i18n.t('Select address to share')}
  </p>
  <div class="space-y-1 max-h-32 overflow-y-auto">
    {#if communitiesState.walletAddresses.length === 0}
      <p class="text-xs text-muted-foreground italic">{i18n.t('No wallet addresses')}</p>
    {:else}
      {#each communitiesState.walletAddresses as addr (addr)}
        <label class="flex items-center gap-2 text-xs p-1 rounded hover:bg-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={selectedAddresses.has(addr)}
            onchange={() => toggleAddress(addr)}
            class="rounded"
          />
          <span class="font-mono truncate">{addr.slice(0, 10)}…{addr.slice(-6)}</span>
          {#if airdropAddress === addr}
            <span class="text-[0.625rem] px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
              {i18n.t('Airdrop')}
            </span>
          {/if}
        </label>
      {/each}
    {/if}
  </div>

  {#if communitiesState.walletAddresses.length > 1}
    <button
      onclick={() => {
        selectedAddresses.clear();
        for (const addr of communitiesState.walletAddresses) selectedAddresses.add(addr);
      }}
      class="text-[0.6875rem] text-primary hover:underline"
    >
      {i18n.t('Share all addresses')}
    </button>
  {/if}

  <input
    type="password"
    bind:value={password}
    placeholder={i18n.t('Password')}
    class="w-full h-8 border border-input rounded-md px-2 text-xs bg-background"
    aria-label={i18n.t('Password')}
  />
  <!--
    Пароль нужен потому, что подпись адресов делает status-go и проверяет его
    через GetVerifiedWalletAccount. Не наша проверка и наружу не передаётся.
  -->
  <p class="text-[0.625rem] text-muted-foreground">
    {i18n.t('The password is needed to sign the revealed addresses')}
  </p>

  <div class="flex gap-2">
    <button
      onclick={submit}
      disabled={communitiesState.isBusy || !password || selectedAddresses.size === 0}
      class="flex-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
    >
      {communitiesState.isBusy ? i18n.t('Sending...') : i18n.t('Request to join')}
    </button>
    <button
      onclick={() => onDone?.()}
      class="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-secondary"
    >
      {i18n.t('Cancel')}
    </button>
  </div>
</div>
