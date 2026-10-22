<script lang="ts">
  import { i18n } from '$lib/i18n';

  let { onNext, onBack }: { onNext: () => void; onBack: () => void } = $props();

  const mnemonicWords = [
    "apple", "banana", "cherry", "date", "elderberry", "fig",
    "grape", "honeydew", "kiwi", "lemon", "mango", "nectarine"
  ];

  let copied = $state(false);

  function copyToClipboard() {
    navigator.clipboard.writeText(mnemonicWords.join(" "));
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  // Обработка Ctrl+C на уровне контейнера (если выделен текст)
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const selection = window.getSelection()?.toString();
      if (selection && selection.trim().length > 0) {
        // Если пользователь выделил текст, копируем его
        navigator.clipboard.writeText(selection);
      } else {
        // Иначе копируем всю фразу
        copyToClipboard();
      }
    }
  }
</script>

<div class="max-w-md mx-auto w-full pt-12 px-6" onkeydown={handleKeydown} role="presentation">
  <button onclick={onBack} class="text-sm text-muted-foreground hover:underline mb-4">← Back</button>
  <h2 class="text-2xl font-bold text-primary mb-2">{i18n.t('Show recovery phrase')}</h2>
  <p class="text-sm text-muted-foreground mb-4">{i18n.t('A 12-word phrase that gives full access to your funds. Write it down and store it safely.')}</p>

  <div class="grid grid-cols-2 gap-2 p-4 bg-secondary/30 rounded-lg mb-4 relative group">
    {#each mnemonicWords as word, i}
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground w-4 text-right">{i + 1}.</span>
        <span class="font-mono font-medium">{word}</span>
      </div>
    {/each}

    <!-- Кнопка копирования -->
    <button
      onclick={copyToClipboard}
      class="absolute top-2 right-2 p-1.5 bg-background border border-border rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-xs flex items-center gap-1"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  </div>

  <div class="p-4 border border-destructive/30 bg-destructive/10 rounded-lg text-sm text-destructive mb-6">
    <strong>Warning:</strong> Never share your recovery phrase. Anyone asking for it is trying to scam you.
  </div>

  <button onclick={onNext} class="w-full h-12 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90">{i18n.t('I\'ve backed up phrase')}</button>
</div>
