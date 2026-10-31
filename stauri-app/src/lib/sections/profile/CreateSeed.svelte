<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { getSettingsWithMnemonic } from '$lib/status/api';

  let { onBack, onSave }: { onBack: () => void; onSave: () => void } = $props();

  let mnemonic = $state('');
  let isLoading = $state(true);
  let step = $state<1 | 2>(1);
  let testWords = $state<string[]>([]);
  let testAnswers = $state<string[]>(['', '', '', '']);
  let wordStatus = $state<(boolean | null)[]>([null, null, null, null]); // true = верно, false = неверно, null = пусто
  let inputRefs: HTMLInputElement[] = [];

  // Загрузка мнемоники
  $effect(() => {
    if (statusState.backendPort) {
      getSettingsWithMnemonic(statusState.backendPort).then(m => {
        if (m) mnemonic = m;
        isLoading = false;
      });
    }
  });

  const allWords = $derived(mnemonic.split(' ').filter(w => w.length > 0));

  // Проверка: все ли 4 поля верны
  const allCorrect = $derived(wordStatus.every(s => s === true));

  // Копирование всей фразы
  async function copyPhrase() {
    await navigator.clipboard.writeText(allWords.join(' '));
  }

  function startVerification() {
    const indices = new Set<number>();
    while (indices.size < 4) {
      indices.add(Math.floor(Math.random() * allWords.length));
    }
    testWords = Array.from(indices).map(i => allWords[i]);
    step = 2;
    setTimeout(() => inputRefs[0]?.focus(), 100);
  }

  function handleInput(e: Event, index: number) {
    const value = (e.target as HTMLInputElement).value;
    testAnswers[index] = value;

    // Проверяем правильность
    if (value.trim() === '') {
      wordStatus[index] = null;
    } else {
      wordStatus[index] = value.trim().toLowerCase() === testWords[index].toLowerCase();
    }

    // Автопереход только если слово введено полностью (или нажат пробел)
    const isComplete = value.length >= testWords[index].length;
    const hasSpace = value.endsWith(' ');

    if ((isComplete || hasSpace) && index < 3) {
      inputRefs[index + 1]?.focus();
      // Если был пробел, можно удалить его из значения (чтобы не мешал проверке)
      if (hasSpace) {
        testAnswers[index] = value.trim();
      }
    }
  }

  function checkAnswers() {
    if (allCorrect) {
      onSave();
    }
  }
</script>

<div class="p-8 max-w-2xl mx-auto w-full">
  {#if isLoading}
    <p>Loading...</p>
  {:else if step === 1}
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-primary">{i18n.t('Create Seed Phrase')}</h2>
      <button
        onclick={copyPhrase}
        class="text-sm text-primary hover:underline flex items-center gap-1"
        title={i18n.t('Copy phrase')}
      >
        📋 {i18n.t('Copy')}
      </button>
    </div>

    <p class="text-sm text-destructive mb-4">
      {i18n.t('Write this down and store it safely. This is the only way to recover your account.')}
    </p>

    <!-- 12 слов (цифры не выделяются) -->
    <div class="grid grid-cols-2 gap-2 p-4 bg-secondary/30 rounded-lg w-full max-w-md mb-6">
      {#each allWords as word, i (i)}
        <div class="flex items-center gap-2">
          <span class="text-xs text-muted-foreground w-4 text-right select-none">{i + 1}.</span>
          <span class="font-mono font-medium">{word}</span>
        </div>
      {/each}
    </div>

    <button
      onclick={startVerification}
      class="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium mb-2"
    >
      {i18n.t('Проверить сохраненную фразу')}
    </button>
    <button onclick={onBack} class="text-sm text-muted-foreground hover:underline">
      {i18n.t('Back')}
    </button>

  {:else}
    <h2 class="text-2xl font-bold text-primary mb-4">{i18n.t('Verify Seed Phrase')}</h2>
    <p class="text-sm text-muted-foreground mb-4">
      {i18n.t('Enter the following words from your seed phrase:')}
    </p>

    <div class="flex flex-col gap-3 max-w-md mb-6">
      {#each testWords as word, i (i)}
        <div class="flex items-center gap-3">
          <span class="text-sm font-mono w-24 text-right text-muted-foreground">
            {i18n.t('Word')} {allWords.indexOf(word) + 1}:
          </span>
          <input
            bind:this={inputRefs[i]}
            type="text"
            value={testAnswers[i]}
            oninput={(e) => handleInput(e, i)}
            class="flex-1 h-10 border rounded-md px-3 font-mono transition-colors {wordStatus[i] === true ? 'border-green-500 bg-green-50 text-green-700' : wordStatus[i] === false ? 'border-red-500 bg-red-50 text-red-700' : 'border-input bg-background'}"
            placeholder={i18n.t('Enter word')}
          />
        </div>
      {/each}
    </div>

    <button
      onclick={checkAnswers}
      disabled={!allCorrect}
      class="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {i18n.t('Сохранить seed-фразу')}
    </button>
    <button onclick={() => step = 1} class="text-sm text-muted-foreground hover:underline">
      {i18n.t('Back to words')}
    </button>
  {/if}
</div>
