import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

type Replies = { review: string; templates: Record<string, { ml: string; en: string }> };

/** Admin tooling reads the reviewed-source manifest; unresolved member-specific replies stay runtime-only. */
export function promptManifest(repliesFile: string) {
  const replies = JSON.parse(readFileSync(repliesFile, 'utf8')) as Replies;
  return {
    review: replies.review,
    prompts: Object.entries(replies.templates).flatMap(([id, translations]) => Object.entries(translations).map(([language, template]) => {
      // A cached greeting is deliberately generic, never a made-up member name.
      const text = id === 'call_greeting' ? template.replace(' {name}', '') : template;
      const languageCode = language === 'ml' ? 'ml-IN' : 'en-IN';
      const hash = createHash('sha256').update(`${languageCode}\0${text}`).digest('hex');
      return { id, language, text, runtimeOnly: /\{[^}]+\}/.test(text), path: `audio/prompts/${languageCode}/${hash}.mp3` };
    })),
  };
}
