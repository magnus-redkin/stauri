<script lang="ts">
  /**
   * QR-код рисуется локально, без сетевого запроса.
   *
   * ## Почему не сервис картинок
   *
   * Раньше адрес кошелька уходил в `api.qrserver.com`, то есть при каждом
   * открытии вкладки «Получить» кто-то посторонний узнавал, какой у
   * пользователя адрес и что он пользуется Stauri. Адрес не секрет, но
   * связка «адрес ↔ клиент» — уже сведения, которых отдавать незачем.
   *
   * Вторая, более заметная причина: этого хоста нет в CSP
   * (`svelte.config.js`), поэтому картинка просто не загружалась — QR на
   * экране отсутствовал. Разрешать хост в CSP ради этого было бы худшим
   * решением: мы бы расширили политику безопасности ради утечки.
   *
   * ## Почему `qrcode` в devDependencies
   *
   * Библиотека нужна только на этапе сборки: Vite кладёт её код в бандл.
   * Ошибка при этом будет не в рантайме, а при `build`, то есть сразу.
   */
  import QRCode from 'qrcode';

  let { value, size = 192 }: { value: string; size?: number } = $props();

  /**
   * Готовая картинка (data URI) или текст ошибки.
   *
   * `data:` разрешён в CSP (`img-src`), поэтому результат показывается как
   * обычный `<img>` без обращений наружу.
   */
  let dataUrl = $state('');
  let failed = $state('');

  /**
   * Перерисовываем при изменении значения.
   *
   * Тип `image/png`, а не SVG: SVG-строка, вставленная как `src`, всё равно
   * выполняется как документ, и хотя у нас нет пользовательской разметки,
   * PNG снимает вопрос совсем. `margin: 0` — белая рамка не нужна, её даёт
   * сам контейнер.
   */
  $effect(() => {
    const text = value;
    if (!text) {
      dataUrl = '';
      failed = '';
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: size,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (cancelled) return;
        dataUrl = url;
        failed = '';
      })
      .catch((e) => {
        if (cancelled) return;
        // Адрес показан рядом текстом и копируется, поэтому отказ рисования
        // не мешает получить средства — сообщаем и живём дальше.
        dataUrl = '';
        failed = String(e);
        console.error('[qr] failed to render:', e);
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<div
  class="bg-white rounded-lg border border-border p-3 flex items-center justify-center shrink-0"
  style="width: {size + 24}px; height: {size + 24}px"
>
  {#if dataUrl}
    <img src={dataUrl} width={size} height={size} alt="" aria-label="QR code" />
  {:else if failed}
    <span class="text-xs text-destructive text-center px-2">QR unavailable</span>
  {:else}
    <span class="text-xs text-muted-foreground">…</span>
  {/if}
</div>
