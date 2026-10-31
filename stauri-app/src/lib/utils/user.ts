/**
 * Возвращает читаемое имя пользователя (или чата).
 * Приоритет: displayName -> alias -> compressedKey -> id
 */

export function getDisplayName(entity: any): string {
  if (!entity) return 'Unknown';

  // 1. displayName (если задано)
  if (entity.displayName && entity.displayName.length > 0) return entity.displayName;

  // 2. alias (трёхсловное имя, если есть)
  if (entity.alias && entity.alias.length > 0 && !entity.alias.startsWith('zQ3')) {
    return entity.alias;
  }

  // 3. name (если это не обрезанный ключ)
  if (entity.name && entity.name.length > 0 && !entity.name.startsWith('0x')) {
    return entity.name;
  }

  // 4. compressedKey / id
  if (entity.compressedKey) return entity.compressedKey;
  if (entity.id) return entity.id.slice(0, 8) + '...';

  return 'Unknown';
}


/**
 * Заменяет публичные ключи (0x...) в тексте сообщения на читаемые имена.
 * @param text - исходный текст сообщения
 * @param contacts - список контактов (для поиска имени по ключу)
 */

export function formatMessageText(text: string, contacts: any[] = []): string {
  if (!text) return '';

  // Ловим 0x + 4-64 hex + опционально ...
  const keyRegex = /0x[a-fA-F0-9]{4,64}(?:\.\.\.)?/g;

  return text.replace(keyRegex, (match) => {
    const cleanKey = match.replace('...', '');

    // Ищем контакт, чей id начинается с cleanKey
    const contact = contacts.find(c => c.id.startsWith(cleanKey));
    if (contact) {
      return getDisplayName(contact);
    }
    return match;
  });
}
