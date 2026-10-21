<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { onMount } from 'svelte';

  // Состояние темы (читаем из localStorage или ставим по умолчанию 'maroon')
  let theme = $state('maroon');
  // Состояние размера шрифта
  let fontSize = $state('16');

  // Загрузка сохранённых настроек
  onMount(() => {
    const savedTheme = localStorage.getItem('stauri-theme');
    if (savedTheme) theme = savedTheme;

    const savedFontSize = localStorage.getItem('stauri-font-size');
    if (savedFontSize) fontSize = savedFontSize;

    applyTheme(theme);
    applyFontSize(fontSize);
  });

  function applyTheme(newTheme: string) {
    theme = newTheme;
    localStorage.setItem('stauri-theme', newTheme);

    const html = document.documentElement;
    // Сбрасываем предыдущие классы
    html.classList.remove('dark');
    // Устанавливаем data-атрибут для CSS (если используете его)
    html.setAttribute('data-theme', newTheme);

    if (newTheme === 'dark') {
      html.classList.add('dark');
    }
    // Для 'maroon' и 'light' класс dark не нужен, они используют :root переменные
  }

  function applyFontSize(size: string) {
    fontSize = size;
    localStorage.setItem('stauri-font-size', size);
    document.documentElement.style.fontSize = `${size}px`;
  }

  function changeLanguage(newLocale: string) {
    locale.set(newLocale);
    localStorage.setItem('stauri-locale', newLocale);
  }
</script>

<div class="p-8 max-w-2xl mx-auto space-y-8">
  <h1 class="text-3xl font-bold text-primary">{$t('settings.title')}</h1>

  <!-- Выбор языка -->
  <div class="space-y-2">
    <label class="font-medium text-foreground">{$t('settings.language')}</label>
    <div class="flex gap-2">
      <button
        class="px-4 py-2 rounded-md border { $locale === 'en' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => changeLanguage('en')}
      >
        English
      </button>
      <button
        class="px-4 py-2 rounded-md border { $locale === 'ru' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => changeLanguage('ru')}
      >
        Русский
      </button>
      <button
        class="px-4 py-2 rounded-md border { $locale === 'zh' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => changeLanguage('zh')}
      >
        中文
      </button>
    </div>
  </div>

  <!-- Выбор темы -->
  <div class="space-y-2">
    <label class="font-medium text-foreground">{$t('settings.theme')}</label>
    <div class="flex gap-2">
      <button
        class="px-4 py-2 rounded-md border { theme === 'maroon' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => applyTheme('maroon')}
      >
        {$t('settings.themes.maroon')}
      </button>
      <button
        class="px-4 py-2 rounded-md border { theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => applyTheme('light')}
      >
        {$t('settings.themes.light')}
      </button>
      <button
        class="px-4 py-2 rounded-md border { theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-card' }"
        onclick={() => applyTheme('dark')}
      >
        {$t('settings.themes.dark')}
      </button>
    </div>
  </div>

  <!-- Размер шрифта -->
  <div class="space-y-2">
    <label class="font-medium text-foreground">{$t('settings.fontSize')}</label>
    <div class="flex items-center gap-4">
      <input
        type="range"
        min="12"
        max="20"
        bind:value={fontSize}
        oninput={(e) => applyFontSize((e.target as HTMLInputElement).value)}
        class="w-full"
      />
      <span class="font-mono text-sm">{fontSize}px</span>
    </div>
  </div>
</div>
