<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '$lib/i18n';
  import PasswordInput from './PasswordInput.svelte';

  let firstWordInput: HTMLInputElement | undefined = $state();


  let {
    onBack,
    onLogin
  }: {
    onBack: () => void;
    onLogin: () => void;
  } = $props();

  // Шаг: 1 = ввод слов, 2 = ввод пароля
  let step = $state(1);
  let words = $state(Array(12).fill(""));
  let password = $state("");

  onMount(() => {
    setTimeout(() => firstWordInput?.focus(), 50);
  });

  // Обработка вставки (Ctrl+V) в первое поле
  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text') || '';
    const parts = text.trim().split(/\s+/);

    if (parts.length >= 12) {
      e.preventDefault();
      // Заполняем все 12 полей
      for (let i = 0; i < 12; i++) {
        words[i] = parts[i] || '';
      }
    }
    // Если меньше 12, даем браузеру вставить как обычно в одно поле
  }

  function nextStep() {
    // Проверяем, что все 12 слов заполнены
    if (words.every(w => w.trim().length > 0)) {
      step = 2;
    } else {
      alert(i18n.t('Please fill all 12 words.'));
    }
  }
</script>

<div class="flex flex-col items-center justify-center min-h-screen gap-6 p-4 bg-background">
  <!-- Кнопка Назад -->
  <button
    onclick={onBack}
    class="self-start text-sm text-muted-foreground hover:underline flex items-center gap-1"
  >
    ← {i18n.t('Back')}
  </button>

  {#if step === 1}
    <!-- ШАГ 1: Ввод 12 слов -->
    <h1 class="text-3xl font-bold text-foreground">{i18n.t('Log in by Recovery Phrase')}</h1>
    <p class="text-sm text-muted-foreground">{i18n.t('Enter your 12 words in the correct order.')}</p>

    <div class="grid grid-cols-2 gap-2 w-full max-w-md">
      {#each words as word, i}
  <div class="relative">
    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{i + 1}.</span>

    {#if i === 0}
      <input
        bind:this={firstWordInput}
        type="text"
        bind:value={words[i]}
        onpaste={handlePaste}
        class="w-full h-10 border border-input rounded-md pl-8 pr-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        />
      {:else}
        <input
          type="text"
          bind:value={words[i]}
          class="w-full h-10 border border-input rounded-md pl-8 pr-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        {/if}
      </div>
    {/each}
  </div>

    <button
      onclick={nextStep}
      class="w-full max-w-md py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition mt-2"
    >
      {i18n.t('Continue')}
    </button>

  {:else}
    <!-- ШАГ 2: Ввод пароля -->
    <h1 class="text-3xl font-bold text-foreground">{i18n.t('Set New Password')}</h1>
    <p class="text-sm text-muted-foreground">{i18n.t('This password will encrypt your local database.')}</p>

    <div class="w-full max-w-md mt-4">
      <PasswordInput
        bind:value={password}
        placeholder={i18n.t('New Password')}
        onEnter={onLogin}
        autofocus={true}
      />
    </div>

    <button
      onclick={onLogin}
      class="w-full max-w-md py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition mt-2"
    >
      {i18n.t('Log In')}
    </button>

    <button
      onclick={() => step = 1}
      class="text-sm text-muted-foreground hover:underline"
    >
      ← {i18n.t('Back to words')}
    </button>
  {/if}

  <p class="text-xs text-muted-foreground text-center max-w-md mt-4">
    {i18n.t('Recovery via seed phrase is not yet connected to the backend. This is a placeholder.')}
  </p>
</div>
