import japanese from './ja.json';

export type Language = 'en' | 'ja';
let language: Language = 'en';
const translations: Record<string, string> = japanese;
const templates = Object.entries(translations)
  .filter(([source]) => source.includes('{'))
  .map(([source, translation]) => {
    const names: string[] = [];
    const escaped = source.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const pattern = escaped.replace(/\{(\w+)\}/g, (_, name: string) => {
      names.push(name);
      return '([\\s\\S]*?)';
    });
    return { pattern: new RegExp(`^${pattern}$`), names, translation };
  });

export function setLanguage(value: Language): void {
  language = value;
}

export function translate(text: string): string {
  if (language === 'en') {
    return text;
  }
  if (translations[text]) {
    return translations[text];
  }
  for (const template of templates) {
    const match = text.match(template.pattern);
    if (match) {
      return template.translation.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = match[template.names.indexOf(name) + 1];
        return translations[value] ?? value;
      });
    }
  }
  return text;
}
