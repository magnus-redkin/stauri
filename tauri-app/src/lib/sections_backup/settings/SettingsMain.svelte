<script lang="ts">
  import { onMount } from "svelte";
  import { i18n } from "$lib/i18n";

  let theme = $state('maroon');
  let fontSize = $state('16');

  onMount(() => {
    theme = localStorage.getItem('stauri-theme') || 'maroon';
    fontSize = localStorage.getItem('stauri-font-size') || '16';
  });

  function applyTheme(newTheme: string) {
    theme = newTheme;
    localStorage.setItem('stauri-theme', newTheme);

    const html = document.documentElement;
    html.classList.remove('dark');
    html.setAttribute('data-theme', newTheme);

    if (newTheme === 'dark') {
      html.classList.add('dark');
    }
  }

  function applyFontSize(size: string) {
    fontSize = size;
    localStorage.setItem('stauri-font-size', size);
    document.documentElement.style.fontSize = `${size}px`;
  }

  function changeLanguage(newLocale: string) {
    i18n.locale = newLocale;
    localStorage.setItem('stauri-locale', newLocale);
  }
</script>

<div class="h-full overflow-y-auto p-8 bg-background">
  <div class="max-w-2xl mx-auto space-y-8">
    <!-- Заголовок -->
    <h1 class="text-3xl font-bold text-primary">{i18n.t('Title')}</h1>

    <!-- Язык -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Language')}</label>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'en' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('en')}
        >
          English
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'ru' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('ru')}
        >
          Русский
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'zh' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('zh')}
        >
          中文
        </button>
      </div>
    </div>

    <!-- Тема -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Theme')}</label>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'maroon' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => applyTheme('maroon')}
        >
          {i18n.t('Maroon')}
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => applyTheme('light')}
        >
          {i18n.t('Light')}
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => applyTheme('dark')}
        >
          {i18n.t('Dark')}
        </button>
      </div>
    </div>

    <!-- Шрифт -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Font Size')}</label>
      <div class="flex items-center gap-4">
        <input
          type="range"
          min="12"
          max="20"
          bind:value={fontSize}
          oninput={(e) => applyFontSize((e.target as HTMLInputElement).value)}
          class="w-full accent-primary"
        />
        <span class="font-mono text-sm">{fontSize}px</span>
      </div>
    </div>
  </div>
</div>
